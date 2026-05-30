const API_BASE = 'http://localhost:8000';

let sessionId    = null;
let isLoading    = false;
let messageCount = 0;

const uploadZone    = document.getElementById('uploadZone');
const fileInput     = document.getElementById('fileInput');
const progressWrap  = document.getElementById('progressWrap');
const progressBar   = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const progressPct   = document.getElementById('progressPct');
const docCard       = document.getElementById('docCard');
const docCardName   = document.getElementById('docCardName');
const docCardRemove = document.getElementById('docCardRemove');
const chatSubtitle  = document.getElementById('chatSubtitle');
const welcomeScreen = document.getElementById('welcomeScreen');
const messagesList  = document.getElementById('messagesList');
const questionInput = document.getElementById('questionInput');
const sendBtn       = document.getElementById('sendBtn');
const toast         = document.getElementById('toast');

// drag and drop listeners
uploadZone.addEventListener('dragenter', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragover',  e => { e.preventDefault(); });
uploadZone.addEventListener('dragleave', ()  => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// file input click
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// clean up session
docCardRemove.addEventListener('click', () => {
  if (sessionId) {
    fetch(`${API_BASE}/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
  }
  resetSession();
});

function handleFile(file) {
  const allowed = ['.pdf', '.docx', '.doc'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();

  if (!allowed.includes(ext)) {
    showToast('Please upload a PDF or Word (.docx) file.', 'error');
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    showToast('File too large. Maximum size is 50 MB.', 'error');
    return;
  }

  uploadFile(file);
}

async function uploadFile(file) {
  setInputEnabled(false);

  progressWrap.style.display = 'block';
  docCard.style.display = 'none';
  animateProgress(0, 40, 800, 'Uploading…');

  const formData = new FormData();
  formData.append('file', file);

  try {
    animateProgress(40, 70, 1200, 'Processing document…');

    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Upload failed');
    }

    animateProgress(70, 100, 600, 'Building index…');
    await sleep(700); // allow index animation to finish

    sessionId = data.session_id;

    progressWrap.style.display = 'none';
    docCardName.textContent = file.name;
    docCard.style.display = 'flex';
    chatSubtitle.textContent = `Loaded: ${file.name}`;
    welcomeScreen.style.display = 'none';
    
    setInputEnabled(true);
    showToast('Document ready! Ask your first question.', 'success');
    questionInput.focus();
    
    fileInput.value = '';

  } catch (err) {
    progressWrap.style.display = 'none';
    showToast(`${err.message}`, 'error');
    console.error(err);
  }
}

function animateProgress(from, to, ms, label) {
  progressLabel.textContent = label;
  const start  = performance.now();
  const delta  = to - from;

  function step(now) {
    const t   = Math.min((now - start) / ms, 1);
    const val = Math.round(from + delta * easeOut(t));
    progressBar.style.width = val + '%';
    progressPct.textContent  = val + '%';
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

// send question on enter key
questionInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendQuestion();
  }
});

// dynamic height resize for input textarea
questionInput.addEventListener('input', () => {
  questionInput.style.height = 'auto';
  questionInput.style.height = Math.min(questionInput.scrollHeight, 140) + 'px';
});

sendBtn.addEventListener('click', sendQuestion);

async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!question || isLoading || !sessionId) return;

  isLoading = true;
  setInputEnabled(false);

  appendMessage('user', question);
  questionInput.value = '';
  questionInput.style.height = '24px';

  const typingId = appendTyping();

  try {
    const res = await fetch(`${API_BASE}/ask`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ session_id: sessionId, question }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to get answer');

    removeTyping(typingId);
    appendMessage('assistant', data.answer, data.sources);

  } catch (err) {
    removeTyping(typingId);
    appendMessage('assistant', `${err.message}`);
    console.error(err);
  } finally {
    isLoading = false;
    setInputEnabled(true);
    questionInput.focus();
  }
}

function appendMessage(role, text, sources = []) {
  messageCount++;
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;
  msgEl.id = `msg-${messageCount}`;

  const avatar = role === 'user'
    ? `<div class="message-avatar">U</div>`
    : `<div class="message-avatar">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
         </svg>
       </div>`;

  const sourcesHTML = buildSourcesHTML(sources);
  const timeStr     = formatTime(new Date());

  msgEl.innerHTML = `
    ${avatar}
    <div class="message-body">
      <div class="message-bubble">${escapeHTML(text).replace(/\n/g, '<br>')}</div>
      ${sourcesHTML}
      <span class="message-time">${timeStr}</span>
    </div>
  `;

  messagesList.appendChild(msgEl);
  scrollToBottom();

  msgEl.querySelectorAll('.source-item').forEach(item => {
    item.addEventListener('click', () => item.classList.toggle('expanded'));
  });
}

function buildSourcesHTML(sources) {
  if (!sources || sources.length === 0) return '';

  const items = sources.map((s, i) => {
    const pageInfo = s.page != null ? `Page ${s.page + 1}` : '';
    return `
      <div class="source-item" title="Click to expand">
        <div class="source-header">
          <span class="source-badge">Source ${i + 1}</span>
          ${pageInfo ? `<span class="source-page">${pageInfo}</span>` : ''}
        </div>
        <p class="source-text">${escapeHTML(s.content)}</p>
      </div>
    `;
  }).join('');

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
  const wrap = document.createElement('div');
  wrap.className = 'message assistant';
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
  questionInput.disabled = !enabled || !sessionId;
  sendBtn.disabled       = !enabled || !sessionId;
}

function resetSession() {
  sessionId = null;
  docCard.style.display    = 'none';
  progressWrap.style.display = 'none';
  chatSubtitle.textContent = 'Upload a document to get started';
  welcomeScreen.style.display = 'flex';
  messagesList.innerHTML   = '';
  messageCount             = 0;
  setInputEnabled(false);
  showToast('Document removed. Upload a new one to continue.', '');
}

function scrollToBottom() {
  const wrap = document.getElementById('messagesWrap');
  wrap.scrollTo({ top: wrap.scrollHeight, behavior: 'smooth' });
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

let toastTimer = null;

function showToast(message, type = '') {
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 4000);
}

// ping backend on initialize
(async () => {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error();
  } catch {
    showToast('Cannot reach backend. Make sure the server is running on port 8000.', 'error');
  }
})();
