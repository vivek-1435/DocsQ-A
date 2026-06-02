import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables at the very first step
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

import base64
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import custom modular components
from file_utils import UPLOAD_DIR, VECTOR_STORE_DIR, save_uploaded_file, delete_local_document
from database import fetch_document_backup
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

# In-memory pipeline cache for fast sub-second queries
loaded_pipelines: dict[str, RAGPipeline] = {}


class QuestionRequest(BaseModel):
    document_id: str
    question: str
    token: str = None


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/config")
async def get_config():
    """
    Exposes Supabase credentials from the backend's .env file dynamically
    to the frontend to avoid duplicating credentials or hardcoding them.
    """
    return {
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", "")
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

    # save raw file bytes using file utility helper
    try:
        save_uploaded_file(file.file, saved_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # initialize, process and save vector index
    try:
        pipeline = RAGPipeline()
        pipeline.process_document(str(saved_path), original_name=file.filename)
        pipeline.save_index(str(vector_store_path))
        loaded_pipelines[document_id] = pipeline
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
    document_id = req.document_id
    pipeline = None

    if document_id in loaded_pipelines:
        pipeline = loaded_pipelines[document_id]
    else:
        # Load index on-demand from disk
        vector_store_path = VECTOR_STORE_DIR / document_id
        
        # If the local index is missing, attempt to reconstruct it from the Supabase backup
        if not vector_store_path.exists() and req.token:
            print(f"🔄 Vector store for {document_id} is missing from backend disk. Attempting auto-rebuild from database...")
            try:
                # Fetch filename and raw file data (base64 string) from Supabase via database module
                filename, file_data_b64 = fetch_document_backup(document_id, req.token)
                
                if file_data_b64:
                    file_bytes = base64.b64decode(file_data_b64)
                    ext = Path(filename).suffix.lower()
                    saved_path = UPLOAD_DIR / f"{document_id}{ext}"
                    
                    # Write raw file back to disk
                    with open(saved_path, "wb") as f:
                        f.write(file_bytes)
                        
                    # Process and reconstruct vector store
                    pipeline = RAGPipeline()
                    pipeline.process_document(str(saved_path), original_name=filename)
                    pipeline.save_index(str(vector_store_path))
                    loaded_pipelines[document_id] = pipeline
                    print(f"✅ Successfully reconstructed vector index for {filename}!")
            except Exception as rebuild_err:
                print(f"⚠️ Failed to auto-reconstruct index for {document_id} from database: {rebuild_err}")

        # Try standard local load
        if not pipeline and vector_store_path.exists():
            try:
                pipeline = RAGPipeline()
                pipeline.load_index(str(vector_store_path))
                loaded_pipelines[document_id] = pipeline
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to load vector index: {e}")

        # If still missing, inform the user
        if not pipeline:
            raise HTTPException(
                status_code=404, 
                detail="Document index not found on backend. Please re-upload the document."
            )

    try:
        result = pipeline.ask(req.question)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate answer: {e}")


@app.delete("/document/{document_id}")
async def delete_document(document_id: str):
    # clear cache
    if document_id in loaded_pipelines:
        del loaded_pipelines[document_id]

    # delete local files and vector stores from disk via file utility helper
    delete_local_document(document_id)

    return {"message": "Document files deleted from backend."}
