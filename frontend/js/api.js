import { API_BASE } from "./config.js";

// Backend health check
export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error("RAG Server is unresponsive");
  return res.json();
}

// Fetch dynamic Supabase config from backend .env
export async function fetchBackendConfig() {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error("Failed to load backend config");
  return res.json();
}

// Upload file to stateless backend
export async function uploadToBackend(documentId, formData) {
  const res = await fetch(`${API_BASE}/upload?document_id=${documentId}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || "RAG indexing failed");
  }
  return res.json();
}

// Send user question & active token to RAG pipeline ask endpoint
export async function askBackendQuestion(documentId, question, token) {
  const res = await fetch(`${API_BASE}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document_id: documentId,
      question: question,
      token: token,
    }),
  });
  
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || "Failed to generate answer");
  }
  return res.json();
}

// Remove document index files from backend disk
export async function deleteBackendDocument(documentId) {
  const res = await fetch(`${API_BASE}/document/${documentId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Backend file delete failed");
  return res.json();
}
