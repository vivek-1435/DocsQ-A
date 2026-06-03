import { messagesList, scrollToBottom } from "./ui.js";

export let messageCount = 0;
let typingCounter = 0;

export function appendMessage(role, text, sources = [], dateObj = new Date()) {
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

export function buildSourcesHTML(sources) {
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

export function appendTyping() {
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

export function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

export function resetMessageCount() {
  messageCount = 0;
}

export function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function parseMarkdown(text) {
  let html = escapeHTML(text);
  
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.*?)_/g, "<em>$1</em>");
  html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");
  html = html.replace(/^&gt;\s+(.*)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.*)$/gm, "<h3>$1</h3>");

  const lines = html.split("\n");
  let inUl = false;
  let inOl = false;
  const result = [];
  
  for (let line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[\*\-\u2022]\s+(.*)$/);
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
  html = html.replace(/\n/g, "<br>");
  html = html.replace(/(<br>){2,}/g, "<br><br>");
  html = html.replace(/<br>\s*(<\/?(?:ul|ol|li|pre|blockquote|h3)[^>]*>)/gi, "$1");
  html = html.replace(/(<\/?(?:ul|ol|li|pre|blockquote|h3)[^>]*>)\s*<br>/gi, "$1");
  
  return html;
}
