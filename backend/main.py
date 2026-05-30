import uuid
import shutil
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from rag_pipeline import RAGPipeline

# load environment variables
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

app = FastAPI(title="RAG Document Q&A API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}
sessions: dict[str, dict] = {}


class QuestionRequest(BaseModel):
    session_id: str
    question: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Please upload a PDF or Word (.docx) document.",
        )

    session_id = str(uuid.uuid4())
    saved_path = UPLOAD_DIR / f"{session_id}{ext}"

    # save raw file bytes
    try:
        with open(saved_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # initialize and run rag pipeline
    try:
        pipeline = RAGPipeline()
        pipeline.process_document(str(saved_path), original_name=file.filename)
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to process document: {e}")

    sessions[session_id] = {
        "pipeline": pipeline,
        "filename": file.filename,
        "file_path": str(saved_path),
    }

    return {
        "session_id": session_id,
        "filename": file.filename,
        "message": "Document processed successfully. You can now ask questions!",
    }


@app.post("/ask")
async def ask_question(req: QuestionRequest):
    if req.session_id not in sessions:
        raise HTTPException(
            status_code=404,
            detail="Session not found. Please upload a document first.",
        )

    pipeline: RAGPipeline = sessions[req.session_id]["pipeline"]

    try:
        result = pipeline.ask(req.question)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate answer: {e}")

    return result


@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    if session_id in sessions:
        fp = Path(sessions[session_id]["file_path"])
        fp.unlink(missing_ok=True)
        del sessions[session_id]
    return {"message": "Session deleted successfully."}


@app.get("/sessions")
async def list_sessions():
    return [
        {"session_id": sid, "filename": meta["filename"]}
        for sid, meta in sessions.items()
    ]
