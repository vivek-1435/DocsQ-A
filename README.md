# Ειδήμονας — AI Document Intelligence Q&A

Have you ever opened a massive 50-page PDF or a dense Word document, pressed Cmd + F, and still couldn't find the exact detail you were looking for? We've all been there. 

Ειδήμονας is a document assistant that reads, indexes, and understands your documents in seconds. Powered by Retrieval-Augmented Generation (RAG) and Google Gemini, Ειδήμονας lets you have a natural conversation with any document—whether it's a resume, a legal contract, a financial statement, or a technical manual.

Instead of just matching keywords, Ειδήμονας understands the context of your questions. You can ask it to summarize complex themes, compare different sections, or even ask subjective questions like "which project or section is the most impressive?"—and get a fully grounded, sub-second response with exact source citations.

---

## What Makes Ειδήμονας Special?

* **Sub-Second Answers**  
  We swapped the backend model to gemini-2.5-flash-lite and disabled heavy thinking modes. Answers generate in under 1.5 seconds instead of the typical 40+ seconds.
* **Domain-Agnostic Intelligence**  
  Ειδήμονας is built for any document. Whether you upload a standard resume, a business report, a legal lease agreement, or a user guide, it automatically adapts its tone and structure to give you the most relevant analysis.
* **Factual Grounding**  
  We implemented strict grounding rules so that the AI never invents details or assumes facts. If a detail isn't in your document, Ειδήμονας will politely let you know rather than guessing.
* **Clickable Sources and Page Citations**  
  Every answer is backed up by exact passages from your document. Simply click any source badge in the chat window to expand and inspect the exact context used.
* **Premium Glassmorphism UI**  
  A modern, responsive dark-glass UI that looks stunning in any browser, complete with interactive drag-and-drop zones, real-time index progress tracking, and toast alerts.

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

### 1. Deploy the Backend to Render
1. Create a free account at **[Render](https://render.com/)**.
2. Click **New** -> **Blueprint**.
3. Select your GitHub repository. Render will automatically parse the `render.yaml` configuration at the root of the project and provision the FastAPI web service.
4. When prompted, add the `GEMINI_API_KEY` environment variable with your Google Gemini API Key.
5. Apply the blueprint. Once active, copy the backend URL provided by Render (e.g., `https://docs-qa-backend.onrender.com`).

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

1. Upload your file via the sidebar drag-and-drop or the file selector. Supports .pdf, .docx, and .doc up to 50MB.
2. Watch the real-time index bar build a FAISS vector index of your document (takes 1–2 seconds).
3. Ask anything in the chat input:
   * Direct queries: "What are the core requirements listed in section 3?"
   * Summaries: "Can you summarize the major objectives of this document?"
   * Synthesized analysis: "Based on the descriptions, compare option A and option B."
4. Click on any Source Citation card under the answer to inspect the exact document snippet that backed up the AI's reasoning.

---

## Session and Safety Notes

* In-Memory Sessions: All document indexes and upload caches are held in-memory for security. If you restart the backend, active sessions are cleared and files will need to be re-uploaded.
* Privacy First: Your files stay on your local backend server and are processed locally in FAISS. Only processed text chunks are sent securely to Google's Gemini API to generate the final answers.
