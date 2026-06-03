import logging
import os

from supabase import create_client, Client

log = logging.getLogger(__name__)

url = os.getenv("SUPABASE_URL", "").strip().replace("/rest/v1", "").rstrip("/")
anon_key = os.getenv("SUPABASE_ANON_KEY", "").strip()
service_key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()

db: Client = None
admin_client: Client = None

if url and anon_key:
    try:
        db = create_client(url, anon_key)
    except Exception as err:
        log.error("Supabase anon client failed: %s", err)

if url and service_key:
    try:
        admin_client = create_client(url, service_key)
    except Exception as err:
        log.warning("Supabase service client failed: %s", err)


def verify_token(token: str) -> str | None:
    """Verify a Supabase JWT. Returns user_id on success, None on failure."""
    client = admin_client or db
    if not client:
        return None
    try:
        resp = client.auth.get_user(token)
        if resp and resp.user:
            return resp.user.id
    except Exception as err:
        log.warning("Token verification failed: %s", err)
    return None


def fetch_document_backup(doc_id: str, token: str) -> tuple[str | None, str | None]:
    """Fetch filename + base64 file_data from Supabase under the user's RLS context."""
    if not db or not token:
        return None, None
    try:
        db.postgrest.auth(token)
        res = db.table("documents").select("filename, file_data").eq("id", doc_id).execute()
        if res.data:
            row = res.data[0]
            return row.get("filename"), row.get("file_data")
    except Exception as err:
        log.error("Fetch backup failed for %s: %s", doc_id, err)
    return None, None


def fetch_document_name(doc_id: str) -> str | None:
    """Fetch filename by doc_id bypassing RLS using the admin client."""
    client = admin_client or db
    if not client:
        return None
    try:
        res = client.table("documents").select("filename").eq("id", doc_id).execute()
        if res.data:
            return res.data[0].get("filename")
    except Exception as err:
        log.error("Fetch document name failed for %s: %s", doc_id, err)
    return None
