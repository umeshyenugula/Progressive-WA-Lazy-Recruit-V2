/**
 * sidebar.js — Dynamic sidebar renderer for both roles
 */

const SUPERADMIN_NAV = [
  {
    label: "Overview",
    items: [
      { href: "dashboard.html",  icon: "grid",       text: "Dashboard" },
      { href: "candidates.html", icon: "users",      text: "Candidates" },
    ]
  },
  {
    label: "Management",
    items: [
      { href: "admins.html",     icon: "shield",     text: "Admins" },
      { href: "domains.html",    icon: "layers",     text: "Domains & Questions" },
    ]
  }
];

const ADMIN_NAV = [
  {
    label: "Overview",
    items: [
      { href: "dashboard.html",  icon: "grid",       text: "Dashboard" },
      { href: "candidates.html", icon: "users",      text: "My Candidates" },
    ]
  }
];

const SIDEBAR_ICONS = {
  grid: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v2.5A2.25 2.25 0 0 0 4.25 9h2.5A2.25 2.25 0 0 0 9 6.75v-2.5A2.25 2.25 0 0 0 6.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 2 13.25v2.5A2.25 2.25 0 0 0 4.25 18h2.5A2.25 2.25 0 0 0 9 15.75v-2.5A2.25 2.25 0 0 0 6.75 11h-2.5Zm9-9A2.25 2.25 0 0 0 11 4.25v2.5A2.25 2.25 0 0 0 13.25 9h2.5A2.25 2.25 0 0 0 18 6.75v-2.5A2.25 2.25 0 0 0 15.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 11 13.25v2.5A2.25 2.25 0 0 0 13.25 18h2.5A2.25 2.25 0 0 0 18 15.75v-2.5A2.25 2.25 0 0 0 15.75 11h-2.5Z" clip-rule="evenodd"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.661 2.237a.531.531 0 0 1 .678 0 11.947 11.947 0 0 0 7.078 2.749.5.5 0 0 1 .479.425c.069.52.104 1.05.104 1.589 0 5.162-3.26 9.563-7.834 11.256a.48.48 0 0 1-.332 0C5.26 16.564 2 12.163 2 7c0-.538.035-1.069.104-1.589a.5.5 0 0 1 .48-.425 11.947 11.947 0 0 0 7.077-2.749Z" clip-rule="evenodd"/></svg>`,
  layers: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10.362 1.093a.75.75 0 0 0-.724 0L2.523 5.018 10 9.143l7.477-4.125-7.115-3.925ZM18 6.443l-7.25 3.997v7.01l6.862-3.786A.75.75 0 0 0 18 13V6.443ZM9.25 17.45v-7.01L2 6.443V13a.75.75 0 0 0 .388.664l6.862 3.786Z"/></svg>`,
  device: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M4.75 3A1.75 1.75 0 0 0 3 4.75v10.5C3 16.216 3.784 17 4.75 17h10.5A1.75 1.75 0 0 0 17 15.25V4.75A1.75 1.75 0 0 0 15.25 3H4.75ZM4.5 5.5h11v8h-11v-8Z"/></svg>`,
  table: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25ZM2.5 8h15v6.75a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75V8Zm15-1.5h-15V5.25a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 .75.75V6.5Z" clip-rule="evenodd"/></svg>`,
  sync: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M15.312 4.99a.75.75 0 0 1 1.06.01A8 8 0 1 1 18 10a.75.75 0 0 1-1.5 0 6.5 6.5 0 1 0-1.32 3.94l-.97-.97a.75.75 0 0 1 1.06-1.06l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 1 1-1.06-1.06l.97-.97A8 8 0 0 1 2 10a8 8 0 0 1 13.313-5.01Z" clip-rule="evenodd"/></svg>`,
  logout: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M6 10a.75.75 0 0 1 .75-.75h9.546l-1.048-.943a.75.75 0 1 1 1.004-1.114l2.5 2.25a.75.75 0 0 1 0 1.114l-2.5 2.25a.75.75 0 1 1-1.004-1.114l1.048-.943H6.75A.75.75 0 0 1 6 10Z" clip-rule="evenodd"/></svg>`,
};

/**
 * Mount sidebar into #sidebar-placeholder
 * @param {'superadmin'|'admin'} role
 */
