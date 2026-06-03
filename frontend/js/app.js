import {
  uploadZone,
  fileInput,
  docList,
  chatSubtitle,
  welcomeScreen,
  messagesList,
  questionInput,
  sendBtn,
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
  escapeHTML,
  removeTyping,
  resetMessageCount,
} from "./chat.js";

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".csv", ".xlsx", ".pptx"];
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const AUTH_COPY = {
  signin: {
    title: "Welcome Back",
    subtitle: "Sign in to your workspace to resume document Q&A",
    submit: "Sign In",
    toggleText: "Don't have an account?",
    toggleAction: "Create Account",
  },
  signup: {
    title: "Create Account",
    subtitle: "Sign up for a free document intelligence workspace",
    submit: "Sign Up",
    toggleText: "Already have an account?",
    toggleAction: "Sign In",
  },
};

let activeDocumentId = null;
let activeDocumentName = "";
let isLoading = false;
const pendingUploads = new Map();
let authMode = "signin";

function generateDocumentId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, (c) =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

function setAuthMode(mode) {
  authMode = mode;
  const copy = AUTH_COPY[authMode];

  authErrorMsg.style.display = "none";
  authTitle.textContent = copy.title;
  authSubtitle.textContent = copy.subtitle;
  authSubmitBtn.textContent = supabaseClient ? copy.submit : "Connecting to backend...";
  authToggleText.textContent = copy.toggleText;
  authToggleBtn.textContent = copy.toggleAction;
}

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

authToggleBtn.addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(authMode === "signin" ? "signup" : "signin");
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
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
      setAuthMode("signin");
    }
  } catch (err) {
    authErrorMsg.textContent = err.message;
    authErrorMsg.style.display = "block";
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = AUTH_COPY[authMode].submit;
  }
});

signOutBtn.addEventListener("click", async () => {
  try {
    await signOut();
  } catch (err) {
    showToast(`Sign out failed: ${err.message}`, "error");
  }
});

async function initApp() {
  try {
    await checkHealth();

    const config = await fetchBackendConfig();
    if (!config.supabase_url || !config.supabase_anon_key) {
      throw new Error("Supabase credentials missing in backend .env file!");
    }

    initSupabase(config.supabase_url, config.supabase_anon_key);

    authSubmitBtn.disabled = false;
    setAuthMode(authMode);
    
    onAuthChange((_event, session) => {
      if (session) {
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
    console.error(err);
    showToast(`Initialization failed: ${err.message}`, "error");
    chatSubtitle.textContent = "Configuration Required (.env)";
    
    authErrorMsg.textContent = `System Configuration Error: ${err.message}. Please check your backend .env file, verify that port 8000 is running, and refresh the page.`;
    authErrorMsg.style.display = "block";
    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = "Configuration Required";
  }
}

initApp();

function handleFile(file) {
  const ext = "." + file.name.split(".").pop().toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    showToast("Unsupported file type. Supported formats: PDF, Text, CSV, Excel, Word, PowerPoint.", "error");
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    showToast(`File too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`, "error");
    return;
  }

  uploadFile(file);
}

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = (error) => reject(error);
  });

async function saveDocumentMetadata(documentId, file, uploadResult) {
  const { error } = await supabaseClient
    .from("documents")
    .insert({
      id: documentId,
      user_id: currentUser.id,
      filename: file.name,
      file_path: uploadResult.file_path,
      vector_store_path: uploadResult.vector_store_path,
      file_data: null,
    });

  if (error) throw error;
}

async function uploadDocumentBackup(documentId, file, base64Promise) {
  try {
    const fileDataB64 = await base64Promise;
    if (!fileDataB64) return;

    const { error } = await supabaseClient
      .from("documents")
      .update({ file_data: fileDataB64 })
      .eq("id", documentId);

    if (error) throw error;
  } catch (err) {
    console.warn(`Cloud backup upload failed for "${file.name}":`, err);
  }
}

