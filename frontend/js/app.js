import {
  uploadZone, fileInput, docList, chatSubtitle, welcomeScreen,
  messagesList, questionInput, sendBtn,
  authTitle, authSubtitle, authSubmitBtn, authToggleBtn, authToggleText,
  authForm, authErrorMsg, userProfile, userEmail, userAvatar, signOutBtn,
  menuToggleBtn, sidebar, sidebarOverlay,
  showToast, showAuthModal, closeAuthModal, setInputEnabled,
  scrollToBottom, resetInputHeight, growInput,
} from "./ui.js";
import { getClient, getUser, initSupabase, signIn, signUp, signOut, onAuthChange, getToken } from "./auth.js";
import { checkHealth, fetchConfig, uploadFile, askQuestion, deleteDocument } from "./api.js";
import { appendMessage, appendTyping, removeTyping, resetMessageCount, escapeHTML } from "./chat.js";

const ALLOWED_TYPES = [".pdf", ".docx", ".txt", ".csv", ".xlsx", ".pptx"];
const MAX_MB = 50;

const AUTH = {
  signin: { title: "Welcome Back",    subtitle: "Sign in to resume document Q&A", submit: "Sign In",  toggle: "Create Account", hint: "Don't have an account?" },
  signup: { title: "Create Account",  subtitle: "Sign up for a free workspace",   submit: "Sign Up",  toggle: "Sign In",         hint: "Already have an account?" },
};

let activeDocId   = null;
let activeName    = "";
let busy          = false;
const pending     = new Map();  // docId → { id, filename, created_at } for in-progress uploads

const newId = () => crypto.randomUUID?.() ??
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

// ── Auth mode ─────────────────────────────────────────────────────────────────
let authMode = "signin";
function setAuthMode(mode) {
  authMode = mode;
  const m = AUTH[mode];
  authErrorMsg.style.display = "none";
  authTitle.textContent      = m.title;
  authSubtitle.textContent   = m.subtitle;
  authSubmitBtn.textContent  = getClient() ? m.submit : "Connecting…";
  authToggleText.textContent = m.hint;
  authToggleBtn.textContent  = m.toggle;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initApp() {
  try {
    await checkHealth();
    const cfg = await fetchConfig();
    if (!cfg.supabase_url || !cfg.supabase_anon_key)
      throw new Error("Supabase credentials missing in backend .env.");

    initSupabase(cfg.supabase_url, cfg.supabase_anon_key);
    authSubmitBtn.disabled = false;
    setAuthMode("signin");

    onAuthChange((_e, session) => {
      if (session) {
        userEmail.textContent  = session.user.email;
        userAvatar.textContent = session.user.email[0].toUpperCase();
        userProfile.style.display = "flex";
        closeAuthModal();
        loadDocumentList();
      } else {
        userProfile.style.display = "none";
        resetSession();
        showAuthModal();
      }
    });
  } catch (err) {
    console.error(err);
    showToast(`Init failed: ${err.message}`, "error");
    authErrorMsg.textContent   = `${err.message} — check your backend .env and ensure port 8000 is running.`;
    authErrorMsg.style.display = "block";
    authSubmitBtn.disabled     = true;
    authSubmitBtn.textContent  = "Configuration Required";
  }
}

initApp();

// ── Auth events ───────────────────────────────────────────────────────────────
authToggleBtn.addEventListener("click", (e) => { e.preventDefault(); setAuthMode(authMode === "signin" ? "signup" : "signin"); });

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!getClient()) { showToast("Supabase not ready. Check backend .env.", "error"); return; }
  const email = document.getElementById("authEmail").value.trim();
  const pass  = document.getElementById("authPassword").value;
  try {
    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = authMode === "signin" ? "Signing In…" : "Signing Up…";
    if (authMode === "signin") {
      await signIn(email, pass);
      showToast("Signed in!", "success");
      closeAuthModal();
    } else {
      await signUp(email, pass);
      showToast("Account created! Check your email.", "success");
      setAuthMode("signin");
    }
  } catch (err) {
    authErrorMsg.textContent   = err.message;
    authErrorMsg.style.display = "block";
  } finally {
    authSubmitBtn.disabled    = false;
    authSubmitBtn.textContent = AUTH[authMode].submit;
  }
});

signOutBtn.addEventListener("click", async () => {
  try { await signOut(); } catch (err) { showToast(`Sign out failed: ${err.message}`, "error"); }
});

