// Dynamically determine the backend API base URL
export const API_BASE =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000"
    : "https://docsq-a.onrender.com";

console.log("🔗 API Base URL determined as:", API_BASE);
