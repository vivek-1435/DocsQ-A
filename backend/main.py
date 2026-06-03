import os
import base64
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import fetch_document_backup
from file_utils import UPLOAD_DIR, VECTOR_STORE_DIR, delete_local_document, save_uploaded_file
from rag_pipeline import RAGPipeline

app = FastAPI(title="Stateless RAG Document Q&A API", version="2.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".csv", ".xlsx", ".pptx"}

loaded_pipelines: dict[str, RAGPipeline] = {}


class QuestionRequest(BaseModel):
    document_id: str
    question: str
    token: str | None = None


def _build_index(document_id: str, saved_path: Path, filename: str) -> RAGPipeline:
    vector_store_path = VECTOR_STORE_DIR / document_id
    pipeline = RAGPipeline()
    pipeline.process_document(str(saved_path), original_name=filename)
    pipeline.save_index(str(vector_store_path))
    loaded_pipelines[document_id] = pipeline
    return pipeline


def _load_local_index(document_id: str) -> RAGPipeline | None:
    vector_store_path = VECTOR_STORE_DIR / document_id
    if not vector_store_path.exists():
        return None

    pipeline = RAGPipeline()
    pipeline.load_index(str(vector_store_path))
    loaded_pipelines[document_id] = pipeline
    return pipeline


def _rebuild_index_from_backup(document_id: str, token: str) -> RAGPipeline | None:
    filename, file_data_b64 = fetch_document_backup(document_id, token)
    if not filename or not file_data_b64:
        return None

    ext = Path(filename).suffix.lower()
    saved_path = UPLOAD_DIR / f"{document_id}{ext}"
    saved_path.write_bytes(base64.b64decode(file_data_b64))
    return _build_index(document_id, saved_path, filename)


def _get_pipeline(document_id: str, token: str | None = None) -> RAGPipeline:
    if document_id in loaded_pipelines:
        return loaded_pipelines[document_id]

    vector_store_path = VECTOR_STORE_DIR / document_id

    if not vector_store_path.exists() and token:
        try:
            pipeline = _rebuild_index_from_backup(document_id, token)
            if pipeline:
                return pipeline
        except Exception as rebuild_err:
            print(f"Failed to rebuild index for {document_id}: {rebuild_err}")

    try:
        pipeline = _load_local_index(document_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load vector index: {exc}") from exc

    if not pipeline:
        raise HTTPException(
            status_code=404,
            detail="Document index not found on backend. Please re-upload the document.",
        )

    return pipeline


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/config")
async def get_config():
    return {
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", ""),
    }


@app.post("/upload")
async def upload_file(
    document_id: str,
    file: UploadFile = File(...)
):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Supported formats: PDF, Word, Text, CSV, Excel, PowerPoint",
        )

    saved_path = UPLOAD_DIR / f"{document_id}{ext}"
    vector_store_path = VECTOR_STORE_DIR / document_id

    try:
        save_uploaded_file(file.file, saved_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    try:
        _build_index(document_id, saved_path, file.filename)
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        delete_local_document(document_id)
        raise HTTPException(status_code=500, detail=f"Failed to index document: {e}")

    return {
        "document_id": document_id,
        "filename": file.filename,
        "file_path": f"uploads/{document_id}{ext}",
        "vector_store_path": f"uploads/vector_stores/{document_id}",
        "message": "Document indexed successfully on backend!",
    }


@app.post("/ask")
async def ask_question(req: QuestionRequest):
    pipeline = _get_pipeline(req.document_id, req.token)

    try:
        return pipeline.ask(req.question)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate answer: {e}")


@app.delete("/document/{document_id}")
async def delete_document(document_id: str):
    loaded_pipelines.pop(document_id, None)
    delete_local_document(document_id)
    return {"message": "Document files deleted from backend."}