function mountSidebar(role) {
  const placeholder = document.getElementById('sidebar-placeholder');
  if (!placeholder) return;

  const nav = role === 'superadmin' ? SUPERADMIN_NAV : ADMIN_NAV;
  const roleLabel = role === 'superadmin' ? 'Super Admin' : 'Admin';
  const showOfflineCard = role !== 'superadmin';

  const sections = nav.map(section => `
    <div class="nav-section-label">${section.label}</div>
    ${section.items.map(item => `
      <a class="nav-item" href="${item.href}">
        ${SIDEBAR_ICONS[item.icon] || ''}
        ${item.text}
      </a>
    `).join('')}
  `).join('');

  placeholder.outerHTML = `
    <aside class="sidebar" id="app-sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="18" height="18">
            <path fill-rule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clip-rule="evenodd"/>
          </svg>
        </div>
        <h2>CSI EB Club Recruitment</h2>
        <p>${roleLabel} Panel</p>
      </div>

      <nav class="sidebar-nav">
        ${sections}
        ${showOfflineCard ? `
          <div class="nav-section-label">Local Device</div>
          <div class="sidebar-status-card" id="sidebar-sync-card">
            <div class="sidebar-status-title">${SIDEBAR_ICONS.device} Local Device Sync</div>
            <div class="sidebar-status-row">
              <span>Pending changes</span>
              <strong id="sidebar-sync-pending" class="sync-pending-pill">0</strong>
            </div>
            <div class="sidebar-status-row">
              <span>Uploaded records</span>
              <strong id="sidebar-sync-uploaded">0</strong>
            </div>
            <div class="sidebar-status-row">
              <span>Auto Sync</span>
              <strong id="sidebar-auto-sync-state">ON</strong>
            </div>
            <div class="sidebar-status-note" id="sidebar-sync-last">Last sync: --</div>
            <button class="btn btn-ghost btn-sm sidebar-sync-btn" id="btn-toggle-auto-sync" type="button">${SIDEBAR_ICONS.sync} Turn Auto Sync OFF</button>
            <button class="btn btn-ghost btn-sm sidebar-sync-btn" id="btn-view-sync-table" type="button">${SIDEBAR_ICONS.table} Pending Changes Table</button>
          </div>
        ` : ''}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="user-avatar" id="sidebar-user-avatar">?</div>
          <div class="user-info">
            <div class="user-name" id="sidebar-user-name">Loading…</div>
            <div class="user-role" id="sidebar-user-role">${roleLabel}</div>
          </div>
          <button class="btn-logout" id="btn-logout" title="Logout">
            ${SIDEBAR_ICONS.logout}
          </button>
        </div>
      </div>
    </aside>

    <!-- Mobile drawer backdrop -->
    <div class="sidebar-overlay" id="sidebar-overlay"></div>

    <div class="sidebar-data-modal hidden" id="sync-table-modal">
      <div class="sidebar-data-dialog">
        <div class="sidebar-data-head">
          <h3>Pending Upload Changes</h3>
          <button class="modal-close" id="btn-close-sync-table" type="button">✕</button>
        </div>
        <div class="sidebar-data-body" id="sync-table-content">
          <div class="loading-overlay"><div class="spinner"></div><span>Loading…</span></div>
        </div>
      </div>
    </div>`;

  // ── Inject hamburger into topbar ───────────────────────────
  const topbar = document.querySelector('.topbar');
  if (topbar && !topbar.querySelector('.btn-hamburger')) {
    const hamburger = document.createElement('button');
    hamburger.className = 'btn-hamburger';
    hamburger.setAttribute('aria-label', 'Open navigation');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 2 10Z" clip-rule="evenodd"/>
      </svg>`;
    topbar.insertBefore(hamburger, topbar.firstChild);
  }

  // ── Drawer open / close logic ──────────────────────────────
  const sidebar  = document.getElementById('app-sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const hamBtn   = document.querySelector('.btn-hamburger');
  const tableModal = document.getElementById('sync-table-modal');
  const tableContent = document.getElementById('sync-table-content');
  const openTableBtn = document.getElementById('btn-view-sync-table');
  const closeTableBtn = document.getElementById('btn-close-sync-table');
  const autoSyncStateEl = document.getElementById('sidebar-auto-sync-state');
  const autoSyncToggleBtn = document.getElementById('btn-toggle-auto-sync');

  function openDrawer() {
    sidebar.classList.add('drawer-open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    hamBtn?.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    sidebar.classList.remove('drawer-open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    hamBtn?.setAttribute('aria-expanded', 'false');
  }

  hamBtn?.addEventListener('click', () => {
    sidebar.classList.contains('drawer-open') ? closeDrawer() : openDrawer();
  });

  overlay?.addEventListener('click', closeDrawer);

  // Close drawer when a nav link is tapped on mobile
  sidebar?.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 900) closeDrawer();
    });
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDrawer();
  });

  // Re-run highlight after DOM update
  setTimeout(highlightNav, 0);

  function closeSyncTable() {
    tableModal?.classList.add('hidden');
  }

  async function openSyncTable() {
    if (!tableModal || !tableContent) return;
    tableModal.classList.remove('hidden');
    tableContent.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><span>Loading…</span></div>';

    if (!window.OfflineApp?.getPendingUploadPreview) {
      tableContent.innerHTML = '<p class="muted" style="padding:12px;">Preview unavailable.</p>';
      return;
    }

    try {
      const preview = await window.OfflineApp.getPendingUploadPreview();
      if (!preview.rows.length) {
        tableContent.innerHTML = '<p class="muted" style="padding:12px;">No unsaved local changes. Everything is already synced.</p>';
        return;
      }

      const esc = (v) => String(v ?? '—')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const fmtDate = (v) => v ? new Date(v).toLocaleString() : '—';

      const rows = preview.rows.map((r, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${esc(r.entity)}</td>
          <td>${esc(r.edit_type)}</td>
          <td>${esc(r.id || '—')}</td>
          <td>${fmtDate(r.updated_at)}</td>
          <td>${esc(r.payload?.name || '—')}</td>
          <td>${esc(r.payload?.email || '—')}</td>
          <td>${esc(r.payload?.status || '—')}</td>
          <td>${esc(r.payload?.candidate_id || '—')}</td>
          <td>${esc(r.payload?.domain_id || '—')}</td>
          <td>${esc(r.payload?.scores?.overall_rating ?? '—')}</td>
          <td>${esc(r.payload?.remarks || r.payload?.scores?.final_general_remarks || '—')}</td>
        </tr>
      `).join('');

      tableContent.innerHTML = `
        <div class="sidebar-data-summary">
          <span><strong>Total:</strong> ${preview.total}</span>
          <span><strong>Participants:</strong> ${preview.participants}</span>
          <span><strong>Evaluations:</strong> ${preview.evaluations}</span>
        </div>
        <div class="sidebar-data-table-wrap">
          <table class="sidebar-data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Edit</th>
                <th>ID</th>
                <th>Updated At</th>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Candidate ID</th>
                <th>Domain ID</th>
                <th>Overall</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    } catch (e) {
      tableContent.innerHTML = `<p class="muted" style="padding:12px;">Failed to load preview: ${e?.message || 'Unknown error'}</p>`;
    }
  }

  async function refreshSyncCard() {
    const pendingEl = document.getElementById('sidebar-sync-pending');
    const uploadedEl = document.getElementById('sidebar-sync-uploaded');
    const lastEl = document.getElementById('sidebar-sync-last');
    if (!pendingEl || !uploadedEl || !lastEl || !window.OfflineApp?.getLocalSyncStats) return;

    try {
      const stats = await window.OfflineApp.getLocalSyncStats();
      pendingEl.textContent = String(stats.pending || 0);
      uploadedEl.textContent = String(stats.uploaded || 0);
      lastEl.textContent = stats.lastSyncAt ? `Last sync: ${new Date(stats.lastSyncAt).toLocaleString()}` : 'Last sync: --';
      pendingEl.classList.toggle('is-clean', !(stats.pending > 0));
    } catch {
      pendingEl.textContent = '0';
      uploadedEl.textContent = '0';
      lastEl.textContent = 'Last sync: --';
      pendingEl.classList.add('is-clean');
    }
  }

  function refreshAutoSyncToggle() {
    if (!autoSyncStateEl || !autoSyncToggleBtn || !window.OfflineApp?.isAutoSyncEnabled) return;
    const enabled = !!window.OfflineApp.isAutoSyncEnabled();
    autoSyncStateEl.textContent = enabled ? 'ON' : 'OFF';
    autoSyncStateEl.style.color = enabled ? 'var(--green)' : 'var(--amber)';
    autoSyncToggleBtn.innerHTML = enabled
      ? `${SIDEBAR_ICONS.sync} Turn Auto Sync OFF`
      : `${SIDEBAR_ICONS.sync} Turn Auto Sync ON`;
  }

  refreshSyncCard();
  refreshAutoSyncToggle();
  window.addEventListener('crm:sync-state-changed', refreshSyncCard);
  window.addEventListener('crm:offline-setup-progress', refreshSyncCard);
  window.addEventListener('online', refreshSyncCard);
  window.addEventListener('offline', refreshSyncCard);
  window.addEventListener('crm:auto-sync-setting-changed', refreshAutoSyncToggle);

  openTableBtn?.addEventListener('click', openSyncTable);
  autoSyncToggleBtn?.addEventListener('click', async () => {
    if (!window.OfflineApp?.setAutoSyncEnabled || !window.OfflineApp?.isAutoSyncEnabled) return;
    const next = !window.OfflineApp.isAutoSyncEnabled();
    window.OfflineApp.setAutoSyncEnabled(next);
    refreshAutoSyncToggle();
  });
  closeTableBtn?.addEventListener('click', closeSyncTable);
  tableModal?.addEventListener('click', (e) => {
    if (e.target === tableModal) closeSyncTable();
  });
}
