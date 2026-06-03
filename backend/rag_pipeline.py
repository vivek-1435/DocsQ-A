import os
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=DeprecationWarning)

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_text_splitters import RecursiveCharacterTextSplitter

from document_loaders import load_document
from embeddings import ParallelGoogleGenerativeAIEmbeddings

MAX_DOCUMENT_CHARS = 1_500_000
RETRIEVAL_K = 6

SYSTEM_PROMPT = """\
You are an expert, highly intelligent AI assistant analyzing the provided document context.

Instructions:
1. Answer the user's question by thoroughly analyzing the provided document context.
2. Ground all your answers strictly in the facts and details present in the context. Do not invent details or assume facts that are not present.
3. If the user asks an indirectly connected, analytical, synthesis, or subjective question (such as comparing options, evaluating key aspects, identifying the "most prominent" or "best" items, or summarizing complex themes), provide a helpful, professional, and synthesized analysis based *only* on the facts in the document. Note clearly if the document does not explicitly specify a ranking or direct answer, but analyze and compare the details actually present in the context to provide a useful, well-reasoned answer.
4. If the question is about a completely unrelated topic, general knowledge, or external subjects that have absolutely nothing to do with the document context (e.g., "What is the capital of France?", "tell me a recipe"), state clearly:
"I couldn't find relevant information in the document to answer this question."

Context:
{context}
"""


def _format_docs(docs: list) -> str:
    return "\n\n---\n\n".join(doc.page_content for doc in docs)


def _chunk_settings(total_chars: int) -> tuple[int, int]:
    if total_chars < 500 * 1024:
        return 1500, 150
    if total_chars < 2 * 1024 * 1024:
        return 4000, 400
    return 8000, 800


class RAGPipeline:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables")

        self.embeddings = ParallelGoogleGenerativeAIEmbeddings(
            model="models/gemini-embedding-001",
            google_api_key=api_key,
        )
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash-lite",
            google_api_key=api_key,
            temperature=0.3,
        )
        self.vector_store = None
        self.retriever = None
        self.doc_name = ""

    def process_document(self, file_path: str, original_name: str = ""):
        self.doc_name = original_name or Path(file_path).name

        documents = load_document(file_path)
        
        total_text = ""
        if documents:
            total_text = "".join(doc.page_content for doc in documents).strip()

        if len(total_text) < 15:
            ext = Path(file_path).suffix.lower()
            if ext == ".pdf":
                print(f"Selectable text is empty for {self.doc_name}. Falling back to Gemini Multimodal OCR.")
                try:
                    from google import genai
                    from google.genai import types
                    
                    api_key = os.getenv("GEMINI_API_KEY")
                    client = genai.Client(api_key=api_key)
                    
                    with open(file_path, "rb") as f:
                        file_bytes = f.read()
                        
                    response = client.models.generate_content(
                        model='gemini-2.5-flash-lite',
                        contents=[
                            types.Part.from_bytes(
                                data=file_bytes,
                                mime_type="application/pdf"
                            ),
                            "Transcribe all text from this scanned document. Please preserve layout, headers, tables, and write out all text exactly as it appears. Do not summarize or add introduction."
                        ]
                    )
                    
                    ocr_text = response.text
                    if ocr_text and ocr_text.strip():
                        total_text = ocr_text.strip()
                except Exception as ocr_err:
                    print(f"Gemini OCR fallback failed: {ocr_err}")

        if not total_text:
            total_text = f"This document '{self.doc_name}' contains no readable text or is empty."

        if len(total_text) > MAX_DOCUMENT_CHARS:
            print(f"Document content length ({len(total_text)}) exceeds MAX_DOCUMENT_CHARS ({MAX_DOCUMENT_CHARS}). Truncating to optimize speed.")
            total_text = total_text[:MAX_DOCUMENT_CHARS]

        documents = [Document(page_content=total_text, metadata={"source": self.doc_name})]
        total_chars = len(total_text)
        chunk_size, chunk_overlap = _chunk_settings(total_chars)
            
        print(f"Adaptive chunking: document character count is {total_chars}. Using chunk_size={chunk_size}, chunk_overlap={chunk_overlap}")

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        chunks = splitter.split_documents(documents)
        
        if not chunks:
            placeholder_text = f"This document '{self.doc_name}' contains no readable text or is empty."
            chunks = [Document(page_content=placeholder_text, metadata={"source": self.doc_name})]

        self.vector_store = FAISS.from_documents(chunks, self.embeddings)
        self.retriever = self.vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": RETRIEVAL_K},
        )

    def save_index(self, folder_path: str):
        if self.vector_store:
            Path(folder_path).mkdir(parents=True, exist_ok=True)
            self.vector_store.save_local(folder_path)

    def load_index(self, folder_path: str, doc_name: str = ""):
        self.doc_name = doc_name
        self.vector_store = FAISS.load_local(
            folder_path,
            self.embeddings,
            allow_dangerous_deserialization=True
        )
        self.retriever = self.vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": RETRIEVAL_K},
        )

    def ask(self, question: str) -> dict:
        if not self.retriever:
            raise ValueError("No document has been processed yet.")

        source_docs = self.retriever.invoke(question)
        context_str = _format_docs(source_docs)

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", SYSTEM_PROMPT),
                ("human", "{question}"),
            ]
        )
        llm_chain = prompt | self.llm | StrOutputParser()
        answer = llm_chain.invoke({"context": context_str, "question": question})

        seen: set[str] = set()
        sources = []
        for doc in source_docs:
            snippet = doc.page_content.strip()
            if snippet in seen:
                continue
            seen.add(snippet)
            sources.append(
                {
                    "content": snippet[:300] + ("…" if len(snippet) > 300 else ""),
                    "page": doc.metadata.get("page"),
                    "source": doc.metadata.get("source", self.doc_name),
                }
            )

        return {
            "answer": answer,
            "sources": sources,
        }
