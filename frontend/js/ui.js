// DOM Element References
export const uploadZone = document.getElementById("uploadZone");
export const fileInput = document.getElementById("fileInput");
export const docList = document.getElementById("docList");
export const chatSubtitle = document.getElementById("chatSubtitle");
export const welcomeScreen = document.getElementById("welcomeScreen");
export const messagesList = document.getElementById("messagesList");
export const questionInput = document.getElementById("questionInput");
export const sendBtn = document.getElementById("sendBtn");
export const toast = document.getElementById("toast");

export const authScreen = document.getElementById("authScreen");
export const authTitle = document.getElementById("authTitle");
export const authSubtitle = document.getElementById("authSubtitle");
export const authSubmitBtn = document.getElementById("authSubmitBtn");
export const authToggleBtn = document.getElementById("authToggleBtn");
export const authToggleText = document.getElementById("authToggleText");
export const authForm = document.getElementById("authForm");
export const authErrorMsg = document.getElementById("authErrorMsg");

export const userProfile = document.getElementById("userProfile");
export const userEmail = document.getElementById("userEmail");
export const userAvatar = document.getElementById("userAvatar");
export const signOutBtn = document.getElementById("signOutBtn");

export const menuToggleBtn = document.getElementById("menuToggleBtn");
export const sidebar = document.getElementById("sidebar");
export const sidebarOverlay = document.getElementById("sidebarOverlay");

// Toast Notification helper
let toastTimer = null;
export function showToast(message, type = "") {
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 4000);
}

// Toggle input states
export function setInputEnabled(enabled, activeDocumentId) {
  questionInput.disabled = !enabled || !activeDocumentId;
  sendBtn.disabled = !enabled || !activeDocumentId;
}

// Auth modal actions
export function showAuthModal() {
  authErrorMsg.style.display = "none";
  authForm.reset();
  if (authScreen) {
    authScreen.classList.remove("hidden");
  }
}

export function closeAuthModal() {
  if (authScreen) {
    authScreen.classList.add("hidden");
  }
}

// Scroll chat feed
export function scrollToBottom() {
  messagesList.scrollTo({
    top: messagesList.scrollHeight,
    behavior: "smooth",
  });
}
