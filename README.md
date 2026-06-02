# Ειδήμονας — AI Document Intelligence Q&A

Have you ever opened a massive 50-page PDF or a dense Word document, pressed Cmd + F, and still couldn't find the exact detail you were looking for? We've all been there. 

Ειδήμονας is a document assistant that reads, indexes, and understands your documents in seconds. Powered by Retrieval-Augmented Generation (RAG) and Google Gemini, Ειδήμονας lets you have a natural conversation with any document—whether it's a resume, a legal contract, a financial statement, or a technical manual.

Instead of just matching keywords, Ειδήμονας understands the context of your questions. You can ask it to summarize complex themes, compare different sections, or even ask subjective questions like "which project or section is the most impressive?"—and get a fully grounded, sub-second response with exact source citations.

---

## What Makes Ειδήμονας Special?

* **Sub-Second Answers**  
  Powered by `gemini-2.5-flash-lite` for ultra-fast, domain-agnostic reasoning, returning fully-grounded answers with source citations in under 1.5 seconds.
* **Parallel & Adaptive Background Ingestion**  
  Indexes small files in under a second and massive files (like a 16.76 MB CSV containing 100,000+ rows) in under 20 seconds. Uses ThreadPoolExecutor parallel embeddings, pacing delays, and randomized jitter retries to handle huge datasets without rate limit issues.
* **Scanned PDF Fallback (Gemini OCR)**  
  Automatically detects scanned or image-only documents and uses Gemini's multimodal capabilities to transcribe and index them with complete precision.
* **Factual Grounding**  
  Strict grounding prevents hallucinations. If the details aren't in your document, the assistant politely lets you know.
* **Clickable Sources and Page Citations**  
  Every answer is backed up by exact passages from your document. Simply click any source badge in the chat window to inspect the exact context used.
* **Auto-Healing Cloud Backups**  
  Uses Supabase persistent storage. If a backend server restarts or hibernates, the system automatically auto-heals by downloading the document backup and reconstructing the FAISS vector index on-the-fly.
* **Premium Glassmorphic UI**  
  A modern, responsive dark-glass UI with non-blocking upload slots, drag-and-drop zones, real-time background index progress bars, and mobile-responsive drawer drawers.

---

## The Tech Stack Behind the Magic

We kept the architecture lightweight, modern, and highly modular:

| Layer | Component | Purpose |
| :--- | :--- | :--- |
| Frontend | HTML5 + CSS3 + Vanilla JS | Pure ES6 web components; no complex build tools or Node.js packaging required. |
| Backend | Python FastAPI + Uvicorn | High-performance, asynchronous REST API layer. |
| RAG Orchestrator | LangChain (Modern LCEL) | Systematized runnables passing document context to prompts cleanly. |
| Vector DB | FAISS (Facebook AI Similarity Search) | Ultra-fast local in-memory vector indexing and semantic search. |
| Embeddings | Gemini (models/gemini-embedding-001) | Dense vector representations of text chunks. |
| Language Model | Gemini (models/gemini-2.5-flash-lite) | Domain-agnostic, ultra-fast reasoning engine. |

---

## Project Architecture

```
RagPdfView/
├── backend/
│   ├── main.py            ← FastAPI entrypoint & sessions controller
│   ├── rag_pipeline.py    ← RAG pipeline core (embed, store, retrieve, answer)
│   ├── requirements.txt   ← Python backend dependencies
│   ├── .env               ← Active environment variables (API Key)
│   └── uploads/           ← Stores uploaded files (auto-created)
└── frontend/
    ├── index.html         ← Premium Dark-Glass UI
    ├── style.css          ← Responsive glassmorphism styling
    └── app.js             ← Frontend API connector & chat rendering
```

---

## Setting Up Your Local Workspace (3-Step Guide)

Getting Ειδήμονας running locally takes less than 2 minutes. Let's get started!

