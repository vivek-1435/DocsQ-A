import { API_BASE } from "./config.js";
import {
  uploadZone,
  fileInput,
  progressWrap,
  progressBar,
  progressLabel,
  progressPct,
  docList,
  chatSubtitle,
  welcomeScreen,
  messagesList,
  questionInput,
  sendBtn,
  authScreen,
  authTitle,
  authSubtitle,
  authSubmitBtn,
  authToggleBtn,
  authToggleText,
  authForm,
  authErrorMsg,
  userProfile,
  userEmail,
  userAvatar,
  signOutBtn,
  menuToggleBtn,
  sidebar,
  sidebarOverlay,
  showToast,
  showAuthModal,
  closeAuthModal,
  setInputEnabled,
  scrollToBottom,
} from "./ui.js";
import {
  supabaseClient,
  currentUser,
  initSupabase,
  signIn,
  signUp,
  signOut,
  onAuthChange,
} from "./auth.js";
import {
  checkHealth,
  fetchBackendConfig,
  uploadToBackend,
  askBackendQuestion,
  deleteBackendDocument,
} from "./api.js";
import {
  appendMessage,
  appendTyping,
  removeTyping,
  resetMessageCount,
} from "./chat.js";

// Main App States
let activeDocumentId = null;
let activeDocumentName = "";
let isLoading = false;
const pendingUploads = new Map();

// Authentication UI Flow Mode state
let authMode = "signin";

// Drag and drop event handlers
uploadZone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  uploadZone.classList.add("dragover");
});
uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
});
uploadZone.addEventListener("dragleave", () =>
  uploadZone.classList.remove("dragover")
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

// Toggle Auth screen mode
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

// Auth form submissions
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

    if (authMode === "signin") {
      await signIn(email, password);
      showToast("Signed in successfully!", "success");
      closeAuthModal();
    } else {
      await signUp(email, password);
      showToast("Account created successfully! Check your email to verify.", "success");
      authMode = "signin";
      authTitle.textContent = "Welcome Back";
      authSubmitBtn.textContent = "Sign In";
      authToggleText.textContent = "Don't have an account?";
      authToggleBtn.textContent = "Create Account";
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
  try {
    await signOut();
  } catch (err) {
    showToast(`Sign out failed: ${err.message}`, "error");
  }
});

// App Inits
async function initApp() {
  console.log("⚙️ Starting Ειδήμονας initialization...");
  try {
    // 1. Verify health
    await checkHealth();

    // 2. Load configurations
    const config = await fetchBackendConfig();
    if (!config.supabase_url || !config.supabase_anon_key) {
      throw new Error("Supabase credentials missing in backend .env file!");
    }

    // 3. Init Supabase auth client
    initSupabase(config.supabase_url, config.supabase_anon_key);
    console.log("✅ Supabase client created successfully!");
    
    // 4. Register Session Observer
    onAuthChange((event, session) => {
      console.log("🔑 Supabase Auth State Change event:", event, session ? "Session active" : "No session");
      if (session) {
        // Update User Profile Widget
        userEmail.textContent = session.user.email;
        userAvatar.textContent = session.user.email.charAt(0).toUpperCase();
        userProfile.style.display = "flex";
        
        closeAuthModal();
        fetchUserDocuments();
      } else {
        userProfile.style.display = "none";
        resetSession();
        showAuthModal();
      }
    });

  } catch (err) {
    console.error("❌ Initialization Error caught:", err);
    showToast(`⚠️ Initialization failed: ${err.message}`, "error");
    chatSubtitle.textContent = "Configuration Required (.env)";
    
    authErrorMsg.textContent = `⚠️ System Configuration Error: ${err.message}. Please check your backend .env file, verify that port 8000 is running, and refresh the page.`;
    authErrorMsg.style.display = "block";
    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = "Configuration Required";
  }
}

// Boot app
initApp();

// File operations
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

// Base64 converter
const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = (error) => reject(error);
  });