// ── Drag & drop ───────────────────────────────────────────────────────────────
uploadZone.addEventListener("dragenter", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
uploadZone.addEventListener("dragover",  (e) => e.preventDefault());
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
  if (!getUser()) { showToast("Sign in to upload files.", "error"); showAuthModal(); return; }
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener("change", () => {
  if (!getUser()) { showToast("Sign in to upload files.", "error"); showAuthModal(); return; }
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  const ext = "." + file.name.split(".").pop().toLowerCase();
  if (!ALLOWED_TYPES.includes(ext)) { showToast("Unsupported type. Use PDF, TXT, CSV, Excel, Word, or PPTX.", "error"); return; }
  if (file.size > MAX_MB * 1024 * 1024) { showToast(`Max file size is ${MAX_MB} MB.`, "error"); return; }
  processUpload(file);
}

// ── Upload ────────────────────────────────────────────────────────────────────
const toBase64 = (file) => new Promise((res, rej) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload  = () => res(reader.result.split(",")[1]);
  reader.onerror = rej;
});

async function processUpload(file) {
  const docId = newId();
  pending.set(docId, { id: docId, filename: file.name, created_at: new Date().toISOString() });
  activeDocId  = docId;
  activeName   = file.name;
  renderDocs();
  selectDoc(docId, file.name);
  fileInput.value = "";

  const form = new FormData();
  form.append("file", file);

  // Fire-and-forget so UI stays responsive
  (async () => {
    try {
      const b64 = toBase64(file).catch(() => "");
      const token  = await getToken();
      const result = await uploadFile(docId, form, token);

      await getClient().from("documents").insert({
        id: docId, user_id: getUser().id, filename: file.name,
        vector_store_path: result.vector_store_path, file_data: null,
      });

      showToast(`"${file.name}" indexed!`, "success");
      pending.delete(docId);
      await loadDocumentList();
      if (activeDocId === docId) selectDoc(docId, file.name);

      // Background base64 backup
      const data = await b64;
      if (data) {
        getClient().from("documents").update({ file_data: data }).eq("id", docId)
          .then(({ error }) => error && console.warn("Backup failed:", error));
      }
    } catch (err) {
      console.error(`Upload failed for "${file.name}":`, err);
      showToast(`Failed to index "${file.name}": ${err.message}`, "error");
      pending.delete(docId);
      await loadDocumentList();
      if (activeDocId === docId) resetSession();
    }
  })();
}

// ── Document list ─────────────────────────────────────────────────────────────
function renderDocs(dbDocs = []) {
  const docs = [
    ...[...pending.values()].map(d => ({ ...d, isPending: true })),
    ...dbDocs.filter(d => !pending.has(d.id)).map(d => ({ ...d, isPending: false })),
  ];

  if (!docs.length) { docList.innerHTML = '<p class="doc-list-empty">No documents uploaded yet.</p>'; return; }

  docList.innerHTML = "";
  docs.forEach(doc => {
    const el = document.createElement("div");
    el.className  = `doc-item${doc.id === activeDocId ? " active" : ""}`;
    el.dataset.id = doc.id;
    const name = escapeHTML(doc.filename);
    const ext  = escapeHTML(doc.filename.split(".").pop().toUpperCase());

    if (doc.isPending) {
      el.classList.add("temp-indexing");
      el.innerHTML = `<div class="doc-icon-wrap"><div class="indexing-spinner"></div></div>
        <div class="doc-info"><span class="doc-name">${name}</span><span class="doc-meta">Indexing…</span></div>`;
    } else {
      el.innerHTML = `<div class="doc-icon-wrap"><span class="doc-ext">${ext}</span></div>
        <div class="doc-info">
          <span class="doc-name">${name}</span>
          <span class="doc-meta">${new Date(doc.created_at).toLocaleDateString()}</span>
        </div>
        <button class="btn-doc-delete" title="Delete">
          <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </button>`;
      el.querySelector(".btn-doc-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${doc.filename}"? This removes all chat history.`)) removeDoc(doc.id);
      });
    }

    el.addEventListener("click", (e) => { if (!e.target.closest(".btn-doc-delete")) selectDoc(doc.id, doc.filename); });
    docList.appendChild(el);
  });
}

async function loadDocumentList() {
  const db = getClient();
  if (!db) return;
  try {
    const { data, error } = await db.from("documents")
      .select("id, filename, vector_store_path, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    renderDocs(data || []);
  } catch (err) {
    docList.innerHTML = `<p class="doc-list-empty error-text">Failed to load: ${escapeHTML(err.message)}</p>`;
  }
}

// ── Document selection ────────────────────────────────────────────────────────
async function selectDoc(docId, filename) {
  activeDocId  = docId;
  activeName   = filename;
  document.querySelectorAll(".doc-item").forEach(el => el.classList.toggle("active", el.dataset.id === docId));
  chatSubtitle.textContent    = `Active: ${filename}${pending.has(docId) ? " (Indexing…)" : ""}`;
  welcomeScreen.style.display = "none";
  setInputEnabled(true, docId);

  if (pending.has(docId)) {
    messagesList.innerHTML = `<div class="indexing-chat-status">
      <div class="indexing-spinner inline"></div>
      <span>Analyzing document… start typing your questions.</span>
    </div>`;
    return;
  }

  messagesList.innerHTML = '<p class="doc-list-empty">Loading history…</p>';
  try {
    const { data, error } = await getClient().from("chat_messages")
      .select("*").eq("document_id", docId).order("created_at", { ascending: true });
    if (error) throw error;
    messagesList.innerHTML = "";
    if (data?.length) {
      data.forEach(m => appendMessage(m.role, m.content, m.sources, new Date(m.created_at)));
    } else {
      appendMessage("assistant", `Hi! I've loaded **${filename}**. Ask me anything about its content.`, [], new Date());
    }
    scrollToBottom();
  } catch (err) {
    messagesList.innerHTML = "";
    appendMessage("assistant", `Could not load history: ${err.message}`, [], new Date());
  }
}

// ── Delete document ───────────────────────────────────────────────────────────
async function removeDoc(docId) {
  const el = document.querySelector(`.doc-item[data-id="${docId}"]`);
  if (el) {
    el.style.cssText = "transition:all .3s ease;opacity:0;transform:translateX(-20px)";
    setTimeout(() => { el.remove(); if (!docList.querySelector(".doc-item")) renderDocs(); }, 300);
  }
  if (activeDocId === docId) resetSession();
  try {
    const token = await getToken();
    await deleteDocument(docId, token);
    await getClient().from("documents").delete().eq("id", docId);
    showToast("Document deleted.", "success");
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, "error");
    loadDocumentList();
  }
}

// ── Send question ─────────────────────────────────────────────────────────────
async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!question || busy || !activeDocId) return;
  if (pending.has(activeDocId)) { showToast("Wait for indexing to finish.", "error"); return; }

  busy = true;
  setInputEnabled(false, activeDocId);
  appendMessage("user", question, [], new Date());
  questionInput.value = "";
  resetInputHeight();

  const typingId = appendTyping();
  try {
    const db    = getClient();
    const user  = getUser();
    const token = await getToken();

    await db.from("chat_messages").insert({ document_id: activeDocId, user_id: user.id, role: "user", content: question, sources: [] });

    const { answer, sources } = await askQuestion(activeDocId, question, token);
    removeTyping(typingId);
    appendMessage("assistant", answer, sources, new Date());

    await db.from("chat_messages").insert({ document_id: activeDocId, user_id: user.id, role: "assistant", content: answer, sources });
  } catch (err) {
    removeTyping(typingId);
    appendMessage("assistant", err.message, [], new Date());
    console.error(err);
  } finally {
    busy = false;
    setInputEnabled(true, activeDocId);
    questionInput.focus();
  }
}

