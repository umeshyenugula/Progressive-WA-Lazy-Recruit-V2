/**
 * utils.js — Shared utility functions
 */

// ── Toast notifications ──────────────────────────────────────
let _toastContainer;

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.getElementById('toast-container');
    if (!_toastContainer) {
      _toastContainer = document.createElement('div');
      _toastContainer.id = 'toast-container';
      document.body.appendChild(_toastContainer);
    }
  }
  return _toastContainer;
}

const ICONS = {
  success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd"/></svg>`,
  error:   `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clip-rule="evenodd"/></svg>`,
  warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clip-rule="evenodd"/></svg>`,
  info:    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clip-rule="evenodd"/></svg>`,
};

const TOAST_LABELS = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };
const TOAST_MIN_DURATION = { success: 3000, error: 5000, warning: 5000, info: 4000 };

/**
 * Show a rich toast notification
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} [duration] ms — errors/warnings default to 5000, success to 3000
 */
function toast(message, type = 'info', duration) {
  const dur = Math.max(duration ?? TOAST_MIN_DURATION[type] ?? 4000, TOAST_MIN_DURATION[type] ?? 0);
  const container = getToastContainer();

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

  el.innerHTML = `
    <div class="toast-lead">
      <div class="toast-icon-wrap">${ICONS[type] || ''}</div>
      <div class="toast-content">
        <div class="toast-type">${TOAST_LABELS[type] || type}</div>
        <div class="toast-msg">${message}</div>
      </div>
    </div>
    <button class="toast-close" aria-label="Dismiss notification">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
      </svg>
    </button>
    <div class="toast-progress" style="animation-duration:${dur}ms"></div>
  `;

  container.appendChild(el);

  function dismiss() {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  let timer = setTimeout(dismiss, dur);

  el.querySelector('.toast-close').addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });

  // Pause progress bar and timer on hover
  let hoverPauseStart = 0;
  let remaining = dur;
  el.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    hoverPauseStart = Date.now();
    el.querySelector('.toast-progress').style.animationPlayState = 'paused';
  });
  el.addEventListener('mouseleave', () => {
    const elapsed = Date.now() - hoverPauseStart;
    remaining = Math.max(remaining - elapsed, 1200);
    el.querySelector('.toast-progress').style.animationPlayState = 'running';
    timer = setTimeout(dismiss, remaining);
  });
}


// ── Auth guards ──────────────────────────────────────────────
function requireAuth(allowedRoles = []) {
  const user = getUser();
  const p = window.location.pathname;
  const loginPath = (p.includes('/admin/') || p.includes('/superadmin/')) ? '../index.html' : 'index.html';

  if (!user || !getToken()) {
    // Show briefly then redirect
    toast('You must be signed in to access this page.', 'warning', 3000);
    setTimeout(() => { window.location.href = loginPath; }, 1200);
    return null;
  }

  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    toast(`Unauthorized — your role (${user.role}) does not have access to this page.`, 'error', 5000);
    setTimeout(() => { window.location.href = loginPath; }, 2000);
    return null;
  }

  return user;
}

// ── DOM helpers ──────────────────────────────────────────────
function $(sel, ctx = document)   { return ctx.querySelector(sel); }
function $$(sel, ctx = document)  { return [...ctx.querySelectorAll(sel)]; }

function show(el)  { if (el) el.classList.remove('hidden'); }
function hide(el)  { if (el) el.classList.add('hidden'); }

function setLoading(btn, loading, text = 'Loading…') {
  if (!btn) return;
  if (loading) {
    btn._origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner spinner-sm"></span> ${text}`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn._origText || text;
    btn.disabled = false;
  }
}

function renderLoading(container) {
  container.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner"></div>
      <span>Loading…</span>
    </div>`;
}

function renderEmpty(container, title = 'Nothing here', sub = '') {
  container.innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
      </svg>
      <h3>${title}</h3>
      ${sub ? `<p>${sub}</p>` : ''}
    </div>`;
}

// ── Formatting helpers ───────────────────────────────────────
function badgeHtml(status) {
  const map = {
    pending:     'badge-pending',
    shortlisted: 'badge-shortlisted',
    selected:    'badge-selected',
    rejected:    'badge-rejected',
  };
  return `<span class="badge ${map[status] || 'badge-pending'}">${status}</span>`;
}

function roleBadge(role) {
  return `<span class="badge ${role === 'superadmin' ? 'badge-superadmin' : 'badge-admin'}">${role}</span>`;
}

function avatar(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// ── Modal helpers ────────────────────────────────────────────
function openModal(id)  { const m = document.getElementById(id); if (m) m.classList.remove('hidden'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.add('hidden'); }

// Close modal on backdrop click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.add('hidden');
  }
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $$('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  }
});

// ── Download blob ────────────────────────────────────────────
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Sidebar user init ────────────────────────────────────────
function initSidebarUser() {
  const user = getUser();
  if (!user) return;
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const avEl   = document.getElementById('sidebar-user-avatar');
  if (nameEl) nameEl.textContent = user.full_name || user.email;
  if (roleEl) roleEl.textContent = user.role;
  if (avEl)   avEl.textContent   = avatar(user.full_name || user.email);

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      const oldTitle = logoutBtn.title;
      logoutBtn.title = 'Processing safe logout...';
      try {
        await Auth.logout();
      } finally {
        logoutBtn.disabled = false;
        logoutBtn.title = oldTitle || 'Logout';
      }
    });
  }
}

// ── Active nav link ──────────────────────────────────────────
function highlightNav() {
  const path = window.location.pathname.split('/').pop();
  $$('.nav-item').forEach(link => {
    const href = link.getAttribute('href')?.split('/').pop();
    link.classList.toggle('active', href === path);
  });
}

// ── Simple client-side sort ──────────────────────────────────
function sortData(arr, key, dir = 'asc') {
  return [...arr].sort((a, b) => {
    const av = (a[key] ?? '').toString().toLowerCase();
    const bv = (b[key] ?? '').toString().toLowerCase();
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

// ── Debounce ─────────────────────────────────────────────────
function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Paginate ─────────────────────────────────────────────────
function paginate(arr, page, size) {
  const start = (page - 1) * size;
  return {
    items: arr.slice(start, start + size),
    total: arr.length,
    pages: Math.ceil(arr.length / size),
    page,
    size,
  };
}

function renderPagination(container, pager, onPage) {
  const { total, pages, page, size } = pager;
  const from = Math.min((page - 1) * size + 1, total);
  const to   = Math.min(page * size, total);

  container.innerHTML = `
    <div class="pagination-info">
      Showing <strong>${from}–${to}</strong> of <strong>${total}</strong>
    </div>
    <div class="pagination-controls">
      <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" />
        </svg>
      </button>
      ${Array.from({ length: Math.min(pages, 7) }, (_, i) => {
        const p = i + 1;
        return `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
      }).join('')}
      <button class="page-btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>`;

  container.querySelectorAll('.page-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => onPage(parseInt(btn.dataset.page)));
  });
}