async function uploadFile(file) {
  const documentId = (typeof crypto.randomUUID === "function") 
    ? crypto.randomUUID() 
    : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );

  // Add mock file state to the pending Uploads Map
  pendingUploads.set(documentId, {
    id: documentId,
    filename: file.name,
    created_at: new Date().toISOString()
  });

  activeDocumentId = documentId;
  activeDocumentName = file.name;
  
  await fetchUserDocuments();
  selectDocument(documentId, file.name);

  fileInput.value = "";

  const formData = new FormData();
  formData.append("file", file);

  // Background Ingestion task execution
  (async () => {
    try {
      console.log(`⏳ Background Ingestion starting for "${file.name}" (ID: ${documentId})`);

      const base64Promise = fileToBase64(file).catch(err => {
        console.warn("⚠️ Base64 conversion failed:", err);
        return "";
      });

      const backendPromise = uploadToBackend(documentId, formData);
      const [data, fileDataB64] = await Promise.all([backendPromise, base64Promise]);

      // Save document backup details directly in Supabase
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

      pendingUploads.delete(documentId);

      await fetchUserDocuments();
      if (activeDocumentId === documentId) {
        selectDocument(documentId, file.name);
      }
    } catch (err) {
      console.error(`❌ Background Ingestion failed for "${file.name}":`, err);
      showToast(`Failed to index "${file.name}": ${err.message}`, "error");

      pendingUploads.delete(documentId);
      await fetchUserDocuments();

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
      .select("id, filename, file_path, vector_store_path, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    let allDocs = [];

    // Append pending uploads first
    pendingUploads.forEach((pendingDoc) => {
      allDocs.push({
        id: pendingDoc.id,
        filename: pendingDoc.filename,
        created_at: pendingDoc.created_at,
        isPending: true,
      });
    });

    if (data) {
      data.forEach((d) => {
        if (!pendingUploads.has(d.id)) {
          allDocs.push({ ...d, isPending: false });
        }
      });
    }

    docList.innerHTML = "";
    if (allDocs.length === 0) {
      docList.innerHTML = '<p class="doc-list-empty">No documents uploaded yet.</p>';
      return;
    }

    allDocs.forEach((doc) => {
      const item = document.createElement("div");
      item.className = `doc-item ${doc.id === activeDocumentId ? "active" : ""}`;
      item.dataset.id = doc.id;

      const ext = doc.filename.split(".").pop().toUpperCase();

      if (doc.isPending) {
        item.classList.add("temp-indexing");
        item.innerHTML = `
          <div class="doc-icon-wrap">
            <div class="indexing-spinner"></div>
          </div>
          <div class="doc-info">
            <span class="doc-name">${doc.filename}</span>
            <span class="doc-meta">Indexing text...</span>
          </div>
        `;
      } else {
        item.innerHTML = `
          <div class="doc-icon-wrap">
            <span class="doc-ext">${ext}</span>
          </div>
          <div class="doc-info">
            <span class="doc-name">${doc.filename}</span>
            <span class="doc-meta">${new Date(doc.created_at).toLocaleDateString()}</span>
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
  activeDocumentName = filename;

  document.querySelectorAll(".doc-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.id === docId);
  });

  const isPending = pendingUploads.has(docId);
  chatSubtitle.textContent = isPending ? `Active Document: ${filename} (Indexing...)` : `Active Document: ${filename}`;
  welcomeScreen.style.display = "none";
  setInputEnabled(true, activeDocumentId);

  if (isPending) {
    messagesList.innerHTML = `
      <div class="indexing-chat-status">
        <div class="indexing-spinner inline"></div>
        <span>Analyzing document content. You can start typing your questions...</span>
      </div>
    `;
    return;
  }

  // Load message history from DB
  messagesList.innerHTML = '<p class="doc-list-empty">Loading chat history...</p>';

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
        appendMessage(msg.role, msg.content, msg.sources, new Date(msg.created_at), activeDocumentName);
      });
    } else {
      appendMessage(
        "assistant",
        `Hi! I have loaded **${filename}**. Ask me any analytical, structural, or comparative questions about its content!`,
        [],
        new Date(),
        activeDocumentName
      );
    }
    scrollToBottom();
  } catch (err) {
    messagesList.innerHTML = "";
    appendMessage("assistant", `Failed to load conversation history: ${err.message}`, [], new Date(), activeDocumentName);
  }
}

async function deleteDocument(docId) {
  try {
    showToast("Deleting document files...", "");
    
    // 1. Backend delete
    await deleteBackendDocument(docId);

    // 2. Supabase delete
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
    console.error("❌ Failed to delete document:", err);
    showToast(`Delete failed: ${err.message}`, "error");
  }
}

// Message submissions
async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!question || isLoading || !activeDocumentId) return;

  // Intercept early questions if active document is still indexing in transit
  if (pendingUploads.has(activeDocumentId)) {
    showToast("Please wait for indexing to complete.", "error");
    return;
  }

  isLoading = true;
  setInputEnabled(false, activeDocumentId);

  // 1. Append User bubble and clear inputs
  appendMessage("user", question, [], new Date(), activeDocumentName);
  questionInput.value = "";
  questionInput.style.height = "24px";

  const typingId = appendTyping();

  try {
    // 2. Write User message to database
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

    // 3. Fetch active token
    let sessionToken = null;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) sessionToken = session.access_token;
    } catch (sessionErr) {
      console.warn("⚠️ Could not retrieve active session token:", sessionErr);
    }

    // 4. Send API query to backend
    const data = await askBackendQuestion(activeDocumentId, question, sessionToken);

    // 5. Remove typing loading card, render response bubble
    removeTyping(typingId);
    appendMessage("assistant", data.answer, data.sources, new Date(), activeDocumentName);
    
    // 6. Write Assistant response to database
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
    appendMessage("assistant", `${err.message}`, [], new Date(), activeDocumentName);
    console.error(err);
  } finally {
    isLoading = false;
    setInputEnabled(true, activeDocumentId);
    questionInput.focus();
  }
}

// Form event handlers
sendBtn.addEventListener("click", sendQuestion);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendQuestion();
  }
});

// Reset visual flows
function resetSession() {
  activeDocumentId = null;
  activeDocumentName = "";
  docList.innerHTML = '<p class="doc-list-empty">No active workspace. Please sign in.</p>';
  progressWrap.style.display = "none";
  chatSubtitle.textContent = "Sign in to get started";
  welcomeScreen.style.display = "flex";
  messagesList.innerHTML = "";
  resetMessageCount();
  setInputEnabled(false, null);
}

// Bind mobile toggle listeners
if (menuToggleBtn && sidebar && sidebarOverlay) {
  menuToggleBtn.addEventListener("click", () => {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("show");
  });

  sidebarOverlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("show");
  });

  // Auto-dismiss mobile drawer on item selection
  docList.addEventListener("click", (e) => {
    if (window.innerWidth <= 768 && e.target.closest(".doc-item") && !e.target.closest(".btn-doc-delete")) {
      sidebar.classList.remove("open");
      sidebarOverlay.classList.remove("show");
    }
  });
}
