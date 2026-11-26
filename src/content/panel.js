/* ContactVault — List Send: Gmail and Private Email list panel. */

(function () {
  if (window.__CVLIST_READY__) return;
  window.__CVLIST_READY__ = true;

  const HOST_ID = 'cvlist-host';
  const HOST_STYLE_ID = 'cvlist-host-style';
  const COLLAPSED_KEY = 'cvlist.collapsed';
  const PAGE_KEY = 'cvlist.page';
  const ALIAS_KEY = 'cvlist.selectedAlias';
  const ALIASES_KEY = 'cvlist.selectedAliases';
  const INTERVAL_KEY = 'cvlist.sendIntervalMin';
  const PAGE_SIZES = [25, 50, 100];
  const DEFAULT_PAGE_SIZE = 25;
  const DEFAULT_INTERVAL_MIN = 0;

  const LOGO =
    '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.6 20.5 7v10L12 21.4 3.5 17V7L12 2.6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.6 12.3l2.4 2.4 4.6-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const Api = () => window.CVListApi;
  const Mail = () => window.CVListMail || window.CVListGmail;
  const Sheet = () => window.CVListSheet;

  function mailPlatform() {
    try {
      return Mail().platformName || 'Mailbox';
    } catch {
      return 'Mailbox';
    }
  }

  const state = {
    open: true,
    page: 'main',
    accounts: [],
    templates: [],
    schedule: [],
    stats: { total: 0, sent: 0, verified: 0 },
    query: '',
    listPage: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    selected: new Set(),
    gmailEmail: null,
    gmailReady: false,
    aliases: [],
    selectedAliases: new Set(),
    aliasesLoading: false,
    aliasesError: '',
    sendIntervalMin: DEFAULT_INTERVAL_MIN,
    busy: false,
    editingTpl: null,
    sendProgress: null,
    busyMode: null,
    error: '',
    status: ''
  };

  let identityTimer = null;
  let gmailReadyTimer = null;

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  function ensureFonts() {
    if (document.getElementById('cvlist-fonts')) return;
    const link = document.createElement('link');
    link.id = 'cvlist-fonts';
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Manrope:wght@400;500;600;700&display=swap';
    (document.head || document.documentElement).appendChild(link);
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0 0 0 auto;width:0;height:0;z-index:2147483645;';
  const root = host.attachShadow({ mode: 'open' });

  function injectHostStyle() {
    if (document.getElementById(HOST_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = HOST_STYLE_ID;
    style.textContent = `
      html.cvlist-docked {
        width: 70vw !important;
        min-width: 70vw !important;
        max-width: 70vw !important;
      }
      html.cvlist-docked body {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        transform: translateZ(0) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const setDocked = (docked) => document.documentElement.classList.toggle('cvlist-docked', docked);

  root.innerHTML = `
    <div class="app" id="shell">
      <div class="atmosphere" aria-hidden="true">
        <span class="orb orb-a"></span>
        <span class="orb orb-b"></span>
        <span class="grain"></span>
      </div>
      <div class="hdr">
        <div class="brand">
          <div class="mark">${LOGO}</div>
          <div class="brand-txt">
            <h1>Connect<span>V</span></h1>
            <p>List send</p>
          </div>
        </div>
        <div class="hdr-actions">
          <button type="button" class="icon-btn" id="toggleBtn" title="Hide panel">›</button>
        </div>
      </div>
      <div class="tabs" id="tabs">
        <button type="button" class="tab tab-mail" data-page="mail" id="mailTabBtn" hidden title="Private Email From aliases">Mail</button>
        <button type="button" class="tab" data-page="main">Main</button>
        <button type="button" class="tab" data-page="templates">Templates</button>
      </div>
      <div class="body" id="body"></div>
      <div class="toasts" id="toasts"></div>
    </div>
    <button type="button" class="launcher" id="launcher" title="Show ConnectV">${LOGO}<span>ConnectV</span></button>
  `;

  fetch(chrome.runtime.getURL('src/content/panel-ui.css'))
    .then((r) => r.text())
    .then((css) => {
      const style = document.createElement('style');
      style.textContent = css;
      root.prepend(style);
    })
    .catch(() => {});

  const body = root.getElementById('body');
  const toastsEl = root.getElementById('toasts');
  const toggleBtn = root.getElementById('toggleBtn');
  const launcher = root.getElementById('launcher');

  function setCollapsed(collapsed) {
    state.open = !collapsed;
    host.classList.toggle('collapsed', collapsed);
    setDocked(!collapsed);
    chrome.storage.local.set({ [COLLAPSED_KEY]: collapsed });
    toggleBtn.textContent = collapsed ? '‹' : '›';
  }

  toggleBtn.addEventListener('click', () => setCollapsed(true));
  launcher.addEventListener('click', () => setCollapsed(false));

  root.getElementById('tabs').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn || btn.hidden) return;
    state.page = btn.dataset.page;
    chrome.storage.local.set({ [PAGE_KEY]: state.page });
    render();
  });

  function toast(kind, title, detail) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `
      <div class="msg"><b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}</div>
      <button type="button" class="close" aria-label="Close">×</button>
    `;
    el.querySelector('.close').addEventListener('click', () => el.remove());
    toastsEl.appendChild(el);
    setTimeout(() => {
      if (el.isConnected) el.remove();
    }, 5200);
  }

  function refreshGmailIdentity() {
    state.gmailEmail = Mail().detectLoggedInEmail();
    state.gmailReady = Mail().isGmailPageReady();
  }

  function isPrivateEmailHost() {
    return /(^|\.)privateemail\.com$/i.test(location.hostname) || /(^|\.)spacemail\.com$/i.test(location.hostname);
  }

  function supportsAliases() {
    if (!isPrivateEmailHost()) return false;
    try {
      return Boolean(Mail().supportsAliases && typeof Mail().listAliases === 'function');
    } catch {
      return false;
    }
  }

  function gmailChipHtml() {
    const addr = state.gmailEmail || 'Not detected';
    return `<span class="gmail-chip" id="gmailLabel" title="${esc(addr)}">
      <span class="gmail-chip-kicker">${esc(mailPlatform())}</span>
      <span class="gmail-chip-addr">${esc(addr)}</span>
    </span>`;
  }

  function selectedAliasList() {
    return [...state.selectedAliases].filter((email) => state.aliases.includes(email));
  }

  function randomSelectedAlias() {
    const list = selectedAliasList();
    if (!list.length) return null;
    const Human = window.CVListHuman;
    if (Human && typeof Human.randInt === 'function') {
      return list[Human.randInt(0, list.length - 1)];
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function aliasListHtml() {
    const aliases = state.aliases || [];
    const loading = state.aliasesLoading;
    const err = state.aliasesError
      ? `<span class="alias-err" title="${esc(state.aliasesError)}">${esc(state.aliasesError)}</span>`
      : '';
    if (!aliases.length) {
      return `
        <div class="alias-bar" id="aliasBar">
          <div class="alias-empty">${loading ? 'Loading aliases…' : 'Load aliases to see and select From addresses.'}</div>
          ${err}
        </div>`;
    }
    const selectedCount = selectedAliasList().length;
    const chips = aliases
      .map((email) => {
        const on = state.selectedAliases.has(email);
        return `<button type="button" class="alias-chip${on ? ' is-on' : ''}" data-alias="${esc(
          email
        )}" title="${esc(email)}" ${loading || state.busy ? 'disabled' : ''} aria-pressed="${
          on ? 'true' : 'false'
        }">${esc(email)}</button>`;
      })
      .join('');
    return `
      <div class="alias-bar" id="aliasBar">
        <div class="alias-bar-head">
          <span class="alias-label">From aliases</span>
          <span class="alias-count">${selectedCount} selected · ${aliases.length} loaded</span>
        </div>
        <div class="alias-actions">
          <button type="button" class="secondary" id="aliasSelectAll" ${
            loading || state.busy ? 'disabled' : ''
          }>Select all</button>
          <button type="button" class="secondary" id="aliasClearAll" ${
            loading || state.busy ? 'disabled' : ''
          }>Clear</button>
        </div>
        <div class="alias-chip-grid">${chips}</div>
        ${err}
      </div>`;
  }

  function syncMailTab() {
    const btn = root.getElementById('mailTabBtn');
    if (!btn) return;
    const show = supportsAliases();
    btn.hidden = !show;
    if (!show && state.page === 'mail') {
      state.page = 'main';
      chrome.storage.local.set({ [PAGE_KEY]: 'main' });
    }
    if (!show) return;
    btn.textContent = 'Mail';
    btn.disabled = false;
    btn.classList.toggle('is-active', state.page === 'mail');
  }

  function applyGmailChip() {
    const addr = root.querySelector('#gmailLabel .gmail-chip-addr');
    if (addr) addr.textContent = state.gmailEmail || 'Not detected';
  }

  async function persistSelectedAliases() {
    const list = selectedAliasList();
    await chrome.storage.local.set({
      [ALIASES_KEY]: list,
      [ALIAS_KEY]: list[0] || ''
    });
  }

  function updateMailSelectionSummary() {
    const summary = root.querySelector('.mail-selected-addr');
    if (!summary) return;
    const list = selectedAliasList();
    if (!list.length) {
      summary.textContent = 'None selected';
      return;
    }
    if (list.length === 1) {
      summary.textContent = list[0];
      return;
    }
    summary.textContent = `${list.length} aliases (random per send)`;
  }

  function wireAliasControls() {
    root.querySelectorAll('.alias-chip[data-alias]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const email = String(chip.dataset.alias || '').toLowerCase();
        if (!email) return;
        if (state.selectedAliases.has(email)) state.selectedAliases.delete(email);
        else state.selectedAliases.add(email);
        const on = state.selectedAliases.has(email);
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        void persistSelectedAliases().then(() => {
          updateMailSelectionSummary();
          const count = root.querySelector('.alias-count');
          if (count) {
            count.textContent = `${selectedAliasList().length} selected · ${state.aliases.length} loaded`;
          }
          syncSendButton();
        });
      });
    });
    root.getElementById('aliasSelectAll')?.addEventListener('click', () => {
      state.aliases.forEach((email) => state.selectedAliases.add(email));
      void persistSelectedAliases().then(() => {
        refreshMailPageDom();
        syncSendButton();
      });
    });
    root.getElementById('aliasClearAll')?.addEventListener('click', () => {
      state.selectedAliases.clear();
      void persistSelectedAliases().then(() => {
        refreshMailPageDom();
        syncSendButton();
      });
    });
  }

  function refreshMailPageDom() {
    if (state.page !== 'mail') return;
    const chip = root.querySelector('#gmailLabel .gmail-chip-addr');
    if (chip) chip.textContent = state.gmailEmail || 'Not detected';
    const bar = root.getElementById('aliasBar');
    if (bar) {
      bar.outerHTML = aliasListHtml();
      wireAliasControls();
    }
    updateMailSelectionSummary();
    const loadBtn = root.getElementById('aliasLoadBtn');
    if (loadBtn) {
      loadBtn.disabled = state.busy || state.aliasesLoading || !state.gmailReady;
      loadBtn.textContent = state.aliasesLoading
        ? 'Loading…'
        : state.aliases.length
          ? `Reload aliases (${state.aliases.length})`
          : 'Load aliases';
    }
  }

  async function refreshAliases({ force = false } = {}) {
    if (!supportsAliases()) {
      state.aliases = [];
      state.aliasesError = '';
      syncMailTab();
      return;
    }
    if (state.aliasesLoading) return;
    if (!force && state.aliases.length && selectedAliasList().length) return;
    if (!state.gmailReady && !force) return;

    state.aliasesLoading = true;
    state.aliasesError = '';
    refreshMailPageDom();

    try {
      const aliases = await Mail().listAliases((msg) => {
        state.status = msg;
        const loadBtn = root.getElementById('aliasLoadBtn');
        if (loadBtn && state.aliasesLoading) loadBtn.title = msg;
      });
      state.aliases = (aliases || []).map((item) => String(item).toLowerCase()).filter(Boolean);
      if (!state.aliases.length) {
        state.aliasesError = 'No aliases detected. Keep Private Email open, then load again.';
      } else if (state.aliases.length === 1) {
        state.aliasesError = 'Only 1 address found. Open Compose, click From, then load again.';
      } else {
        state.aliasesError = '';
      }

      const next = new Set();
      for (const email of state.selectedAliases) {
        if (state.aliases.includes(email)) next.add(email);
      }
      if (!next.size && state.aliases.length) {
        state.aliases.forEach((email) => next.add(email));
      }
      state.selectedAliases = next;
      await persistSelectedAliases();
      refreshMailPageDom();
      toast(
        state.aliases.length > 1 ? 'ok' : 'err',
        state.aliases.length ? `Loaded ${state.aliases.length} aliases` : 'Aliases not found',
        state.aliasesError || `${selectedAliasList().length} selected`
      );
    } catch (err) {
      state.aliasesError = err.message || 'Could not load aliases.';
      refreshMailPageDom();
      toast('err', 'Alias load failed', state.aliasesError);
    } finally {
      state.aliasesLoading = false;
      refreshMailPageDom();
      syncMailTab();
      syncSendButton();
    }
  }

  function formatWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function verifyLabel(status) {
    switch (String(status || 'pending').toLowerCase()) {
      case 'valid':
        return 'Verified';
      case 'invalid':
        return 'Invalid';
      case 'risky':
        return 'Risky';
      case 'checking':
        return 'Checking…';
      case 'error':
        return 'Verify error';
      case 'unknown':
        return 'Unknown';
      default:
        return 'Pending';
    }
  }

  function selectedCount() {
    return selectedSendable().length;
  }

  function statsHtml() {
    const s = state.stats || {};
    return `
      <div class="stats" id="statsBar">
        <span class="stat-pill"><b>${s.total ?? 0}</b><span>accounts</span></span>
        <span class="stat-pill"><b>${s.sent ?? 0}</b><span>sent</span></span>
        <span class="stat-pill"><b>${s.verified ?? 0}</b><span>verified</span></span>
        <span class="stat-pill stat-pill-selected"><b id="selectedStat">${selectedCount()}</b><span>selected</span></span>
      </div>`;
  }

  function syncSelectedStat() {
    const el = root.getElementById('selectedStat');
    if (el) el.textContent = String(selectedCount());
  }

  function progressHtml() {
    const p = state.sendProgress;
    if (!p) return '';
    const pct = Math.max(0, Math.min(100, Number(p.pct) || 0));
    return `
      <div class="send-progress" id="sendProgress">
        <div class="send-progress-meta">
          <span>${esc(p.label || 'Sending…')}</span>
          <b>${esc(String(p.index || 0))}/${esc(String(p.total || 0))} · ${Math.round(pct)}%</b>
        </div>
        <div class="send-progress-track">
          <div class="send-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  function setSendProgress(index, total, label) {
    const safeTotal = Math.max(1, total || 1);
    const done = Math.max(0, Math.min(index, safeTotal));
    state.sendProgress = {
      index: done,
      total: safeTotal,
      pct: Math.round((done / safeTotal) * 100),
      label: label || `Account ${done}/${safeTotal}`
    };
  }

  function updateProgressDom() {
    const el = body.querySelector('#sendProgress');
    const html = progressHtml();
    if (!state.sendProgress) {
      if (el) el.remove();
      return;
    }
    if (el) el.outerHTML = html;
    else {
      const toolbar = body.querySelector('.toolbar');
      if (toolbar) toolbar.insertAdjacentHTML('afterend', html);
    }
  }

  function canSendAccount(acc) {
    if (!acc || acc.sent) return false;
    const status = String(acc.verifyStatus || '').toLowerCase();
    return status === 'valid' || status === 'unknown';
  }

  function selectedSendable() {
    const chosen = state.selected;
    return (state.accounts || []).filter((acc) => chosen.has(acc.id) && canSendAccount(acc));
  }

  function filteredAccounts() {
    const q = state.query.trim().toLowerCase();
    const list = state.accounts || [];
    if (!q) return list;
    return list.filter((a) => a.email.includes(q) || String(a.verifyStatus || '').includes(q));
  }

  function listPaging() {
    const list = filteredAccounts();
    const size = PAGE_SIZES.includes(Number(state.pageSize)) ? Number(state.pageSize) : DEFAULT_PAGE_SIZE;
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / size) || 1);
    const page = Math.min(Math.max(1, Number(state.listPage) || 1), totalPages);
    state.pageSize = size;
    state.listPage = page;
    const start = total === 0 ? 0 : (page - 1) * size;
    const end = Math.min(start + size, total);
    return {
      list,
      slice: list.slice(start, end),
      total,
      page,
      totalPages,
      from: total === 0 ? 0 : start + 1,
      to: end,
      size
    };
  }

  function pagerHtml(paging) {
    if (!paging.total) return '';
    return `
      <div class="pager">
        <span class="pager-range">${paging.from}–${paging.to} of ${paging.total}</span>
        <label class="pager-size">
          <span>Per page</span>
          <select data-page-size>
            ${PAGE_SIZES.map(
              (n) =>
                `<option value="${n}"${n === paging.size ? ' selected' : ''}>${n}</option>`
            ).join('')}
          </select>
        </label>
        <div class="pager-nav">
          <button type="button" class="secondary" data-page-prev ${
            paging.page <= 1 ? 'disabled' : ''
          } aria-label="Previous page">‹</button>
          <span class="pager-pos">${paging.page} / ${paging.totalPages}</span>
          <button type="button" class="secondary" data-page-next ${
            paging.page >= paging.totalPages ? 'disabled' : ''
          } aria-label="Next page">›</button>
        </div>
      </div>`;
  }

  function statusCell(acc) {
    const status = String(acc.verifyStatus || 'pending').toLowerCase();
    const label = verifyLabel(status);
    const sentTitle = acc.sent ? `Sent ${formatWhen(acc.sentAt)}` : label;
    const sent = acc.sent ? `<span class="sent-time" title="${esc(sentTitle)}">Sent</span>` : '';
    const err = acc.verifyError
      ? `<span class="verify-err" title="${esc(acc.verifyError)}">${esc(acc.verifyError)}</span>`
      : '';
    return `<span class="status-cell" title="${esc(acc.verifyError || sentTitle)}">
      <span class="verify-dot ${esc(status)}"></span>
      <span class="status-label">${esc(label)}</span>
      ${sent}
      ${err}
    </span>`;
  }

  function renderMailTable() {
    const paging = listPaging();
    if (!paging.total) {
      return `<div id="mailList"><div class="empty"><h3>No accounts</h3><p>Upload a CSV or Excel file. Column A is the address; column B is the verify status (valid, invalid, risky).</p></div></div>`;
    }
    const selectableIds = paging.slice.filter(canSendAccount).map((acc) => acc.id);
    const selectedOnPage = selectableIds.filter((id) => state.selected.has(id)).length;
    const pageChecked = selectableIds.length > 0 && selectedOnPage === selectableIds.length;
    const rows = paging.slice
      .map((acc, index) => {
        const no = paging.from + index;
        const sendable = canSendAccount(acc);
        const checked = sendable && state.selected.has(acc.id);
        return `<tr class="mail-row${acc.sent ? ' is-sent' : ''}" data-id="${esc(acc.id)}">
          <td class="col-check"><input type="checkbox" class="row-check" data-id="${esc(acc.id)}" aria-label="Select ${esc(acc.email)}" ${
            checked ? 'checked' : ''
          } ${sendable && !state.busy ? '' : 'disabled'} /></td>
          <td class="col-no">${no}</td>
          <td class="col-gmail">${esc(acc.email)}</td>
          <td class="col-status">${statusCell(acc)}</td>
        </tr>`;
      })
      .join('');
    return `
      <div id="mailList">
        ${pagerHtml(paging)}
        <div class="table-wrap">
          <table class="mail-table">
            <thead>
              <tr>
                <th class="col-check"><input type="checkbox" id="selectPage" aria-label="Select accounts on this page" ${
                  pageChecked ? 'checked' : ''
                } ${selectableIds.length && !state.busy ? '' : 'disabled'} /></th>
                <th class="col-no">No</th>
                <th>Gmail</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${pagerHtml(paging)}
      </div>`;
  }

  function refreshMailList() {
    const scroll = body.querySelector('.scroll');
    const keep = scroll?.scrollTop || 0;
    const list = root.getElementById('mailList');
    if (!list) return;
    list.outerHTML = renderMailTable();
    wireMailPager();
    wireSelection();
    syncSendButton();
    if (scroll) scroll.scrollTop = keep;
  }

  function wireMailPager() {
    root.querySelectorAll('[data-page-prev]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.listPage = Math.max(1, state.listPage - 1);
        refreshMailList();
      });
    });
    root.querySelectorAll('[data-page-next]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.listPage += 1;
        refreshMailList();
      });
    });
    root.querySelectorAll('[data-page-size]').forEach((sel) => {
      sel.addEventListener('change', () => {
        state.pageSize = Number(sel.value) || DEFAULT_PAGE_SIZE;
        state.listPage = 1;
        refreshMailList();
      });
    });
  }

  function wireSelection() {
    const paging = listPaging();
    const pageIds = paging.slice.filter(canSendAccount).map((acc) => acc.id);
    const pageBox = root.getElementById('selectPage');
    if (pageBox) {
      const selectedOnPage = pageIds.filter((id) => state.selected.has(id)).length;
      pageBox.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
      pageBox.addEventListener('change', () => {
        if (pageBox.checked) pageIds.forEach((id) => state.selected.add(id));
        else pageIds.forEach((id) => state.selected.delete(id));
        refreshMailList();
      });
    }
    root.querySelectorAll('.row-check').forEach((box) => {
      box.addEventListener('change', () => {
        const id = box.dataset.id;
        if (box.checked) state.selected.add(id);
        else state.selected.delete(id);
        const selectedOnPage = pageIds.filter((item) => state.selected.has(item)).length;
        if (pageBox) {
          pageBox.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
          pageBox.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
        }
        syncSendButton();
      });
    });
  }

  function renderMailPage() {
    refreshGmailIdentity();
    const selected = selectedAliasList();
    const selectedLabel = !selected.length
      ? 'None selected'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} aliases (random per send)`;
    body.innerHTML = `
      <div class="page">
        <div class="meta-bar mail-meta">
          <div class="meta-side mail-identity">
            ${gmailChipHtml()}
          </div>
        </div>
        <div class="scroll">
          <div class="mail-page">
            <h3 class="section-label">Private Email sender</h3>
            <p class="mail-page-copy">
              Select one or more aliases. Each message is sent from a random selected alias.
            </p>
            <div class="toolbar">
              <button type="button" class="primary" id="aliasLoadBtn" ${
                state.busy || state.aliasesLoading || !state.gmailReady ? 'disabled' : ''
              }>
                ${
                  state.aliasesLoading
                    ? 'Loading…'
                    : state.aliases.length
                      ? `Reload aliases (${state.aliases.length})`
                      : 'Load aliases'
                }
              </button>
            </div>
            ${aliasListHtml()}
            <div class="mail-selected">
              <span class="mail-selected-kicker">Selected From pool</span>
              <span class="mail-selected-addr">${esc(selectedLabel)}</span>
            </div>
          </div>
        </div>
      </div>`;

    wireAliasControls();
    root.getElementById('aliasLoadBtn')?.addEventListener('click', () => {
      void refreshAliases({ force: true });
    });
    syncMailTab();
  }

  function renderMain() {
    refreshGmailIdentity();
    const selected = selectedAliasList();
    const aliasChip =
      supportsAliases() && selected.length
        ? `<span class="gmail-chip" title="${esc(selected.join(', '))}">
            <span class="gmail-chip-kicker">From pool</span>
            <span class="gmail-chip-addr">${esc(
              selected.length === 1 ? selected[0] : `${selected.length} aliases · random`
            )}</span>
          </span>`
        : '';
    body.innerHTML = `
      <div class="page">
        <div class="meta-bar">
          ${statsHtml()}
          ${aliasChip}
        </div>
        <div class="scroll">
          <div class="toolbar">
            <button type="button" class="primary" id="uploadBtn">Upload list</button>
            <input type="file" id="listFile" accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden />
            <input class="grow" id="search" placeholder="Search list…" value="${esc(state.query)}" />
            <button type="button" class="secondary" id="clearBtn" ${
              state.accounts.length ? '' : 'disabled'
            }>Clear list</button>
          </div>
          ${progressHtml()}
          ${renderMailTable()}
        </div>
        <div class="foot">
          <label class="interval-field" title="Minutes to wait between each send. 0 = fast (a few seconds).">
            <span>Every</span>
            <input
              type="number"
              id="sendInterval"
              min="0"
              step="0.1"
              inputmode="decimal"
              value="${esc(String(state.sendIntervalMin ?? 0))}"
              ${state.busy ? 'disabled' : ''}
            />
            <span>min</span>
          </label>
          <span class="foot-note" id="selectCount"></span>
          <button type="button" class="primary" id="sendBtn">Send</button>
        </div>
      </div>`;

    root.getElementById('search')?.addEventListener('input', (event) => {
      state.query = event.target.value;
      state.listPage = 1;
      refreshMailList();
    });

    root.getElementById('uploadBtn')?.addEventListener('click', () => {
      root.getElementById('listFile')?.click();
    });
    root.getElementById('listFile')?.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) void importListFile(file);
    });
    root.getElementById('clearBtn')?.addEventListener('click', () => {
      void clearList();
    });
    root.getElementById('sendInterval')?.addEventListener('change', () => {
      void persistSendInterval();
    });
    root.getElementById('sendBtn')?.addEventListener('click', () => {
      void sendSelected();
    });

    wireMailPager();
    wireSelection();
    syncMailTab();
    syncSendButton();
  }

  function normalizeIntervalMin(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_INTERVAL_MIN;
    // Allow decimals (e.g. 0.5 = 30s). Round to 1 decimal place.
    const rounded = Math.round(n * 10) / 10;
    return Math.min(24 * 60, rounded);
  }

  async function persistSendInterval() {
    const input = root.getElementById('sendInterval');
    state.sendIntervalMin = normalizeIntervalMin(input ? input.value : state.sendIntervalMin);
    if (input) input.value = String(state.sendIntervalMin);
    await chrome.storage.local.set({ [INTERVAL_KEY]: state.sendIntervalMin });
  }

  function formatWaitLabel(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins < 60) return secs ? `${mins}m ${secs}s` : `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMin = mins % 60;
    return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  }

  async function waitBetweenSends(index, total) {
    const minutes = normalizeIntervalMin(state.sendIntervalMin);
    let waitMs;
    if (minutes <= 0) {
      waitMs = window.CVListHuman.randInt(1000, 5000);
    } else {
      waitMs = minutes * 60 * 1000;
    }
    const endsAt = Date.now() + waitMs;
    while (Date.now() < endsAt) {
      const left = endsAt - Date.now();
      setSendProgress(index, total, `Next send in ${formatWaitLabel(left)}`);
      updateProgressDom();
      await window.CVListHuman.delay(Math.min(1000, left));
    }
  }

  function skipSummary(parsed, storedSkip) {
    const bits = [];
    if (parsed.empty) bits.push(`${parsed.empty} empty`);
    if (parsed.invalid) bits.push(`${parsed.invalid} not a valid email`);
    if (parsed.duplicates) bits.push(`${parsed.duplicates} duplicate`);
    if (storedSkip) bits.push(`${storedSkip} already in store`);
    return bits.join(' · ');
  }

  async function importListFile(file) {
    try {
      const parsed = await Sheet().parseEmailListFile(file);
      if (!parsed.accounts.length) {
        const detail = skipSummary(parsed, 0) || 'No email column with valid addresses.';
        toast('err', 'No valid emails', detail);
        return;
      }
      const result = await Api().importAccounts(parsed.accounts);
      await loadState();
      const extra = skipSummary(parsed, result.skipped);
      const bits = [`${result.stats?.verified ?? 0} marked valid`];
      if (result.updated) bits.unshift(`${result.updated} status updated`);
      if (extra) bits.push(extra);
      toast('ok', `Imported ${result.added}`, bits.join(' · '));
      render();
    } catch (err) {
      toast('err', 'Upload failed', err.message);
    }
  }

  async function clearList() {
    try {
      state.selected.clear();
      await Api().clearAccounts();
      await loadState();
      toast('ok', 'List cleared', 'This extension store is empty.');
      render();
    } catch (err) {
      toast('err', 'Clear failed', err.message);
    }
  }

  function renderTemplates() {
    const titles = state.templates.filter((t) => t.kind === 'title');
    const contents = state.templates.filter((t) => t.kind === 'content');
    const editing = state.editingTpl;
    body.innerHTML = `
      <div class="page">
        <div class="meta-bar">
          ${statsHtml()}
          ${gmailChipHtml()}
        </div>
        <div class="scroll">
          <form id="tplForm">
            <div class="field">
              <label>Kind</label>
              <select id="tplKind">
                <option value="title" ${editing?.kind === 'content' ? '' : 'selected'}>Title template</option>
                <option value="content" ${editing?.kind === 'content' ? 'selected' : ''}>Content template</option>
              </select>
            </div>
            <div class="field">
              <label>${editing ? 'Edit template' : 'New template'}</label>
              <textarea id="tplContent" placeholder="Subject or body. Use {Hello | Hi} for a random choice.">${esc(
                editing?.content || ''
              )}</textarea>
            </div>
            <div class="toolbar">
              <button type="submit" class="primary" id="tplSave">${
                editing ? 'Save changes' : 'Create template'
              }</button>
              ${editing ? '<button type="button" class="secondary" id="tplCancel">Cancel</button>' : ''}
            </div>
          </form>
          <h3 class="section-label">Title templates (${titles.length})</h3>
          ${renderTplList(titles, 'title')}
          <h3 class="section-label">Content templates (${contents.length})</h3>
          ${renderTplList(contents, 'content')}
        </div>
      </div>`;

    root.getElementById('tplForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveTemplate();
    });
    root.getElementById('tplCancel')?.addEventListener('click', () => {
      state.editingTpl = null;
      render();
    });
    root.querySelectorAll('[data-edit-tpl]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.editingTpl = state.templates.find((t) => t.id === btn.dataset.editTpl) || null;
        render();
      });
    });
    root.querySelectorAll('[data-del-tpl]').forEach((btn) => {
      btn.addEventListener('click', () => void deleteTemplate(btn.dataset.delTpl));
    });
  }

  function renderTplList(list, kind) {
    if (!list.length) {
      return `<div class="empty"><p>No ${kind} templates yet.</p></div>`;
    }
    return `<div class="cards">${list
      .map(
        (t) => `
        <article class="tpl-card">
          <div class="kind">${esc(t.kind)}</div>
          <pre>${esc(t.content)}</pre>
          <div class="tpl-actions">
            <button type="button" class="secondary" data-edit-tpl="${esc(t.id)}">Edit</button>
            <button type="button" class="ghost" data-del-tpl="${esc(t.id)}">Delete</button>
          </div>
        </article>`
      )
      .join('')}</div>`;
  }

  async function saveTemplate() {
    const kind = root.getElementById('tplKind')?.value;
    const content = root.getElementById('tplContent')?.value || '';
    const btn = root.getElementById('tplSave');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }
    try {
      const data = await Api().saveTemplate({
        id: state.editingTpl?.id || null,
        kind,
        content
      });
      state.templates = data.templates || [];
      state.editingTpl = null;
      toast('ok', 'Template saved', kind === 'title' ? 'Title' : 'Content');
      render();
    } catch (err) {
      toast('err', 'Save failed', err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = state.editingTpl ? 'Save changes' : 'Create template';
      }
    }
  }

  async function deleteTemplate(id) {
    try {
      const data = await Api().deleteTemplate(id);
      state.templates = data.templates || [];
      if (state.editingTpl?.id === id) state.editingTpl = null;
      toast('ok', 'Template deleted');
      render();
    } catch (err) {
      toast('err', 'Delete failed', err.message);
    }
  }

  function sendButtonLabel() {
    const count = selectedSendable().length;
    if (state.busy) return 'Sending…';
    if (!state.gmailReady) return `${mailPlatform()} loading…`;
    if (supportsAliases() && !selectedAliasList().length) return 'Open Mail tab';
    return count ? `Send (${count})` : 'Send';
  }

  function syncSendButton() {
    const btn = root.getElementById('sendBtn');
    const note = root.getElementById('selectCount');
    const count = selectedCount();
    const aliasOk = !supportsAliases() || selectedAliasList().length > 0;
    syncSelectedStat();
    if (note) {
      if (supportsAliases() && !selectedAliasList().length) {
        note.textContent = 'Open Mail tab and select From aliases';
      } else note.textContent = count ? `${count} selected` : 'Select addresses to send';
    }
    if (!btn) return;
    btn.disabled = state.busy || !state.gmailReady || !count || !aliasOk;
    btn.textContent = state.busy ? 'Sending…' : sendButtonLabel();
  }

  async function sendSelected() {
    if (state.busy) return;
    const chosen = selectedSendable();
    refreshGmailIdentity();
    await persistSendInterval();
    if (!chosen.length) {
      toast('err', 'Nothing selected', 'Select unsent addresses with valid or unknown status.');
      return;
    }
    if (!state.gmailReady) {
      toast('err', `${mailPlatform()} still loading`, 'Wait until the inbox is ready.');
      return;
    }
    if (supportsAliases() && !selectedAliasList().length) {
      toast('err', 'Select From aliases', 'Open the Mail tab, load aliases, and check one or more.');
      return;
    }

    state.busy = true;
    state.busyMode = 'direct';
    setSendProgress(0, chosen.length, 'Starting…');
    render();

    try {
      const data = await Api().prepareDirectSend(
        chosen.length,
        chosen.map((acc) => acc.id)
      );
      const items = data.items || [];
      state.stats = data.stats || state.stats;
      if (!items.length) {
        toast('err', 'Nothing to send', 'No unsent accounts with valid or unknown status.');
        return;
      }

      await Mail().waitUntilGmailReady((msg) => {
        setSendProgress(0, items.length, msg);
        updateProgressDom();
      });

      const fromPool = supportsAliases() ? selectedAliasList() : [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const fromHint = fromPool.length ? randomSelectedAlias() : null;
        setSendProgress(i, items.length, fromHint ? `${item.email} ← ${fromHint}` : item.email);
        updateProgressDom();
        try {
          await Mail().sendCard(
            {
              toEmail: item.email,
              messageTitle: item.title,
              messageBody: item.body,
              fromEmail: fromHint,
              fromEmails: fromPool
            },
            (msg) => {
              setSendProgress(i, items.length, `${item.email}: ${msg}`);
              updateProgressDom();
            }
          );
          const marked = await Api().markAccountSent(item.accountId);
          state.accounts = marked.accounts || state.accounts;
          state.stats = marked.stats || state.stats;
          state.selected.delete(item.accountId);
          setSendProgress(i + 1, items.length, `${item.email}: sent`);
          updateProgressDom();
          patchMailCards();
          syncSendButton();
          if (i + 1 < items.length) {
            await waitBetweenSends(i + 1, items.length);
          }
        } catch (err) {
          toast('err', 'Send failed', err.message || 'Send failed.');
          break;
        }
      }

      const sentNow = items.filter((item) =>
        (state.accounts || []).some((account) => account.id === item.accountId && account.sent)
      ).length;
      if (sentNow === items.length) {
        toast('ok', 'Done', `Sent ${sentNow} from ${mailPlatform()}.`);
      } else if (sentNow) {
        toast('ok', 'Stopped', `Sent ${sentNow}. The rest are still unsent.`);
      }
    } catch (err) {
      toast('err', 'Could not send', err.message);
    } finally {
      state.busy = false;
      state.busyMode = null;
      state.sendProgress = null;
      try {
        await loadState();
      } catch {
        /* keep the accounts already updated */
      }
      render();
    }
  }

  function paintTabs() {
    syncMailTab();
    root.querySelectorAll('.tab[data-page]').forEach((tab) => {
      if (tab.hidden) {
        tab.classList.remove('is-active');
        return;
      }
      tab.classList.toggle('is-active', tab.dataset.page === state.page);
    });
  }

  function render() {
    if (state.page === 'mail' && !supportsAliases()) state.page = 'main';
    paintTabs();
    if (state.page === 'templates') renderTemplates();
    else if (state.page === 'mail') renderMailPage();
    else {
      state.page = 'main';
      renderMain();
    }
  }

  async function loadState() {
    const data = await Api().getState();
    state.accounts = data.accounts || [];
    state.templates = data.templates || [];
    state.schedule = data.schedule || [];
    state.stats = data.stats || statsFrom(state.accounts);
    const ids = new Set(state.accounts.map((acc) => acc.id));
    for (const id of [...state.selected]) {
      if (!ids.has(id)) state.selected.delete(id);
    }
  }

  function statsFrom(accounts) {
    const list = accounts || [];
    return {
      total: list.length,
      sent: list.filter((a) => a.sent).length,
      verified: list.filter((a) => a.verifyStatus === 'valid').length
    };
  }

  function patchMailCards() {
    const pills = body.querySelectorAll('.stat-pill b');
    if (pills[0]) pills[0].textContent = String(state.stats.total ?? 0);
    if (pills[1]) pills[1].textContent = String(state.stats.sent ?? 0);
    if (pills[2]) pills[2].textContent = String(state.stats.verified ?? 0);
    syncSelectedStat();
    const byId = new Map((state.accounts || []).map((a) => [a.id, a]));
    body.querySelectorAll('.mail-row[data-id]').forEach((el) => {
      const acc = byId.get(el.dataset.id);
      if (!acc) return;
      const status = String(acc.verifyStatus || 'pending').toLowerCase();
      el.classList.toggle('is-sent', Boolean(acc.sent));
      const cell = el.querySelector('.col-status');
      if (cell) cell.innerHTML = statusCell(acc);
      const box = el.querySelector('.row-check');
      if (box) {
        const sendable = canSendAccount(acc);
        if (!sendable) state.selected.delete(acc.id);
        box.checked = sendable && state.selected.has(acc.id);
        box.disabled = state.busy || !sendable;
      }
      const dot = el.querySelector('.verify-dot');
      if (dot) {
        dot.className = `verify-dot ${status}`;
        dot.title = verifyLabel(status);
      }
    });
  }

  function applyStoreChange(changes) {
    if (changes['cvlist.accounts']) {
      state.accounts = changes['cvlist.accounts'].newValue || [];
      state.stats = statsFrom(state.accounts);
    }
    if (changes['cvlist.templates']) {
      state.templates = changes['cvlist.templates'].newValue || [];
    }
    if (changes['cvlist.schedule']) {
      state.schedule = changes['cvlist.schedule'].newValue || [];
    }
    if (state.busy) return;
    const accountChange = changes['cvlist.accounts'];
    if (state.page === 'main' && accountChange && body.querySelector('.mail-row')) {
      const oldLen = (accountChange.oldValue || []).length;
      const newLen = (accountChange.newValue || []).length;
      if (oldLen === newLen) {
        patchMailCards();
        return;
      }
    }
    if (changes['cvlist.accounts'] || changes['cvlist.templates'] || changes['cvlist.schedule']) {
      render();
    }
  }

  function startTimers() {
    stopTimers();
    identityTimer = setInterval(() => {
      const prev = state.gmailEmail;
      refreshGmailIdentity();
      if (prev !== state.gmailEmail) applyGmailChip();
    }, 2500);
    gmailReadyTimer = setInterval(() => {
      const prev = state.gmailReady;
      const next = Mail().isGmailPageReady();
      if (prev === next) return;
      state.gmailReady = next;
      if (!state.busy) {
        syncMailTab();
        syncSendButton();
      }
    }, 400);
  }

  function stopTimers() {
    if (identityTimer) clearInterval(identityTimer);
    if (gmailReadyTimer) clearInterval(gmailReadyTimer);
    identityTimer = null;
    gmailReadyTimer = null;
  }

  let keepAlivePort = null;
  function keepServiceWorkerAlive() {
    if (keepAlivePort) return;
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'cvlist-keepalive' });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
        setTimeout(keepServiceWorkerAlive, 1000);
      });
    } catch {
      keepAlivePort = null;
      setTimeout(keepServiceWorkerAlive, 2000);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    applyStoreChange(changes);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void loadState()
      .then(() => {
        if (state.page === 'main') patchMailCards();
      })
      .catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'CVLIST_TOGGLE_PANEL') {
      setCollapsed(!host.classList.contains('collapsed'));
    }
  });

  function mount() {
    ensureFonts();
    injectHostStyle();
    if (!document.getElementById(HOST_ID)) {
      (document.documentElement || document.body).appendChild(host);
    }
    setDocked(!host.classList.contains('collapsed'));
  }

  async function bootstrap() {
    ensureFonts();
    try {
      await loadState();
    } catch (err) {
      state.error = err.message;
    }
    const stored = await chrome.storage.local.get([
      COLLAPSED_KEY,
      PAGE_KEY,
      ALIAS_KEY,
      ALIASES_KEY,
      INTERVAL_KEY
    ]);
    const savedPage = stored[PAGE_KEY];
    if (savedPage === 'templates') state.page = 'templates';
    else if (savedPage === 'mail' && supportsAliases()) state.page = 'mail';
    else state.page = 'main';
    const savedAliases = Array.isArray(stored[ALIASES_KEY])
      ? stored[ALIASES_KEY]
      : stored[ALIAS_KEY]
        ? [stored[ALIAS_KEY]]
        : [];
    state.selectedAliases = new Set(
      savedAliases.map((email) => String(email || '').toLowerCase()).filter(Boolean)
    );
    state.sendIntervalMin = normalizeIntervalMin(stored[INTERVAL_KEY]);
    setCollapsed(Boolean(stored[COLLAPSED_KEY]));
    refreshGmailIdentity();
    startTimers();
    keepServiceWorkerAlive();
    render();
  }

  mount();
  new MutationObserver(() => mount()).observe(document.documentElement, { childList: true });
  void bootstrap();
})();
