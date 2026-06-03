import base64
import logging
import os
import shutil
import tempfile
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import fetch_document_backup, fetch_document_name, verify_token
from file_utils import delete_index, load_index, save_index
from rag_pipeline import RAGPipeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="RAG Document Q&A", version="3.0.0")

origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()] or [
    "http://localhost",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://localhost:5173",
    "https://docs-q-a.vercel.app",
    "null"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".csv", ".xlsx", ".pptx"}
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB

# In-memory cache: doc_id → loaded pipeline
pipelines: dict[str, RAGPipeline] = {}


# ── Auth helpers ──────────────────────────────────────────────────────────────

def require_auth(request: Request) -> str:
    """Extract and verify Bearer token. Returns the JWT string on success."""
    header = request.headers.get("Authorization", "")
    token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else ""
    if not token:
        raise HTTPException(401, "Missing Authorization header.")
    if not verify_token(token):
        raise HTTPException(401, "Invalid or expired token.")
    return token


def valid_doc_id(doc_id: str) -> None:
    try:
        UUID(doc_id)
    except ValueError:
        raise HTTPException(400, "document_id must be a valid UUID.")


# ── Pipeline helpers ──────────────────────────────────────────────────────────

def build_pipeline(doc_id: str, file_bytes: bytes, filename: str) -> RAGPipeline:
    pipeline = RAGPipeline()
    pipeline.index_document(file_bytes, filename)
    with tempfile.TemporaryDirectory() as tmp:
        pipeline.save_index(tmp)
        if not save_index(tmp, doc_id):
            log.warning("Could not persist index for %s to Supabase.", doc_id)
    pipelines[doc_id] = pipeline
    return pipeline


def load_pipeline(doc_id: str) -> RAGPipeline | None:
    index_path = load_index(doc_id)
    if not index_path:
        return None
    try:
        pipeline = RAGPipeline()
        doc_name = fetch_document_name(doc_id) or ""
        pipeline.load_index(index_path, doc_name)
        pipelines[doc_id] = pipeline
        return pipeline
    except Exception as err:
        log.error("Failed to load index for %s: %s", doc_id, err)
        return None
    finally:
        if index_path and Path(index_path).exists():
            shutil.rmtree(index_path, ignore_errors=True)


def rebuild_pipeline(doc_id: str, token: str) -> RAGPipeline | None:
    filename, b64_data = fetch_document_backup(doc_id, token)
    if not filename or not b64_data:
        return None
    return build_pipeline(doc_id, base64.b64decode(b64_data), filename)


def get_pipeline(doc_id: str, token: str | None = None) -> RAGPipeline:
    if doc_id in pipelines:
        return pipelines[doc_id]

    pipeline = load_pipeline(doc_id)

    if not pipeline and token:
        try:
            pipeline = rebuild_pipeline(doc_id, token)
        except Exception as err:
            log.error("Rebuild failed for %s: %s", doc_id, err)

    if not pipeline:
        raise HTTPException(404, "Document index not found. Please re-upload.")
    return pipeline


# ── Routes ────────────────────────────────────────────────────────────────────

class AskRequest(BaseModel):
    document_id: str
    question: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/config")
async def config():
    return {
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", ""),
    }


@app.post("/upload")
async def upload(request: Request, document_id: str, file: UploadFile = File(...)):
    require_auth(request)
    valid_doc_id(document_id)

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'.")

    data = await file.read()
    if not data:
        raise HTTPException(400, "File is empty.")
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, "File exceeds the 50 MB limit.")

    try:
        build_pipeline(document_id, data, file.filename)
    except HTTPException:
        raise
    except Exception as err:
        delete_index(document_id)
        raise HTTPException(500, f"Indexing failed: {err}")

    return {
        "document_id": document_id,
        "filename": file.filename,
        "vector_store_path": f"supabase://vector-stores/{document_id}/index.zip",
    }


@app.post("/ask")
async def ask(request: Request, body: AskRequest):
    token = require_auth(request)
    valid_doc_id(body.document_id)

    question = body.question.strip()[:2000]
    if not question:
        raise HTTPException(400, "Question cannot be empty.")

    try:
        return get_pipeline(body.document_id, token).ask(question)
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(500, f"Failed to answer: {err}")


@app.delete("/document/{document_id}")
async def delete_document(document_id: str, request: Request):
    require_auth(request)
    valid_doc_id(document_id)
    pipelines.pop(document_id, None)
    delete_index(document_id)
    return {"message": "Document deleted."}
