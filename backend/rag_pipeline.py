import os
import warnings
from pathlib import Path

# suppress langchain deprecation warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_community.vectorstores import FAISS
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough, RunnableParallel


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


class RAGPipeline:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in environment variables")

        self.embeddings = GoogleGenerativeAIEmbeddings(
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
        self.chain = None
        self.doc_name = ""

    def _load_document(self, file_path: str) -> list:
        ext = Path(file_path).suffix.lower()

        if ext == ".pdf":
            from langchain_community.document_loaders import PyPDFLoader
            return PyPDFLoader(file_path).load()

        elif ext in [".docx", ".doc"]:
            from langchain_community.document_loaders import Docx2txtLoader
            return Docx2txtLoader(file_path).load()

        raise ValueError(f"Unsupported file type: {ext}")

    def process_document(self, file_path: str, original_name: str = ""):
        self.doc_name = original_name or Path(file_path).name

        documents = self._load_document(file_path)
        if not documents:
            raise ValueError("No content could be extracted from the document.")

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
        )
        chunks = splitter.split_documents(documents)
        if not chunks:
            raise ValueError("Document produced no text chunks.")

        self.vector_store = FAISS.from_documents(chunks, self.embeddings)
        self.retriever = self.vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 6},
        )

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", SYSTEM_PROMPT),
                ("human", "{question}"),
            ]
        )

        # lcel chain to retrieve docs and run question through prompt
        retrieve_and_pass = RunnableParallel(
            context=self.retriever | _format_docs,
            question=RunnablePassthrough(),
        )

        self.chain = retrieve_and_pass | prompt | self.llm | StrOutputParser()

    def ask(self, question: str) -> dict:
        if not self.chain or not self.retriever:
            raise ValueError("No document has been processed yet.")

        answer = self.chain.invoke(question)
        source_docs = self.retriever.invoke(question)

        # build unique list of citations
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