async function uploadFile(file) {
  const documentId = generateDocumentId();
  pendingUploads.set(documentId, {
    id: documentId,
    filename: file.name,
    created_at: new Date().toISOString(),
  });

  activeDocumentId = documentId;
  activeDocumentName = file.name;
  
  await fetchUserDocuments();
  selectDocument(documentId, file.name);

  fileInput.value = "";

  const formData = new FormData();
  formData.append("file", file);

  (async () => {
    try {
      const base64Promise = fileToBase64(file).catch((err) => {
        console.warn("Base64 conversion failed:", err);
        return "";
      });

      const uploadResult = await uploadToBackend(documentId, formData);
      await saveDocumentMetadata(documentId, file, uploadResult);

      showToast(`"${file.name}" indexed successfully!`, "success");

      pendingUploads.delete(documentId);
      await fetchUserDocuments();

      if (activeDocumentId === documentId) {
        selectDocument(documentId, file.name);
      }

      uploadDocumentBackup(documentId, file, base64Promise);
    } catch (err) {
      console.error(`Background ingestion failed for "${file.name}":`, err);
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

    const allDocs = [];

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

      const ext = escapeHTML(doc.filename.split(".").pop().toUpperCase());
      const filename = escapeHTML(doc.filename);

      if (doc.isPending) {
        item.classList.add("temp-indexing");
        item.innerHTML = `
          <div class="doc-icon-wrap">
            <div class="indexing-spinner"></div>
          </div>
          <div class="doc-info">
            <span class="doc-name">${filename}</span>
            <span class="doc-meta">Indexing text...</span>
          </div>
        `;
      } else {
        item.innerHTML = `
          <div class="doc-icon-wrap">
            <span class="doc-ext">${ext}</span>
          </div>
          <div class="doc-info">
            <span class="doc-name">${filename}</span>
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
    docList.innerHTML = `<p class="doc-list-empty error-text">Failed to load document index: ${escapeHTML(err.message)}</p>`;
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
        appendMessage(msg.role, msg.content, msg.sources, new Date(msg.created_at));
      });
    } else {
      appendMessage(
        "assistant",
        `Hi! I have loaded **${filename}**. Ask me any analytical, structural, or comparative questions about its content!`,
        [],
        new Date()
      );
    }
    scrollToBottom();
  } catch (err) {
    messagesList.innerHTML = "";
    appendMessage("assistant", `Failed to load conversation history: ${err.message}`, [], new Date());
  }
}

async function deleteDocument(docId) {
  const docItemEl = document.querySelector(`.doc-item[data-id="${docId}"]`);
  if (docItemEl) {
    docItemEl.style.opacity = "0";
    docItemEl.style.transform = "translateX(-20px)";
    docItemEl.style.transition = "all 0.3s ease";
    setTimeout(() => {
      docItemEl.remove();
      if (docList.querySelectorAll(".doc-item").length === 0) {
        docList.innerHTML = '<p class="doc-list-empty">No documents uploaded yet.</p>';
      }
    }, 300);
  }

  // 2. Reset active chat session instantly if deleting the currently selected document
  if (activeDocumentId === docId) {
    resetSession();
  }

  (async () => {
    try {
      await deleteBackendDocument(docId);

      const { error } = await supabaseClient
        .from("documents")
        .delete()
        .eq("id", docId);

      if (error) throw error;

      showToast("Document deleted successfully.", "success");
      fetchUserDocuments();
    } catch (err) {
      console.error("Failed to delete document:", err);
      showToast(`Delete failed: ${err.message}`, "error");
      fetchUserDocuments();
    }
  })();
}

async function getSessionToken() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session?.access_token || null;
  } catch (err) {
    console.warn("Could not retrieve active session token:", err);
    return null;
  }
}

async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!question || isLoading || !activeDocumentId) return;

  if (pendingUploads.has(activeDocumentId)) {
    showToast("Please wait for indexing to complete.", "error");
    return;
  }

  isLoading = true;
  setInputEnabled(false, activeDocumentId);

  appendMessage("user", question, [], new Date());
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

    const sessionToken = await getSessionToken();
    const data = await askBackendQuestion(activeDocumentId, question, sessionToken);

    removeTyping(typingId);
    appendMessage("assistant", data.answer, data.sources, new Date());
    
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
    appendMessage("assistant", `${err.message}`, [], new Date());
    console.error(err);
  } finally {
    isLoading = false;
    setInputEnabled(true, activeDocumentId);
    questionInput.focus();
  }
}

sendBtn.addEventListener("click", sendQuestion);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendQuestion();
  }
});

function resetSession() {
  activeDocumentId = null;
  activeDocumentName = "";
  docList.innerHTML = '<p class="doc-list-empty">No active workspace. Please sign in.</p>';
  chatSubtitle.textContent = "Sign in to get started";
  welcomeScreen.style.display = "flex";
  messagesList.innerHTML = "";
  resetMessageCount();
  setInputEnabled(false, null);
}

if (menuToggleBtn && sidebar && sidebarOverlay) {
  menuToggleBtn.addEventListener("click", () => {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("show");
  });

  sidebarOverlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("show");
  });

  docList.addEventListener("click", (e) => {
    if (window.innerWidth <= 768 && e.target.closest(".doc-item") && !e.target.closest(".btn-doc-delete")) {
      sidebar.classList.remove("open");
      sidebarOverlay.classList.remove("show");
    }
  });
}

if (window.visualViewport) {
  const updateViewportHeight = () => {
    const height = window.visualViewport.height;
    document.documentElement.style.setProperty("--viewport-height", `${height}px`);
    
    if (document.activeElement === questionInput) {
      setTimeout(scrollToBottom, 50);
    }
  };

  window.visualViewport.addEventListener("resize", updateViewportHeight);
  window.visualViewport.addEventListener("scroll", updateViewportHeight);
  
  updateViewportHeight();
}

questionInput.addEventListener("focus", () => {
  setTimeout(scrollToBottom, 150);
});
