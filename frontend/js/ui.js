// DOM refs
export const $ = (id) => document.getElementById(id);

export const uploadZone    = $("uploadZone");
export const fileInput     = $("fileInput");
export const docList       = $("docList");
export const chatSubtitle  = $("chatSubtitle");
export const welcomeScreen = $("welcomeScreen");
export const messagesList  = $("messagesList");
export const messagesWrap  = $("messagesWrap");
export const questionInput = $("questionInput");
export const sendBtn       = $("sendBtn");
export const toast         = $("toast");
export const authScreen    = $("authScreen");
export const authTitle     = $("authTitle");
export const authSubtitle  = $("authSubtitle");
export const authSubmitBtn = $("authSubmitBtn");
export const authToggleBtn = $("authToggleBtn");
export const authToggleText = $("authToggleText");
export const authForm      = $("authForm");
export const authErrorMsg  = $("authErrorMsg");
export const userProfile   = $("userProfile");
export const userEmail     = $("userEmail");
export const userAvatar    = $("userAvatar");
export const signOutBtn    = $("signOutBtn");
export const menuToggleBtn = $("menuToggleBtn");
export const sidebar       = $("sidebar");
export const sidebarOverlay = $("sidebarOverlay");

// Toast
let toastTimer = null;
export function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
}

// Input state
export const setInputEnabled = (on, docId) => {
  questionInput.disabled = !on || !docId;
  sendBtn.disabled       = !on || !docId;
};

// Auth modal
export const showAuthModal  = () => { authErrorMsg.style.display = "none"; authForm.reset(); authScreen?.classList.remove("hidden"); };
export const closeAuthModal = () => authScreen?.classList.add("hidden");

// Scroll chat to bottom
export const scrollToBottom = () => messagesWrap?.scrollTo({ top: messagesWrap.scrollHeight, behavior: "smooth" });

// Textarea height management
export const resetInputHeight = () => { questionInput.style.height = "24px"; };
export const growInput = () => { questionInput.style.height = "24px"; questionInput.style.height = questionInput.scrollHeight + "px"; };
