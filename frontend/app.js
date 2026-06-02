console.log("🚀 Ειδήμονας: app.js v10.0 loaded successfully!");

// Dynamically determine the backend API base URL
const API_BASE =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000"
    : "https://docsq-a.onrender.com";

console.log("🔗 API Base URL determined as:", API_BASE);

// ═══════════════════════════════ STATE VARIABLES ═══════════════════════════════
let supabaseClient = null;
let currentUser = null;
let activeDocumentId = null;
let isLoading = false;
let messageCount = 0;
const pendingUploads = new Map();

// UI Elements
const uploadZone = document.getElementById("uploadZone");
const fileInput = document.getElementById("fileInput");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const progressPct = document.getElementById("progressPct");
const docList = document.getElementById("docList");
const chatSubtitle = document.getElementById("chatSubtitle");
const welcomeScreen = document.getElementById("welcomeScreen");
const messagesList = document.getElementById("messagesList");
const questionInput = document.getElementById("questionInput");
const sendBtn = document.getElementById("sendBtn");
const toast = document.getElementById("toast");

const authScreen = document.getElementById("authScreen");
const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authToggleBtn = document.getElementById("authToggleBtn");
const authToggleText = document.getElementById("authToggleText");
const authForm = document.getElementById("authForm");
const authErrorMsg = document.getElementById("authErrorMsg");

const userProfile = document.getElementById("userProfile");
const userEmail = document.getElementById("userEmail");
const userAvatar = document.getElementById("userAvatar");
const signOutBtn = document.getElementById("signOutBtn");

// ═══════════════════════════════ DRAG & DROP LISTENERS ═══════════════════════════════
uploadZone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  uploadZone.classList.add("dragover");
});
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
});
uploadZone.addEventListener("dragleave", () =>
  uploadZone.classList.remove("dragover"),
);
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
  if (!currentUser) {
    showToast("Please sign in to upload files.", "error");
    showAuthModal();
    return;
  }
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  if (!currentUser) {
    showToast("Please sign in to upload files.", "error");
    showAuthModal();
    return;
  }
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// ═══════════════════════════════ AUTHENTICATION FLOW ═══════════════════════════════
let authMode = "signin";

function showAuthModal() {
  authErrorMsg.style.display = "none";
  authForm.reset();
  if (authScreen) {
    authScreen.classList.remove("hidden");
  }
}

function closeAuthModal() {
  if (authScreen) {
    authScreen.classList.add("hidden");
  }
}

// Toggle Auth mode
authToggleBtn.addEventListener("click", (e) => {
  e.preventDefault();
  console.log("🔄 Toggle Auth button clicked! Current mode was:", authMode);
  authErrorMsg.style.display = "none";
  if (authMode === "signin") {
    authMode = "signup";
    authTitle.textContent = "Create Account";
    authSubtitle.textContent = "Sign up for a free document intelligence workspace";
    authSubmitBtn.textContent = "Sign Up";
    authToggleText.textContent = "Already have an account?";
    authToggleBtn.textContent = "Sign In";
  } else {
    authMode = "signin";
    authTitle.textContent = "Welcome Back";
    authSubtitle.textContent = "Sign in to your workspace to resume document Q&A";
    authSubmitBtn.textContent = "Sign In";
    authToggleText.textContent = "Don't have an account?";
    authToggleBtn.textContent = "Create Account";
  }
});

// Submit login/signup
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  console.log("📤 Form submitted! Auth mode:", authMode);
  authErrorMsg.style.display = "none";
  
  if (!supabaseClient) {
    showToast("Supabase is not configured yet. Set credentials in backend .env.", "error");
    return;
  }

  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;

  try {
    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = authMode === "signin" ? "Signing In..." : "Signing Up...";

    let res;
    if (authMode === "signin") {
      res = await supabaseClient.auth.signInWithPassword({ email, password });
    } else {
      res = await supabaseClient.auth.signUp({ email, password });
    }

    if (res.error) throw res.error;

    if (authMode === "signup") {
      showToast("Account created successfully! Check your email to verify.", "success");
      authMode = "signin";
      authTitle.textContent = "Welcome Back";
      authSubmitBtn.textContent = "Sign In";
      authToggleText.textContent = "Don't have an account?";
      authToggleBtn.textContent = "Create Account";
    } else {
      showToast("Signed in successfully!", "success");
      closeAuthModal();
    }
  } catch (err) {
    authErrorMsg.textContent = err.message;
    authErrorMsg.style.display = "block";
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = authMode === "signin" ? "Sign In" : "Sign Up";
  }
});

