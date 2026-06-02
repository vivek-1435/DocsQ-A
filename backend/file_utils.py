import shutil
from pathlib import Path

# Setup and prepare upload directories
BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
VECTOR_STORE_DIR = UPLOAD_DIR / "vector_stores"

UPLOAD_DIR.mkdir(exist_ok=True)
VECTOR_STORE_DIR.mkdir(exist_ok=True)

def save_uploaded_file(file_obj, destination_path: Path):
    """Saves raw bytes from FastAPI's UploadFile stream directly to disk."""
    with open(destination_path, "wb") as f:
        shutil.copyfileobj(file_obj, f)

def delete_local_document(document_id: str):
    """Cleans up all local raw files and the FAISS vector index folders for a document."""
    # Delete uploaded files matching the ID (all extensions)
    for p in UPLOAD_DIR.glob(f"{document_id}.*"):
        p.unlink(missing_ok=True)

    # Delete local FAISS vector store folder
    vector_store_path = VECTOR_STORE_DIR / document_id
    if vector_store_path.exists():
        shutil.rmtree(vector_store_path)