### Step 1: Add Your Gemini API Key
Create a .env file inside the backend/ directory:
```env
GEMINI_API_KEY=your_actual_api_key_here
```
> Need a key? Grab a free one instantly from aistudio.google.com/apikey.

### Step 2: Install the Backend Dependencies
Set up your Python virtual environment and install the required libraries:
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Step 3: Start the Backend Server
Fire up the FastAPI development server:
```bash
uvicorn main:app --reload --port 8000
```
* Backend Live at: http://localhost:8000
* Interactive API docs: http://localhost:8000/docs

### Step 4: Open the Web UI
Since the frontend has no Node.js dependencies or build steps, you can open it directly in your browser:
```bash
open frontend/index.html        # macOS
# or simply double-click index.html in Finder/File Explorer
```

---

## Deploying to Production (Render & Vercel)

Ειδήμονας is designed to be hosted in the cloud with the backend served from Render and the frontend served from Vercel.

### 1. Deploy the Backend to Render (as a Web Service)
1. Create a free account at **[Render](https://render.com/)**.
2. Click **New** -> **Web Service**.
3. Connect your GitHub repository.
4. Set the following options in the configuration form:
   * **Name**: `docs-qa-backend`
   * **Language/Runtime**: `Python`
   * **Root Directory**: `backend`
   * **Build Command**: `pip install -r requirements.txt`
   * **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Click **Advanced** -> **Add Environment Variable** and define:
   * **`PYTHON_VERSION`**: `3.11.0`
   * **`GEMINI_API_KEY`**: `your_gemini_api_key_here`
6. Click **Create Web Service**. Once deployed, copy the provided Web Service URL (e.g., `https://docs-qa-backend.onrender.com`).

### 2. Connect the Frontend
1. Open `frontend/app.js` and locate `API_BASE` at the top of the file:
   ```javascript
   const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
     ? 'http://localhost:8000'
     : 'https://docs-qa-backend.onrender.com';
   ```
2. Replace `'https://docs-qa-backend.onrender.com'` with your actual Render URL.
3. Commit and push the changes to GitHub.

### 3. Deploy the Frontend to Vercel
1. Create a free account at **[Vercel](https://vercel.com/)**.
2. Click **Add New** -> **Project** and select your GitHub repository.
3. In the project configuration settings, set the **Root Directory** to `frontend`.
4. Click **Deploy**. Vercel will build and host the static files instantly.

---

## How to Interact with Ειδήμονας

1. Upload your file via the sidebar drag-and-drop or the file selector. Supports `.pdf`, `.docx`, `.txt`, `.csv`, `.xlsx`, and `.pptx` up to 50MB.
2. Watch the real-time sidebar progress spinner index your document asynchronously in the background. You can draft questions immediately!
3. Ask anything in the chat input:
   * Direct queries: "What are the core requirements listed in section 3?"
   * Summaries: "Can you summarize the major objectives of this document?"
   * Synthesized analysis: "Based on the descriptions, compare option A and option B."
4. Click on any Source Citation card under the answer to inspect the exact document snippet that backed up the AI's reasoning.

---

## Session and Safety Notes

* **Persistent Backups & Auto-Healing**: Document metadata and base64 backups are stored securely in your Supabase database. If the backend server hibernates or restarts (typical of free-tier cloud hosting like Render), the backend will automatically and silently rebuild the FAISS vector index from the database backup upon your next query.
  * *Note for Large Files*: If you are working with extremely large documents (> 10MB), fetching the base64 backup from the database may hit PostgreSQL's default PostgREST statement timeout. To prevent this, run the following SQL command in your Supabase SQL Editor:
    ```sql
    alter role authenticator set statement_timeout = '60s';
    alter role anon set statement_timeout = '60s';
    alter role authenticated set statement_timeout = '60s';
    ```
* **Privacy First**: Your files are stored securely and processed using in-memory FAISS indexing. Only relevant retrieved context chunks are sent to Google's Gemini API to synthesize answers.