signOutBtn.addEventListener("click", async () => {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
    showToast("Signed out successfully.", "");
  }
});

// ═══════════════════════════════ INITIALIZATION ═══════════════════════════════
async function initApp() {
  console.log("⚙️ Starting Ειδήμονας initialization...");
  try {
    // 1. Verify backend health
    console.log("🔍 Testing backend health at:", `${API_BASE}/health`);
    const healthRes = await fetch(`${API_BASE}/health`);
    if (!healthRes.ok) throw new Error("RAG Server is unresponsive");

    // 2. Fetch Supabase URL and Anon Key dynamically from the backend .env
    const configRes = await fetch(`${API_BASE}/config`);
    if (!configRes.ok) throw new Error("Failed to load backend config");
    
    const config = await configRes.json();
    if (!config.supabase_url || !config.supabase_anon_key) {
      throw new Error("Supabase credentials missing in backend .env file!");
    }

    // 3. Initialize Supabase Client (with robust URL sanitization to remove trailing /rest/v1/ if pasted accidentally)
    let supabaseUrl = config.supabase_url.trim();
    supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, "");
    if (supabaseUrl.endsWith("/")) {
      supabaseUrl = supabaseUrl.slice(0, -1);
    }

    console.log("⚡ Initializing Supabase client with URL:", supabaseUrl);
    supabaseClient = window.supabase.createClient(supabaseUrl, config.supabase_anon_key.trim());
    console.log("✅ Supabase client created successfully!");
    
    // 4. Bind auth observer
    supabaseClient.auth.onAuthStateChange((event, session) => {
      console.log("🔑 Supabase Auth State Change event:", event, session ? "Session active" : "No session");
      if (session) {
        currentUser = session.user;
        
        // Update User Widget
        userEmail.textContent = currentUser.email;
        userAvatar.textContent = currentUser.email.charAt(0).toUpperCase();
        userProfile.style.display = "flex";
        
        closeAuthModal();
        fetchUserDocuments();
      } else {
        currentUser = null;
        userProfile.style.display = "none";
        resetSession();
        showAuthModal();
      }
    });

  } catch (err) {
    console.error("❌ Initialization Error caught:", err);
    showToast(`⚠️ Initialization failed: ${err.message}`, "error");
    chatSubtitle.textContent = "Configuration Required (.env)";
    
    // Render persistent warning directly on the fullscreen login card!
    authErrorMsg.textContent = `⚠️ System Configuration Error: ${err.message}. Please check your backend .env file, verify that port 8000 is running, and refresh the page.`;
    authErrorMsg.style.display = "block";
    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = "Configuration Required";
  }
}

// Trigger bootup
initApp();

// ═══════════════════════════════ FILE MANAGEMENT ═══════════════════════════════
function handleFile(file) {
  const allowed = [".pdf", ".docx", ".txt", ".csv", ".xlsx", ".pptx"];
  const ext = "." + file.name.split(".").pop().toLowerCase();

  if (!allowed.includes(ext)) {
    showToast("Unsupported file type. Supported formats: PDF, Text, CSV, Excel, Word, PowerPoint.", "error");
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    showToast("File too large. Maximum size is 50 MB.", "error");
    return;
  }

  uploadFile(file);
}

// Convert a file to a Base64 string safely
const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = (error) => reject(error);
  });

