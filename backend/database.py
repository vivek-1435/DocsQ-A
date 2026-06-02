import os
from supabase import create_client, Client

# Initialize Supabase client
supabase_url = os.getenv("SUPABASE_URL", "").strip()
supabase_anon_key = os.getenv("SUPABASE_ANON_KEY", "").strip()

if supabase_url:
    supabase_url = supabase_url.replace("/rest/v1", "").rstrip("/")

supabase_client: Client = None
if supabase_url and supabase_anon_key:
    try:
        supabase_client = create_client(supabase_url, supabase_anon_key)
        print("✅ Backend Supabase client initialized successfully!")
    except Exception as init_err:
        print(f"⚠️ Failed to initialize backend Supabase client: {init_err}")

def fetch_document_backup(document_id: str, token: str) -> tuple[str | None, str | None]:
    """
    Fetches the filename and base64 encoded file data for a document from Supabase.
    Authenticates the PostgREST client session using the user's active JWT session token.
    """
    if not supabase_client or not token:
        return None, None

    try:
        # Set user session JWT context
        supabase_client.postgrest.auth(token)
        
        res = supabase_client.table("documents").select("filename, file_data").eq("id", document_id).execute()
        if res.data:
            doc_record = res.data[0]
            return doc_record.get("filename"), doc_record.get("file_data")
    except Exception as err:
        print(f"⚠️ Failed to fetch document backup for {document_id} from database: {err}")
        
    return None, None