sendBtn.addEventListener("click", sendQuestion);
questionInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(); } });
questionInput.addEventListener("input", growInput);

// ── Reset session ─────────────────────────────────────────────────────────────
function resetSession() {
  activeDocId  = null;
  activeName   = "";
  docList.innerHTML = '<p class="doc-list-empty">No active workspace. Please sign in.</p>';
  chatSubtitle.textContent    = "Sign in to get started";
  welcomeScreen.style.display = "flex";
  messagesList.innerHTML      = "";
  resetMessageCount();
  setInputEnabled(false, null);
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────
if (menuToggleBtn && sidebar && sidebarOverlay) {
  const openSidebar  = () => { sidebar.classList.add("open"); sidebarOverlay.classList.add("show"); };
  const closeSidebar = () => { sidebar.classList.remove("open"); sidebarOverlay.classList.remove("show"); };
  menuToggleBtn.addEventListener("click", openSidebar);
  sidebarOverlay.addEventListener("click", closeSidebar);
  docList.addEventListener("click", (e) => {
    if (window.innerWidth <= 768 && e.target.closest(".doc-item") && !e.target.closest(".btn-doc-delete")) closeSidebar();
  });
}

// ── Mobile keyboard viewport fix ──────────────────────────────────────────────
if (window.visualViewport) {
  const syncHeight = () => {
    document.documentElement.style.setProperty("--viewport-height", `${window.visualViewport.height}px`);
    if (document.activeElement === questionInput) setTimeout(scrollToBottom, 50);
  };
  window.visualViewport.addEventListener("resize", syncHeight);
  window.visualViewport.addEventListener("scroll", syncHeight);
  syncHeight();
}
questionInput.addEventListener("focus", () => setTimeout(scrollToBottom, 150));