async function uploadFile(file) {
  // Secure Context UUID Generator Fallback (for HTTP or IP Address access)
  const documentId = (typeof crypto.randomUUID === "function") 
    ? crypto.randomUUID() 
    : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );

  // Register in pending uploads to display instantly in the sidebar
  pendingUploads.set(documentId, {
    id: documentId,
    filename: file.name,
    created_at: new Date().toISOString()
  });

  // Instantly auto-select the document
  activeDocumentId = documentId;
  
  // Refresh sidebar to include the pending document, and select it
  await fetchUserDocuments();
  selectDocument(documentId, file.name);

  // Clear file input instantly so user can select another file if they wish
  fileInput.value = "";

  const formData = new FormData();
  formData.append("file", file);

  // Run upload, indexing, and Supabase synchronization asynchronously in the background
  (async () => {
    try {
      console.log(`⏳ Background Ingestion starting for "${file.name}" (ID: ${documentId})`);

      // Concurrently convert file to base64 and upload to backend
      const base64Promise = fileToBase64(file).catch(err => {
        console.warn("⚠️ Base64 conversion failed:", err);
        return "";
      });

      const backendPromise = fetch(`${API_BASE}/upload?document_id=${documentId}`, {
        method: "POST",
        body: formData,
      }).then(async res => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "RAG indexing failed");
        }
        return res.json();
      });

      const [data, fileDataB64] = await Promise.all([backendPromise, base64Promise]);

      // Save document metadata & base64 file data directly in Supabase
      const { error: dbErr } = await supabaseClient
        .from("documents")
        .insert({
          id: documentId,
          user_id: currentUser.id,
          filename: file.name,
          file_path: data.file_path,
          vector_store_path: data.vector_store_path,
          file_data: fileDataB64
        });

      if (dbErr) throw dbErr;

      console.log(`✅ Background Ingestion complete for "${file.name}"!`);
      showToast(`"${file.name}" indexed successfully!`, "success");

      // Remove from pending uploads since indexing is now complete and saved to DB
      pendingUploads.delete(documentId);

      // Refresh documents list from database and reload the active document view if selected
      await fetchUserDocuments();
      if (activeDocumentId === documentId) {
        selectDocument(documentId, file.name);
      }
    } catch (err) {
      console.error(`❌ Background Ingestion failed for "${file.name}":`, err);
      showToast(`Failed to index "${file.name}": ${err.message}`, "error");

      // Remove from pending uploads
      pendingUploads.delete(documentId);

      // Refresh list to remove the failed item
      await fetchUserDocuments();

      // Reset selection session if the user is still on this failed document
      if (activeDocumentId === documentId) {
        resetSession();
      }
    }
  })();
}

