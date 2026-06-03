import logging
import os
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", category=DeprecationWarning)

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_text_splitters import RecursiveCharacterTextSplitter

from document_loaders import load_document
from embeddings import ParallelEmbeddings

log = logging.getLogger(__name__)

MAX_CHARS  = 1_500_000
TOP_K      = 6

SYSTEM_PROMPT = """\
You are an expert AI assistant analyzing the provided document context.

Instructions:
1. Answer strictly using facts present in the context — do not invent details.
2. For analytical or comparative questions, synthesize from the context and note when the document doesn't explicitly rank or compare.
3. If the question is unrelated to the document, respond:
   "I couldn't find relevant information in the document to answer this question."

Context:
{context}
"""


def chunk_settings(char_count: int) -> tuple[int, int]:
    if char_count < 500 * 1024:  return 1500, 150
    if char_count < 2 * 1024 * 1024: return 4000, 400
    return 8000, 800


class RAGPipeline:
    def __init__(self):
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise ValueError("GEMINI_API_KEY is not set.")
        self.embeddings = ParallelEmbeddings(model="models/gemini-embedding-001", google_api_key=key)
        self.llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash-lite", google_api_key=key, temperature=0.3)
        self.store = None
        self.retriever = None
        self.doc_name = ""

    def index_document(self, file_bytes: bytes, filename: str):
        self.doc_name = filename
        pages = load_document(file_bytes, filename)
        text = "".join(p.page_content for p in pages).strip() if pages else ""

        # OCR fallback for scanned PDFs with no selectable text
        if len(text) < 15 and filename.lower().endswith(".pdf"):
            log.info("No selectable text in %s — trying Gemini OCR.", filename)
            try:
                from google import genai
                from google.genai import types
                client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
                resp = client.models.generate_content(
                    model="gemini-2.5-flash-lite",
                    contents=[
                        types.Part.from_bytes(data=file_bytes, mime_type="application/pdf"),
                        "Transcribe all text. Preserve layout, headers, tables. Do not summarize.",
                    ],
                )
                text = (resp.text or "").strip()
            except Exception as err:
                log.error("OCR failed: %s", err)

        if not text:
            text = f"'{self.doc_name}' contains no readable text."

        if len(text) > MAX_CHARS:
            log.warning("Truncating %s from %d to %d chars.", filename, len(text), MAX_CHARS)
            text = text[:MAX_CHARS]

        size, overlap = chunk_settings(len(text))
        log.info("Chunking %s: %d chars, size=%d, overlap=%d", filename, len(text), size, overlap)

        splitter = RecursiveCharacterTextSplitter(chunk_size=size, chunk_overlap=overlap)
        chunks = splitter.split_documents([Document(page_content=text, metadata={"source": filename})])
        if not chunks:
            chunks = [Document(page_content=f"'{self.doc_name}' has no readable text.", metadata={"source": filename})]

        self.store = FAISS.from_documents(chunks, self.embeddings)
        self.retriever = self.store.as_retriever(search_type="similarity", search_kwargs={"k": TOP_K})

    def save_index(self, folder: str):
        if self.store:
            Path(folder).mkdir(parents=True, exist_ok=True)
            self.store.save_local(folder)

    def load_index(self, folder: str, doc_name: str = ""):
        self.doc_name = doc_name
        self.store = FAISS.load_local(folder, self.embeddings, allow_dangerous_deserialization=True)
        self.retriever = self.store.as_retriever(search_type="similarity", search_kwargs={"k": TOP_K})

    def ask(self, question: str) -> dict:
        if not self.retriever:
            raise ValueError("No document indexed yet.")

        docs = self.retriever.invoke(question)
        context = "\n\n---\n\n".join(d.page_content for d in docs)

        chain = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human", "{question}"),
        ]) | self.llm | StrOutputParser()

        answer = chain.invoke({"context": context, "question": question})

        seen, sources = set(), []
        for doc in docs:
            snippet = doc.page_content.strip()
            if snippet in seen:
                continue
            seen.add(snippet)
            sources.append({
                "content": snippet[:300] + ("…" if len(snippet) > 300 else ""),
                "page": doc.metadata.get("page"),
                "source": doc.metadata.get("source", self.doc_name),
            })

        return {"answer": answer, "sources": sources}
