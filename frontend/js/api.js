import { API_BASE } from "./config.js";

const TIMEOUT_MS = 90_000;

async function request(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timed out — the server may be waking up. Try again.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const bearer = (token) => token ? { Authorization: `Bearer ${token}` } : {};

async function json(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const checkHealth       = ()                          => request(`${API_BASE}/health`).then(json);
export const fetchConfig       = ()                          => request(`${API_BASE}/config`).then(json);
export const askQuestion       = (docId, question, token)    =>
  request(`${API_BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ document_id: docId, question }),
  }).then(json);
export const uploadFile        = (docId, formData, token)    =>
  request(`${API_BASE}/upload?document_id=${docId}`, {
    method: "POST",
    headers: bearer(token),
    body: formData,
  }).then(json);
export const deleteDocument    = (docId, token)              =>
  request(`${API_BASE}/document/${docId}`, {
    method: "DELETE",
    headers: bearer(token),
  }).then(json);