async function fetchUserDocuments() {
  if (!supabaseClient) return;
  
  try {
    const { data, error } = await supabaseClient
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    let allDocs = [];

    // 1. Add pending documents first so they appear at the top
    pendingUploads.forEach((pendingDoc) => {
      allDocs.push({
        id: pendingDoc.id,
        filename: pendingDoc.filename,
        created_at: pendingDoc.created_at,
        isPending: true
      });
    });

    // 2. Add database documents, filtering out any that are still in pending status
    if (data) {
      data.forEach((doc) => {
        if (!pendingUploads.has(doc.id)) {
          allDocs.push({
            ...doc,
            isPending: false
          });
        }
      });
    }

    if (allDocs.length === 0) {
      docList.innerHTML = '<p class="doc-list-empty">No documents uploaded yet.</p>';
      return;
    }

    docList.innerHTML = "";
    allDocs.forEach((doc) => {
      const item = document.createElement("div");
      item.className = `doc-item ${doc.id === activeDocumentId ? "active" : ""} ${doc.isPending ? "temp-indexing" : ""}`;
      item.dataset.id = doc.id;

      const ext = doc.filename.split(".").pop().toLowerCase();
      const dateStr = new Date(doc.created_at).toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });

      if (doc.isPending) {
        item.innerHTML = `
          <div class="doc-item-left">
            <div class="doc-item-icon">
              <div class="indexing-spinner"></div>
            </div>
            <div class="doc-item-details">
              <p class="doc-item-name" title="${escapeHTML(doc.filename)}">${escapeHTML(doc.filename)}</p>
              <p class="doc-item-date">Indexing...</p>
            </div>
          </div>
        `;
      } else {
        item.innerHTML = `
          <div class="doc-item-left">
            <div class="doc-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div class="doc-item-details">
              <p class="doc-item-name" title="${escapeHTML(doc.filename)}">${escapeHTML(doc.filename)}</p>
              <p class="doc-item-date">${ext.toUpperCase()} · ${dateStr}</p>
            </div>
          </div>
          <button class="btn-doc-delete" title="Delete document">
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
          </button>
        `;
      }

      item.addEventListener("click", (e) => {
        if (e.target.closest(".btn-doc-delete")) return;
        selectDocument(doc.id, doc.filename);
      });

      if (!doc.isPending) {
        item.querySelector(".btn-doc-delete").addEventListener("click", async (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete "${doc.filename}"? This will delete all chat history.`)) {
            await deleteDocument(doc.id);
          }
        });
      }

      docList.appendChild(item);
    });
  } catch (err) {
    console.error(err);
    docList.innerHTML = `<p class="doc-list-empty" style="color:var(--error);">Failed to load document index: ${err.message}</p>`;
  }
}

async function selectDocument(docId, filename) {
  activeDocumentId = docId;

  document.querySelectorAll(".doc-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.id === docId);
  });

  const isPending = pendingUploads.has(docId);
  chatSubtitle.textContent = isPending ? `Active Document: ${filename} (Indexing...)` : `Active Document: ${filename}`;
  welcomeScreen.style.display = "none";
  setInputEnabled(true);

  if (isPending) {
    messagesList.innerHTML = `
      <div class="indexing-chat-status">
        <div class="indexing-spinner inline"></div>
        <span>Analyzing document content. You can start typing your questions...</span>
      </div>
    `;
    return;
  }

  // Load chat history from Supabase
  messagesList.innerHTML = '<p class="doc-list-empty">Loading chat history…</p>';

  try {
    const { data, error } = await supabaseClient
      .from("chat_messages")
      .select("*")
      .eq("document_id", docId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    messagesList.innerHTML = "";
    if (data && data.length > 0) {
      data.forEach((msg) => {
        appendMessage(msg.role, msg.content, msg.sources, new Date(msg.created_at));
      });
    } else {
      appendMessage(
        "assistant",
        `Hi! I have loaded **${filename}**. Ask me any analytical, structural, or comparative questions about its content!`,
      );
    }
    scrollToBottom();
  } catch (err) {
    messagesList.innerHTML = "";
    appendMessage("assistant", `Failed to load conversation history: ${err.message}`);
  }
}

async function deleteDocument(docId) {
  try {
    showToast("Deleting document files...", "");
    
    // 1. Delete files from stateless backend
    const res = await fetch(`${API_BASE}/document/${docId}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Backend file delete failed");

    // 2. Delete document record in Supabase (triggers cascade delete on public.chat_messages)
    const { error } = await supabaseClient
      .from("documents")
      .delete()
      .eq("id", docId);

    if (error) throw error;

    showToast("Document deleted successfully.", "success");
    if (activeDocumentId === docId) {
      resetSession();
    }
    fetchUserDocuments();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ═══════════════════════════════ CHAT CONVERSATION FLOW ═══════════════════════════════
function animateProgress(from, to, ms, label) {
  progressLabel.textContent = label;
  const start = performance.now();
  const delta = to - from;

  function step(now) {
    const t = Math.min((now - start) / ms, 1);
    const val = Math.round(from + delta * easeOut(t));
    progressBar.style.width = val + "%";
    progressPct.textContent = val + "%";
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendQuestion();
  }
});

questionInput.addEventListener("input", () => {
  questionInput.style.height = "auto";
  questionInput.style.height = Math.min(questionInput.scrollHeight, 140) + "px";
});

sendBtn.addEventListener("click", sendQuestion);

async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!question || isLoading || !activeDocumentId || !currentUser) return;

  // Block question submission if the active document is still indexing in the background
  if (pendingUploads.has(activeDocumentId)) {
    showToast("Please wait for indexing to complete.", "error");
    return;
  }

  isLoading = true;
  setInputEnabled(false);

  // 1. Instantly display user query in UI & persist in Supabase DB
  appendMessage("user", question);
  questionInput.value = "";
  questionInput.style.height = "24px";

  const typingId = appendTyping();

  try {
    const { error: userMsgErr } = await supabaseClient
      .from("chat_messages")
      .insert({
        document_id: activeDocumentId,
        user_id: currentUser.id,
        role: "user",
        content: question,
        sources: []
      });
    if (userMsgErr) throw userMsgErr;

    // 2. Fetch active session token to authorize the backend rebuild
    let sessionToken = null;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) sessionToken = session.access_token;
    } catch (sessionErr) {
      console.warn("⚠️ Could not retrieve active session token:", sessionErr);
    }

    // 3. Fetch RAG response from stateless backend
    const res = await fetch(`${API_BASE}/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        document_id: activeDocumentId, 
        question: question,
        token: sessionToken 
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "RAG engine error");

    removeTyping(typingId);
    appendMessage("assistant", data.answer, data.sources);
    
    // 3. Persist RAG answer in Supabase DB
    const { error: assistMsgErr } = await supabaseClient
      .from("chat_messages")
      .insert({
        document_id: activeDocumentId,
        user_id: currentUser.id,
        role: "assistant",
        content: data.answer,
        sources: data.sources
      });
    if (assistMsgErr) throw assistMsgErr;

  } catch (err) {
    removeTyping(typingId);
    appendMessage("assistant", `${err.message}`);
    console.error(err);
  } finally {
    isLoading = false;
    setInputEnabled(true);
    questionInput.focus();
  }
}

function appendMessage(role, text, sources = [], dateObj = new Date()) {
  messageCount++;
  const msgEl = document.createElement("div");
  msgEl.className = `message ${role}`;
  msgEl.id = `msg-${messageCount}`;

  const avatar =
    role === "user"
      ? `<div class="message-avatar">U</div>`
      : `<div class="message-avatar">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
         </svg>
       </div>`;

  const sourcesHTML = buildSourcesHTML(sources);
  const timeStr = formatTime(dateObj);

  const formattedText = role === "assistant" ? parseMarkdown(text) : escapeHTML(text).replace(/\n/g, "<br>");

  msgEl.innerHTML = `
    ${avatar}
    <div class="message-body">
      <div class="message-bubble">${formattedText}</div>
      ${sourcesHTML}
      <span class="message-time">${timeStr}</span>
    </div>
  `;

  messagesList.appendChild(msgEl);
  scrollToBottom();

  msgEl.querySelectorAll(".source-item").forEach((item) => {
    item.addEventListener("click", () => item.classList.toggle("expanded"));
  });
}

function buildSourcesHTML(sources) {
  if (!sources || sources.length === 0) return "";

  const items = sources
    .map((s, i) => {
      const pageInfo = s.page != null ? `Page ${s.page + 1}` : "";
      return `
      <div class="source-item" title="Click to expand">
        <div class="source-header">
          <span class="source-badge">Source ${i + 1}</span>
          ${pageInfo ? `<span class="source-page">${pageInfo}</span>` : ""}
        </div>
        <p class="source-text">${escapeHTML(s.content)}</p>
      </div>
    `;
    })
    .join("");

  return `
    <div class="sources-wrap">
      <p class="sources-label">Sources (${sources.length})</p>
      ${items}
    </div>
  `;
}

let typingCounter = 0;

function appendTyping() {
  typingCounter++;
  const id = `typing-${typingCounter}`;
  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  wrap.id = id;
  wrap.innerHTML = `
    <div class="message-avatar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    </div>
    <div class="message-body">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  messagesList.appendChild(wrap);
  scrollToBottom();
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function setInputEnabled(enabled) {
  questionInput.disabled = !enabled || !activeDocumentId;
  sendBtn.disabled = !enabled || !activeDocumentId;
}

function resetSession() {
  activeDocumentId = null;
  docList.innerHTML = '<p class="doc-list-empty">No active workspace. Please sign in.</p>';
  progressWrap.style.display = "none";
  chatSubtitle.textContent = "Sign in to get started";
  welcomeScreen.style.display = "flex";
  messagesList.innerHTML = "";
  messageCount = 0;
  setInputEnabled(false);
}

function scrollToBottom() {
  const wrap = document.getElementById("messagesWrap");
  wrap.scrollTo({ top: wrap.scrollHeight, behavior: "smooth" });
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseMarkdown(text) {
  let html = escapeHTML(text);
  
  // 1. Parse bold: **text** -> <strong>text</strong>
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  // 2. Parse italics: *text* or _text_ -> <em>text</em>
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.*?)_/g, "<em>$1</em>");
  
  // 3. Parse code blocks: ```code``` -> <pre><code>code</code></pre>
  html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  
  // 4. Parse inline code: `code` -> <code>code</code>
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");
  
  // 5. Parse blockquotes: &gt; text -> <blockquote>text</blockquote>
  html = html.replace(/^&gt;\s+(.*)$/gm, "<blockquote>$1</blockquote>");

  // 6. Parse headers: # Header -> <h3>Header</h3>
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.*)$/gm, "<h3>$1</h3>");

  // 7. Parse lists
  const lines = html.split("\n");
  let inUl = false;
  let inOl = false;
  let result = [];
  
  for (let line of lines) {
    const trimmed = line.trim();
    
    // Bullet list match (* or - or •)
    const bulletMatch = trimmed.match(/^[\*\-\u2022]\s+(.*)$/);
    // Numbered list match (e.g. 1. text)
    const numberMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    
    if (bulletMatch) {
      if (inOl) {
        inOl = false;
        result.push("</ol>");
      }
      if (!inUl) {
        inUl = true;
        result.push('<ul class="markdown-list">');
      }
      result.push(`<li>${bulletMatch[1]}</li>`);
    } else if (numberMatch) {
      if (inUl) {
        inUl = false;
        result.push("</ul>");
      }
      if (!inOl) {
        inOl = true;
        result.push('<ol class="markdown-list ordered">');
      }
      result.push(`<li>${numberMatch[2]}</li>`);
    } else {
      if (inUl) {
        inUl = false;
        result.push("</ul>");
      }
      if (inOl) {
        inOl = false;
        result.push("</ol>");
      }
      result.push(line);
    }
  }
  
  if (inUl) result.push("</ul>");
  if (inOl) result.push("</ol>");
  
  html = result.join("\n");
  
  // Replace newlines with <br>
  html = html.replace(/\n/g, "<br>");
  
  // Clean up any double br
  html = html.replace(/(<br>){2,}/g, "<br><br>");
  
  // Clean up <br> tags adjacent to block elements to prevent layout spacing issues
  html = html.replace(/<br>\s*(<\/?(?:ul|ol|li|pre|blockquote|h3)[^>]*>)/gi, "$1");
  html = html.replace(/(<\/?(?:ul|ol|li|pre|blockquote|h3)[^>]*>)\s*<br>/gi, "$1");
  
  return html;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

let toastTimer = null;

function showToast(message, type = "") {
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 4000);
}

// ═══════════════════════════════ MOBILE DRAWER TOGGLES ═══════════════════════════════
const menuToggleBtn = document.getElementById("menuToggleBtn");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");

if (menuToggleBtn && sidebar && sidebarOverlay) {
  menuToggleBtn.addEventListener("click", () => {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("show");
  });

  sidebarOverlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("show");
  });

  // Auto-dismiss sidebar on mobile when document list item is selected
  docList.addEventListener("click", (e) => {
    if (window.innerWidth <= 768 && e.target.closest(".doc-item") && !e.target.closest(".btn-doc-delete")) {
      sidebar.classList.remove("open");
      sidebarOverlay.classList.remove("show");
    }
  });
}
