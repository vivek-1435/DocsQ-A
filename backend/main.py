import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables at the very first step
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from supabase import create_client, Client

from rag_pipeline import RAGPipeline

app = FastAPI(title="Stateless RAG Document Q&A API", version="2.5.0")

# Initialize Supabase client
supabase_url = os.getenv("SUPABASE_URL", "").strip()
supabase_anon_key = os.getenv("SUPABASE_ANON_KEY", "").strip()

# Sanitize URL if needed
if supabase_url:
    supabase_url = supabase_url.replace("/rest/v1", "").rstrip("/")

supabase_client: Client = None
if supabase_url and supabase_anon_key:
    try:
        supabase_client = create_client(supabase_url, supabase_anon_key)
        print("✅ Backend Supabase client initialized successfully!")
    except Exception as init_err:
        print(f"⚠️ Failed to initialize backend Supabase client: {init_err}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

VECTOR_STORE_DIR = UPLOAD_DIR / "vector_stores"
VECTOR_STORE_DIR.mkdir(exist_ok=True)

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

    # save raw file bytes
    try:
        with open(saved_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
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
        if vector_store_path.exists():
            shutil.rmtree(vector_store_path)
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
        if not vector_store_path.exists() and supabase_client and req.token:
            print(f"🔄 Vector store for {document_id} is missing from backend disk. Attempting auto-rebuild from database...")
            try:
                # Clone the client state and set postgrest auth header with the user's JWT
                supabase_client.postgrest.auth(req.token)
                
                # Fetch filename and raw file data (base64 string) from Supabase
                res = supabase_client.table("documents").select("filename, file_data").eq("id", document_id).execute()
                
                if res.data:
                    doc_record = res.data[0]
                    filename = doc_record.get("filename")
                    file_data_b64 = doc_record.get("file_data")
                    
                    if file_data_b64:
                        import base64
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

    # delete raw files
    for p in UPLOAD_DIR.glob(f"{document_id}.*"):
        p.unlink(missing_ok=True)

    # delete vector stores
    vector_store_path = VECTOR_STORE_DIR / document_id
    if vector_store_path.exists():
        shutil.rmtree(vector_store_path)

    return {"message": "Document files deleted from backend."}
