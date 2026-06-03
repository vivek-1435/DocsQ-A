import logging
import shutil
import tempfile
import zipfile
from pathlib import Path

from database import admin_client, db

log = logging.getLogger(__name__)
BUCKET = "vector-stores"


def _get_client():
    return admin_client or db


def _ensure_bucket() -> bool:
    client = _get_client()
    if not client:
        return False
    try:
        names = [b.name for b in client.storage.list_buckets()]
        if BUCKET not in names:
            client.storage.create_bucket(BUCKET, options={"public": False})
        return True
    except Exception as err:
        log.warning("Could not ensure bucket: %s", err)
        return False


def save_index(index_folder: str, doc_id: str) -> bool:
    client = _get_client()
    if not client or not _ensure_bucket():
        return False
    folder = Path(index_folder)
    if not folder.exists():
        return False
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            tmp = f.name
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in folder.glob("**/*"):
                if p.is_file():
                    zf.write(p, arcname=p.relative_to(folder))
        with open(tmp, "rb") as f:
            client.storage.from_(BUCKET).upload(f"{doc_id}/index.zip", f, file_options={"content-type": "application/zip"})
        log.info("Index saved for %s.", doc_id)
        return True
    except Exception as err:
        log.error("Failed to save index for %s: %s", doc_id, err)
        return False
    finally:
        if tmp:
            Path(tmp).unlink(missing_ok=True)


def load_index(doc_id: str) -> str | None:
    client = _get_client()
    if not client:
        return None
    tmp = temp_dir = None
    try:
        data = client.storage.from_(BUCKET).download(f"{doc_id}/index.zip")
        temp_dir = tempfile.mkdtemp()
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            f.write(data)
            tmp = f.name
        with zipfile.ZipFile(tmp, "r") as zf:
            zf.extractall(temp_dir)
        log.info("Index loaded for %s.", doc_id)
        return temp_dir
    except Exception as err:
        log.error("Failed to load index for %s: %s", doc_id, err)
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
        return None
    finally:
        if tmp:
            Path(tmp).unlink(missing_ok=True)


def delete_index(doc_id: str) -> None:
    client = _get_client()
    if not client:
        return
    try:
        client.storage.from_(BUCKET).remove([f"{doc_id}/index.zip"])
        log.info("Index deleted for %s.", doc_id)
    except Exception as err:
        log.error("Failed to delete index for %s: %s", doc_id, err)
