/* Gmail DOM helpers + compose / Schedule send automation. */

(function (global) {
  const Human = () => global.CVListHuman;

  function sleep(ms) {
    return Human().delay(ms);
  }

  function randDelay(min, max) {
    return Human().randomDelay(min, max);
  }

  function visible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queryAllDeep(root, selector) {
    const results = [];
    const walk = (node) => {
      if (!node) return;
      if (node.querySelectorAll) {
        try {
          results.push(...node.querySelectorAll(selector));
        } catch {
          /* invalid selector */
        }
      }
      for (const child of node.children || []) walk(child);
      if (node.shadowRoot) walk(node.shadowRoot);
    };
    walk(root);
    return results;
  }

  function findByAria(labels, role) {
    const wanted = (Array.isArray(labels) ? labels : [labels]).map((s) => String(s).toLowerCase());
    const candidates = [
      ...document.querySelectorAll(role ? `[role="${role}"]` : 'button,div,span,a,[role="button"]'),
      ...document.querySelectorAll('[aria-label], [data-tooltip]')
    ];
    for (const el of candidates) {
      if (!visible(el)) continue;
      const aria = (el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || '').toLowerCase();
      const text = (el.textContent || '').trim().toLowerCase();
      if (wanted.some((w) => aria === w || aria.includes(w) || text === w)) {
        return el;
      }
    }
    return null;
  }

  function findComposeButton() {
    return (
      findByAria(['compose', 'compose new email'], 'button') ||
      document.querySelector('div[gh="cm"]') ||
      document.querySelector('.T-I.T-I-KE.L3') ||
      [...document.querySelectorAll('div[role="button"]')].find(
        (el) => visible(el) && /compose/i.test(el.getAttribute('aria-label') || el.textContent || '')
      ) ||
      null
    );
  }

  function loadingOverlayVisible() {
    const loading = document.getElementById('loading');
    if (visible(loading)) return true;
    const splash = [...document.querySelectorAll('#loading .msg, #loading, .msg')].find((el) =>
      visible(el) && /loading gmail/i.test(el.textContent || '')
    );
    if (splash) return true;
    return false;
  }

  /** Inbox chrome is up — not the Gmail splash / account-switch loader. */
  function isGmailPageReady() {
    if (document.readyState === 'loading') return false;
    if (loadingOverlayVisible()) return false;
    if (!findComposeButton()) return false;
    const shell =
      document.querySelector('[role="main"]') ||
      document.querySelector('div[gh="tl"]') ||
      document.querySelector('div[role="navigation"]');
    return !!shell;
  }

  async function waitUntilGmailReady(onProgress = () => {}, timeoutMs = 60000) {
    if (isGmailPageReady()) {
      await sleep(400);
      if (isGmailPageReady()) return true;
    }
    onProgress('Waiting for Gmail to finish loading…');
    const start = Date.now();
    let stableSince = 0;
    while (Date.now() - start < timeoutMs) {
      if (isGmailPageReady()) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 700) return true;
      } else {
        stableSince = 0;
      }
      await sleep(200);
    }
    throw new Error('Gmail is still loading. Wait until the inbox is fully shown, then try again.');
  }

  function composeFieldsReady(compose) {
    if (!compose || !document.contains(compose) || !visible(compose)) return false;
    return !!(findToField(compose) && findSubjectField(compose) && findSendButton(compose));
  }

  async function waitUntilComposeReady(compose, onProgress = () => {}) {
    onProgress('Waiting for compose to finish loading…');
    await waitFor(() => composeFieldsReady(compose), {
      label: 'compose fields (To / Subject / Send)',
      timeoutMs: 25000
    });
    // Mailtrack clones the Send caret after compose paints. Wait for that clone,
    // or for the native caret to stay full-size (Mailtrack hides it at 0×0).
    const start = Date.now();
    while (Date.now() - start < 4500) {
      if (findMailtrackSendOptions(compose)) break;
      const native = findNativeMoreSendOptions(compose);
      if (native) {
        const r = native.getBoundingClientRect();
        if (r.width >= 10 && r.height >= 14) {
          await sleep(450);
          if (findMailtrackSendOptions(compose)) break;
          break;
        }
      }
      await sleep(200);
    }
    await randDelay(250, 600);
    return compose;
  }

  function getOpenComposeDialogs() {
    const dialogs = [
      ...document.querySelectorAll('div[role="dialog"]'),
      ...document.querySelectorAll('.M9, .AD, .aSt')
    ].filter(visible);
    return dialogs.filter((d) =>
      d.querySelector(
        'input[name="subjectbox"], textarea[name="subjectbox"], [aria-label*="Subject" i], [aria-label*="Message Body" i], div[role="textbox"]'
      )
    );
  }

  function latestCompose() {
    const list = getOpenComposeDialogs();
    return list[list.length - 1] || null;
  }

  async function waitFor(fn, { timeoutMs = 15000, intervalMs = 250, label = 'element' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = fn();
      if (value) return value;
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}. Gmail UI may have changed.`);
  }

  function click(el) {
    if (!el) throw new Error('Nothing to click.');
    // Single activation — no el.click() after mouse events.
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function findToField(compose) {
    const root = compose || document;
    return (
      root.querySelector('textarea[name="to"]') ||
      root.querySelector('input[name="to"]') ||
      root.querySelector('textarea[aria-label="To recipients"]') ||
      root.querySelector('input[aria-label="To recipients"]') ||
      root.querySelector('[aria-label="To"]') ||
      root.querySelector('div[aria-label="To"] input') ||
      [...root.querySelectorAll('input[peoplekit-id], textarea.vO, input.agP')].find(visible) ||
      null
    );
  }

  function findSubjectField(compose) {
    const root = compose || document;
    return (
      root.querySelector('input[name="subjectbox"]') ||
      root.querySelector('input[aria-label="Subject"]') ||
      root.querySelector('input[aria-label*="Subject" i]') ||
      null
    );
  }

  function findBodyField(compose) {
    const root = compose || document;
    return (
      root.querySelector('div[aria-label="Message Body"]') ||
      root.querySelector('div[aria-label*="Message Body" i]') ||
      root.querySelector('div[role="textbox"][g_editable="true"]') ||
      root.querySelector('div[contenteditable="true"][role="textbox"]') ||
      [...root.querySelectorAll('div[contenteditable="true"]')].find(visible) ||
      null
    );
  }

  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

  function extractEmail(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const match = raw.match(EMAIL_RE);
    if (!match) return null;
    const email = match[0].toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg|ico)(?:\?|$)/i.test(email)) return null;
    return email;
  }

  function emailFromNode(el) {
    if (!el) return null;
    const attrs = [
      el.getAttribute?.('data-email'),
      el.getAttribute?.('data-identifier'),
      el.getAttribute?.('email'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('alt')
    ];
    for (const attr of attrs) {
      const email = extractEmail(attr);
      if (email) return email;
    }
    const img = el.querySelector?.('img');
    if (img) {
      const email = extractEmail(img.getAttribute('alt') || img.getAttribute('aria-label'));
      if (email) return email;
    }
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length && text.length <= 120) return extractEmail(text);
    return null;
  }

  function inTopBar(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return visible(el);
    return rect.top < 120 && rect.bottom > 0;
  }

  function headerRoots() {
    return [
      document.querySelector('#gb'),
      document.querySelector('header'),
      document.querySelector('[role="banner"]')
    ].filter(Boolean);
  }

  function emailFromGoogleAccountButton() {
    const seen = new Set();
    const push = (el) => {
      if (el && !seen.has(el)) seen.add(el);
    };

    for (const root of headerRoots()) {
      root.querySelectorAll('a[href*="SignOutOptions"]').forEach(push);
      root.querySelectorAll('[aria-label*="Google Account" i]').forEach(push);
      root.querySelectorAll('[aria-label*="Google-Konto" i]').forEach(push);
      root.querySelectorAll('[aria-label*="Compte Google" i]').forEach(push);
    }

    document.querySelectorAll('a[href*="SignOutOptions"]').forEach((el) => {
      if (inTopBar(el)) push(el);
    });

    const ordered = [...seen].sort((a, b) => {
      const vis = Number(visible(b)) - Number(visible(a));
      if (vis) return vis;
      const sign = (el) => (/SignOutOptions/i.test(el.getAttribute('href') || '') ? 1 : 0);
      return sign(b) - sign(a);
    });
    for (const el of ordered) {
      const email = emailFromNode(el);
      if (email) return email;
    }
    return null;
  }

  function emailFromBootBridge() {
    const bridged = document.documentElement.getAttribute('data-cv-list-gmail-email');
    return extractEmail(bridged);
  }

  function emailFromAuthuser() {
    try {
      const authuser = new URL(location.href).searchParams.get('authuser');
      return authuser && authuser.includes('@') ? extractEmail(authuser) : null;
    } catch {
      return null;
    }
  }

  function emailFromTitle() {
    const title = document.title || '';
    if (!/gmail/i.test(title)) return null;
    return extractEmail(title);
  }

  function emailFromComposeFrom() {
    const compose = latestCompose();
    if (!compose) return null;
    const fromInput = compose.querySelector('input[name="from"]');
    return extractEmail(fromInput && fromInput.value);
  }

  /**
   * Email for THIS Gmail tab (/mail/u/N), not the first address found in the inbox DOM.
   * Multi-account Gmail leaves other accounts in AccountChooser / message rows.
   */
  function detectLoggedInEmail() {
    return (
      emailFromGoogleAccountButton() ||
      emailFromBootBridge() ||
      emailFromAuthuser() ||
      emailFromTitle() ||
      emailFromComposeFrom() ||
      null
    );
  }

  function normalizeEmail(value) {
    const raw = String(value || '').trim().toLowerCase();
    const at = raw.lastIndexOf('@');
    if (at < 1) return raw;
    let local = raw.slice(0, at);
    let domain = raw.slice(at + 1).replace(/^googlemail\.com$/, 'gmail.com');
    if (domain === 'gmail.com') {
      local = local.split('+')[0].replace(/\./g, '');
    }
    return `${local}@${domain}`;
  }

  function emailsMatch(a, b) {
    const left = String(a || '').trim().toLowerCase();
    const right = String(b || '').trim().toLowerCase();
    if (!left || !right) return false;
    if (left === right) return true;
    return normalizeEmail(left) === normalizeEmail(right);
  }

  async function openCompose(onProgress = () => {}) {
    let compose = latestCompose();
    if (compose) {
      await waitUntilComposeReady(compose, onProgress);
      return compose;
    }

    const btn = await waitFor(() => findComposeButton(), {
      label: 'Compose button',
      timeoutMs: 20000
    });
    click(btn);
    await randDelay(800, 2200);
    compose = await waitFor(() => latestCompose(), { label: 'compose window', timeoutMs: 20000 });
    await waitUntilComposeReady(compose, onProgress);
    return compose;
  }

  async function fillRecipient(compose, email) {
    const to = await waitFor(() => findToField(compose), { label: 'To field' });
    click(to);
    await randDelay(400, 1100);
    await Human().setFieldValue(to, email, { preferType: true, minKeyMs: 40, maxKeyMs: 140 });
    await randDelay(300, 800);
    to.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true })
    );
    to.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true })
    );
    await randDelay(400, 900);
  }

  async function fillSubject(compose, subject) {
    const field = await waitFor(() => findSubjectField(compose), { label: 'Subject field' });
    click(field);
    await randDelay(300, 900);
    await Human().setFieldValue(field, subject, {
      preferType: String(subject || '').length <= 60 && !String(subject || '').includes('\n')
    });
    await randDelay(400, 1000);
  }

  async function fillBody(compose, body) {
    const field = await waitFor(() => findBodyField(compose), { label: 'Message body' });
    click(field);
    await randDelay(400, 1200);
    // Always use HTML path so \n become <br> in Gmail.
    await Human().setFieldValue(field, body, { preferType: false });
    await randDelay(600, 1600);
  }

  function isSendButton(el) {
    if (!el || !visible(el)) return false;
    // Split Send+caret wrappers contain a nested button — those are not the Send control.
    const nested = el.querySelector?.('[role="button"], button, div.T-I');
    if (nested && nested !== el) return false;
    const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
    const text = (el.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (text === 'send' || text === 'send tracked' || text === 'send untracked') return true;
    if (/^send\b/.test(aria) && !/schedule|more|options/.test(aria) && text.length <= 20) {
      return true;
    }
    return false;
  }

  function findSendButton(compose) {
    const root = compose || document;
    const buttons = queryAllDeep(root, '[role="button"], div.T-I, button').filter(isSendButton);
    if (!buttons.length) return null;
    buttons.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const area = (r) => r.width * r.height;
      return br.bottom - ar.bottom || area(ar) - area(br);
    });
    return buttons[0];
  }

  function caretLooksAdjacent(el, sendRect) {
    if (!el || !visible(el) || isSendButton(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 14) return false;
    if (r.width > 72 || r.height > 56) return false;
    const sendCy = (sendRect.top + sendRect.bottom) / 2;
    const cy = (r.top + r.bottom) / 2;
    if (Math.abs(cy - sendCy) > 16) return false;
    if (r.left < sendRect.right - 10) return false;
    if (r.left > sendRect.right + 36) return false;
    return true;
  }

  function clickableAncestor(el) {
    if (!el || el === document.body || el === document.documentElement) return el;
    return (
      el.closest?.('[role="button"], button, div.T-I, [aria-haspopup], [aria-expanded]') || el
    );
  }

  function elementFromPointDeep(x, y) {
    let el = document.elementFromPoint(x, y);
    for (let i = 0; i < 6; i += 1) {
      const root = el?.shadowRoot;
      if (!root) break;
      const inner = root.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  /** Arrow / caret immediately to the right of the Send button (Gmail or Mailtrack). */
  function findScheduleCaret(compose) {
    const root = compose || document;
    const sendBtn = findSendButton(root);
    if (!sendBtn) return null;
    const sendRect = sendBtn.getBoundingClientRect();
    const probeX = sendRect.right + 12;
    const probeY = sendRect.top + sendRect.height / 2;

    const scored = [];
    const consider = (el, bonus = 0) => {
      if (!el || el === sendBtn || sendBtn.contains(el)) return;
      const clickable = clickableAncestor(el);
      if (!caretLooksAdjacent(clickable, sendRect) && !caretLooksAdjacent(el, sendRect)) return;
      const target = caretLooksAdjacent(clickable, sendRect) ? clickable : el;
      const r = target.getBoundingClientRect();
      const label = `${target.getAttribute('aria-label') || ''} ${
        target.getAttribute('data-tooltip') || ''
      }`.toLowerCase();
      let score = bonus + 120 - Math.max(0, r.left - sendRect.right);
      if (label.includes('more send options')) score += 90;
      if (label.includes('schedule') && label.includes('option')) score += 40;
      if (target.getAttribute('aria-haspopup')) score += 50;
      if (/[▾▼▲△]/.test(target.textContent || '')) score += 40;
      if (target.querySelector?.('.G-asx, .T-I-J3, .J-J5-Ji')) score += 40;
      scored.push({ el: target, score });
    };

    const topEl = withPanelPassThrough(() => elementFromPointDeep(probeX, probeY));
    if (topEl && topEl !== sendBtn && !sendBtn.contains(topEl)) consider(topEl, 180);

    const searchRoot = sendBtn.closest('.btC, .gU, .dC')?.parentElement || sendBtn.parentElement || root;
    for (const el of queryAllDeep(
      searchRoot,
      '[role="button"], button, div.T-I, [aria-haspopup], [aria-expanded], [data-tooltip]'
    )) {
      consider(el, 40);
    }

    let sib = sendBtn.nextElementSibling;
    while (sib) {
      consider(sib, 70);
      sib = sib.nextElementSibling;
    }

    scored.sort((a, b) => b.score - a.score);
    if (scored[0]) return scored[0].el;

    const parent = sendBtn.parentElement;
    if (parent) {
      const kids = [...parent.children].filter(visible);
      const idx = kids.indexOf(sendBtn);
      const next = idx >= 0 ? kids[idx + 1] : null;
      if (next && caretLooksAdjacent(next, sendRect)) return next;
    }
    return null;
  }

  /**
   * Visible Mailtrack/Gmail caret from inspect:
   * div.T-I.hG.mt-send-options[aria-label="More send options"] > div.G-asx
   */
  function findMailtrackSendOptions(compose) {
    const roots = [compose, document].filter(Boolean);
    for (const root of roots) {
      const labeled = queryAllDeep(root, '.mt-send-options, .hG, [aria-label="More send options"]');
      const visibleMt = labeled.find((el) => el.classList?.contains('mt-send-options') && visible(el));
      if (visibleMt) return visibleMt;
    }
    for (const root of roots) {
      const labeled = queryAllDeep(root, '.mt-send-options, .hG, [aria-label="More send options"]');
      const anyMt = labeled.find((el) => el.classList?.contains('mt-send-options'));
      if (anyMt) return anyMt;
      const labeledVisible = labeled.find(
        (el) => visible(el) && /more send options/i.test(el.getAttribute('aria-label') || '')
      );
      if (labeledVisible) return labeledVisible;
    }
    return null;
  }

  function findNativeMoreSendOptions(compose) {
    const root = compose || document;
    const nodes = queryAllDeep(root, '.hG');
    const original = nodes.find((el) => el.isConnected && !el.classList.contains('mt-send-options'));
    if (original) return original;
    const mt = findMailtrackSendOptions(root);
    if (mt?.nextElementSibling?.classList?.contains('hG')) return mt.nextElementSibling;
    return null;
  }

  /** Mailtrack opens Gmail's menu with mousedown+mouseup (not click). Include coords + .G-asx. */
  function gmailCaretActivate(el, rectEl = el) {
    if (!el) return;
    const box = rectEl && rectEl.getBoundingClientRect ? rectEl.getBoundingClientRect() : el.getBoundingClientRect();
    const x = box.width > 1 ? box.left + box.width / 2 : 0;
    const y = box.height > 1 ? box.top + box.height / 2 : 0;
    const down = {
      bubbles: true,
      cancelable: false,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons: 1
    };
    const up = { ...down, buttons: 0, cancelable: false };
    withPanelPassThrough(() => {
      const inner = el.querySelector?.('.G-asx') || el;
      for (const node of inner === el ? [el] : [inner, el]) {
        node.dispatchEvent(new MouseEvent('mousedown', down));
        node.dispatchEvent(new MouseEvent('mouseup', up));
      }
    });
  }

  function menuItemText(el) {
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /**
   * Native Gmail: "Schedule send".
   * Mailtrack / Mailsuite: "Schedule untracked send" / "Schedule tracked send".
   * Never choose tracked.
   */
  function scheduleSendLabelKind(text, aria = '') {
    const line = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const extra = String(aria || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const blob = `${line} ${extra}`.trim();
    if (!/schedule/.test(blob) || !/send/.test(blob)) return null;
    if (/\bschedule tracked send\b/.test(blob) && /\buntracked\b/.test(blob)) return null;
    if (/\buntracked\b/.test(blob)) return 'untracked';
    if (/\btracked\b/.test(blob)) return 'tracked';
    if (line === 'schedule send' || extra === 'schedule send') return 'native';
    return null;
  }

  function findMenuItem(textMatchers, root = document, { exact = false } = {}) {
    const matchers = textMatchers.map((t) => String(t).toLowerCase());
    const items = [
      ...root.querySelectorAll(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="option"], div.J-N, span.J-N-Jz, div[role="button"], button, li'
      )
    ];
    if (exact || matchers.some((m) => m === 'schedule send')) {
      for (const el of items) {
        if (!visible(el)) continue;
        const text = menuItemText(el);
        if (matchers.some((m) => text === m)) {
          return el.closest('[role="menuitem"], div.J-N, [act]') || el;
        }
      }
    }
    for (const el of items) {
      if (!visible(el)) continue;
      const text = menuItemText(el);
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (matchers.some((m) => text === m || text.includes(m) || aria.includes(m))) {
        return el.closest('[role="menuitem"], div.J-N, [act]') || el;
      }
    }
    return null;
  }

  /**
   * Mailtrack dropup: native row rewritten to "Schedule untracked send",
   * plus `.mt-send-option-btn` = "Schedule tracked send" (never click that).
   */
  function findScheduleSendMenuItem() {
    const nodes = queryAllDeep(
      document,
      '[role="menuitem"], div.J-N, .J-N-Jz, .mt-send-option-btn'
    );
    const rows = [];
    const seen = new Set();
    for (const el of nodes) {
      if (!visible(el)) continue;
      if (el.classList?.contains('mt-send-option-btn') || el.closest?.('.mt-send-option-btn')) continue;
      const text = menuItemText(el);
      if (text.length > 36) continue;
      const kind = scheduleSendLabelKind(text, el.getAttribute('aria-label') || '');
      if (!kind || kind === 'tracked') continue;
      const row = el.closest('[role="menuitem"], div.J-N') || el;
      if (seen.has(row) || row.classList?.contains('mt-send-option-btn')) continue;
      const rect = row.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 14 || rect.height > 72) continue;
      seen.add(row);
      rows.push({ el: row, kind, area: rect.width * rect.height });
    }
    rows.sort((a, b) => {
      if (a.kind === 'untracked' && b.kind !== 'untracked') return -1;
      if (b.kind === 'untracked' && a.kind !== 'untracked') return 1;
      return a.area - b.area;
    });
    return rows[0]?.el || null;
  }

  function isExtensionHost(node) {
    if (!node) return false;
    const host = document.getElementById('cvlist-host');
    if (!host) return false;
    return node === host || host.contains(node);
  }

  function isGmailChrome(node) {
    if (!node || !node.closest) return false;
    return Boolean(
      node.closest(
        'form[role="search"], header, [role="search"], input[aria-label*="Search" i], [name="q"]'
      )
    );
  }

  function withPanelPassThrough(fn) {
    const host = document.getElementById('cvlist-host');
    const prev = host ? host.style.pointerEvents : '';
    if (host) host.style.pointerEvents = 'none';
    try {
      return fn();
    } finally {
      if (host) host.style.pointerEvents = prev || '';
    }
  }

  /**
   * Human-like click: ONE activation only.
   * (dispatchEvent('click') + el.click() opened two Pick date & time dialogs.)
   */
  function humanClick(el, { allowFocus = false } = {}) {
    if (!el) throw new Error('Nothing to click.');
    if (isGmailChrome(el)) throw new Error('Refusing to click Gmail search/chrome.');

    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.min(Math.max(rect.width / 2, 4), Math.max(rect.width - 4, 4));
    const y = rect.top + Math.min(Math.max(rect.height / 2, 4), Math.max(rect.height - 4, 4));
    const down = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    };
    const up = { ...down, buttons: 0 };

    withPanelPassThrough(() => {
      if (allowFocus) el.focus?.();
      try {
        el.dispatchEvent(new PointerEvent('pointerdown', down));
      } catch {
        /* older engines */
      }
      el.dispatchEvent(new MouseEvent('mousedown', down));
      try {
        el.dispatchEvent(new PointerEvent('pointerup', up));
      } catch {
        /* older engines */
      }
      el.dispatchEvent(new MouseEvent('mouseup', up));
      // Single click only — do NOT also call el.click().
      el.dispatchEvent(new MouseEvent('click', up));
    });
  }

  function directClick(el) {
    humanClick(el, { allowFocus: false });
  }

  function forceClick(el) {
    humanClick(el, { allowFocus: false });
  }

  function scheduleChooserVisible() {
    if (findScheduleChooserDialog()) return true;
    if (findPickDateTimeDialog()) return true;
    if (findPickDateTimeOption()) return true;
    for (const el of document.querySelectorAll('[role="menuitem"], div.J-N, [role="option"]')) {
      if (!visible(el)) continue;
      const t = menuItemText(el);
      if (
        t.includes('pick date') ||
        t.includes('tomorrow morning') ||
        t.includes('this morning') ||
        t.includes('this afternoon')
      ) {
        return true;
      }
    }
    return false;
  }

  async function trustedClickElement(el) {
    if (!el || !chrome.runtime?.sendMessage) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CVLIST_API', action: 'trustedClick', payload: { x, y } }, (response) => {
        if (chrome.runtime.lastError || !response || response.ok === false) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }

  async function clickSendArrow(compose, onProgress = () => {}) {
    const mtCaret = findMailtrackSendOptions(compose);
    const nativeCaret = findNativeMoreSendOptions(compose);

    if (mtCaret) {
      onProgress('Clicking More send options…');
      const host = document.getElementById('cvlist-host');
      const prev = host ? host.style.pointerEvents : '';
      if (host) host.style.pointerEvents = 'none';
      try {
        const ok = await trustedClickElement(mtCaret);
        await sleep(700);
        if (findScheduleSendMenuItem(compose) || scheduleChooserVisible()) return mtCaret;
        if (!ok) {
          gmailCaretActivate(mtCaret, mtCaret);
          if (nativeCaret && nativeCaret !== mtCaret) gmailCaretActivate(nativeCaret, mtCaret);
          await sleep(500);
        } else if (nativeCaret && nativeCaret !== mtCaret) {
          gmailCaretActivate(nativeCaret, mtCaret);
          await sleep(400);
        }
      } finally {
        if (host) host.style.pointerEvents = prev || '';
      }
      return mtCaret;
    }

    const caret = findScheduleCaret(compose) || nativeCaret;
    if (!caret) throw new Error('Could not find More send options arrow next to Send.');

    onProgress('Clicking Send arrow…');
    humanClick(caret);
    await sleep(700);
    if (findScheduleSendMenuItem(compose) || scheduleChooserVisible()) return caret;

    onProgress('Send arrow — Gmail mousedown…');
    gmailCaretActivate(caret);
    await sleep(500);
    return caret;
  }

  async function clickScheduleMenuItem(item, onProgress = () => {}) {
    const kind = scheduleSendLabelKind(menuItemText(item), item.getAttribute('aria-label') || '');
    onProgress(
      kind === 'untracked' ? 'Clicking Schedule untracked send…' : 'Clicking Schedule send…'
    );
    const host = document.getElementById('cvlist-host');
    const prev = host ? host.style.pointerEvents : '';
    if (host) host.style.pointerEvents = 'none';
    try {
      humanClick(item);
      await sleep(450);
      if (scheduleChooserVisible()) return;
      await trustedClickElement(item);
      await sleep(500);
    } finally {
      if (host) host.style.pointerEvents = prev || '';
    }
  }

  async function openScheduleSend(compose, onProgress = () => {}) {
    await clickSendArrow(compose, onProgress);

    let item = findScheduleSendMenuItem();
    if (!item) {
      item = await waitFor(() => findScheduleSendMenuItem(), {
        label: 'Schedule untracked send',
        timeoutMs: 7000,
        intervalMs: 120
      }).catch(() => null);
    }

    if (!item) {
      onProgress('Dropup missing — clicking Send arrow again…');
      await clickSendArrow(compose, onProgress);
      item = await waitFor(() => findScheduleSendMenuItem(), {
        label: 'Schedule untracked send',
        timeoutMs: 5000,
        intervalMs: 120
      });
    }

    await clickScheduleMenuItem(item, onProgress);

    await waitFor(() => scheduleChooserVisible(), {
      label: 'schedule send chooser (This morning / Pick date & time)',
      timeoutMs: 13000,
      intervalMs: 200
    });

    onProgress('Waiting 6.5s after Schedule send…');
    await sleep(6500);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function normalizeTimeText(value) {
    return String(value || '')
      .replace(/\u202f/g, ' ')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  /**
   * Match Gmail picker samples: "11:31 PM", "6:52 AM" (often U+202F), "08:45AM".
   */
  function formatTimeLikeSample(date, sample) {
    const raw = String(sample || '').trim();
    const sampleStr = raw.replace(/\u202f/g, ' ');
    const hours24 = date.getHours();
    const minutes = date.getMinutes();
    const isPM = hours24 >= 12;
    const h12 = hours24 % 12 || 12;
    const mm = pad2(minutes);
    const upper = !/[ap]m/i.test(sampleStr) || /[AP]M/.test(raw.replace(/\u202f/g, ' '));
    const ap = upper ? (isPM ? 'PM' : 'AM') : isPM ? 'pm' : 'am';
    const spaceMatch = raw.match(/(\s|\u202f)+(?=[AaPp][Mm]\s*$)/);
    const sep = spaceMatch
      ? spaceMatch[0].replace(/[\s\u202f]+/, raw.includes('\u202f') ? '\u202f' : ' ')
      : ' ';
    const hasSpace =
      sampleStr.length ? /\s+[AaPp][Mm]\s*$/.test(sampleStr) || raw.includes('\u202f') : true;
    const hourToken = (sampleStr.match(/^(\d{1,2})\s*:/) || [])[1] || '';
    const padded = hourToken.length === 2 && hourToken.startsWith('0');
    const h = padded ? pad2(h12) : String(h12);
    const gap = hasSpace ? (spaceMatch ? sep : '\u202f') : '';
    return `${h}:${mm}${gap}${ap}`;
  }

  function formatDateLikeSample(date, sample) {
    const sampleStr = String(sample || '')
      .trim()
      .replace(/\u202f/g, ' ');
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    if (/^[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}$/.test(sampleStr) || !sampleStr) {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(sampleStr)) return `${yyyy}-${mm}-${dd}`;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(sampleStr)) {
      const parts = sampleStr.split('/');
      const padded = parts[0].length === 2;
      return padded
        ? `${mm}/${dd}/${yyyy}`
        : `${date.getMonth() + 1}/${date.getDate()}/${yyyy}`;
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function isTimeValue(val) {
    return /^\d{1,2}:\d{2}\s*[AaPp][Mm]$/.test(
      String(val || '')
        .replace(/\u202f/g, ' ')
        .trim()
    );
  }

  function isDateValue(val) {
    const s = String(val || '').trim();
    return (
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s) ||
      /^\d{4}-\d{2}-\d{2}$/.test(s) ||
      /^[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}$/.test(s)
    );
  }

  function dialogZRank(el) {
    let rank = 0;
    let node = el;
    while (node && node.nodeType === 1) {
      const z = parseInt(window.getComputedStyle(node).zIndex, 10);
      if (!Number.isNaN(z)) rank = Math.max(rank, z);
      node = node.parentElement;
    }
    return rank;
  }

  /** True if this element is actually on top (not covered by another dialog/layer). */
  function isUncoveredInDialog(el, dialog) {
    if (!el || !dialog) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + Math.min(12, rect.width / 3), rect.top + rect.height / 2],
      [rect.right - Math.min(12, rect.width / 3), rect.top + rect.height / 2]
    ];
    return withPanelPassThrough(() =>
      points.some(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        return Boolean(top && dialog.contains(top));
      })
    );
  }

  /**
   * All visible Pick date & time modals (may be >1 if a double-click opened extras).
   */
  function listPickDateTimeDialogs() {
    const dialogs = [
      ...document.querySelectorAll('div[role="dialog"], div[role="alertdialog"]')
    ].filter(visible);

    const found = [];
    for (const d of dialogs) {
      const rect = d.getBoundingClientRect();
      if (rect.width > 640 || rect.height > 760) continue;

      const heading = (
        d.querySelector('h1, h2, h3, [role="heading"], .aRv, span')?.textContent || ''
      )
        .trim()
        .toLowerCase();
      const textHead = (d.innerText || '').slice(0, 280).toLowerCase();
      const looksLikePicker =
        /pick date/.test(heading) ||
        /pick date\s*&?\s*time/.test(textHead.split('\n').slice(0, 4).join(' '));

      const timeInput = findTimeInputStrict(d);
      if (!timeInput) continue;
      if (!looksLikePicker && !(findDateInputStrict(d) && /schedule send/i.test(textHead))) {
        continue;
      }

      let score = dialogZRank(d) * 10;
      if (looksLikePicker) score += 20000;
      if (findDateInputStrict(d)) score += 800;
      if (/cancel/i.test(textHead) && /schedule send/i.test(textHead)) score += 600;
      score += Math.max(0, 400 - Math.floor(rect.width / 2));
      if (isUncoveredInDialog(timeInput, d)) score += 5000;
      else score -= 2000;

      found.push({ d, score });
    }
    found.sort((a, b) => b.score - a.score);
    return found;
  }

  /**
   * Topmost "Pick date & time" modal only (calendar + date/time fields + Schedule send).
   * Never returns the compose window or a covered background dialog.
   */
  function findPickDateTimeDialog() {
    const best = listPickDateTimeDialogs()[0];
    if (!best || best.score < 0) return null;
    return best.d;
  }

  function findCancelButton(dialog) {
    if (!dialog) return null;
    for (const el of dialog.querySelectorAll('button, [role="button"], div[role="button"]')) {
      if (!visible(el) || !dialog.contains(el)) continue;
      const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      if (t === 'cancel') return el;
    }
    return null;
  }

  /** Close every Pick date & time dialog except the one we keep (top). */
  async function dismissExtraPickDialogs(keepDialog, onProgress = () => {}) {
    const extras = listPickDateTimeDialogs()
      .map((x) => x.d)
      .filter((d) => d !== keepDialog);
    if (!extras.length) return 0;

    onProgress(`Closing ${extras.length} extra Pick date & time dialog(s)…`);
    for (const d of extras) {
      const cancel = findCancelButton(d);
      if (cancel) humanClick(cancel);
      else {
        // Escape as last resort on that layer.
        d.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
        );
      }
      await sleep(400);
    }
    return extras.length;
  }

  async function dismissAllPickDialogs(onProgress = () => {}) {
    const all = listPickDateTimeDialogs().map((x) => x.d);
    if (!all.length) return;
    onProgress(`Dismissing ${all.length} leftover Pick date & time dialog(s)…`);
    for (const d of all) {
      const cancel = findCancelButton(d);
      if (cancel) humanClick(cancel);
      await sleep(350);
    }
  }

  /** Preset Schedule send chooser (This morning / Pick date & time link) — not the custom picker. */
  function findScheduleChooserDialog() {
    const dialogs = [
      ...document.querySelectorAll('div[role="dialog"], div[role="alertdialog"]')
    ].filter(visible);
    for (const d of dialogs) {
      if (findTimeInputStrict(d)) continue; // that's the custom picker
      const text = (d.innerText || d.textContent || '').toLowerCase();
      if (
        text.includes('pick date') ||
        (text.includes('schedule send') && (text.includes('morning') || text.includes('afternoon')))
      ) {
        return d;
      }
    }
    return null;
  }

  function findScheduleDialog() {
    // Prefer the top custom picker; fall back to preset chooser.
    return findPickDateTimeDialog() || findScheduleChooserDialog();
  }

  function findTimeInputStrict(dialog) {
    if (!dialog) return null;
    const inputs = [
      ...dialog.querySelectorAll('input'),
      ...queryAllDeep(dialog, 'input')
    ].filter((el, i, arr) => arr.indexOf(el) === i && visible(el));
    for (const el of inputs) {
      if (!dialog.contains(el)) continue;
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const name = (el.getAttribute('name') || '').toLowerCase();
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const val = String(el.value || '');
      if (type === 'time' || aria === 'time' || name === 'time' || ph === 'time') return el;
      if (/^time$/i.test(aria) || /(^|\s)time$/i.test(aria)) return el;
      if (isTimeValue(val)) return el;
    }
    return null;
  }

  function findDateInputStrict(dialog) {
    if (!dialog) return null;
    const inputs = [...dialog.querySelectorAll('input')].filter(visible);
    for (const el of inputs) {
      if (!dialog.contains(el)) continue;
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const name = (el.getAttribute('name') || '').toLowerCase();
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const val = String(el.value || '');
      if (type === 'date' || /date/.test(aria) || /date/.test(name) || /date/.test(ph)) return el;
      if (isDateValue(val) && !isTimeValue(val)) return el;
    }
    return null;
  }

  function findTimeInput(dialog) {
    // Never scan the whole document — background compose can steal matches.
    const root = dialog || findPickDateTimeDialog();
    return findTimeInputStrict(root);
  }

  function findDateInput(dialog) {
    const root = dialog || findPickDateTimeDialog();
    return findDateInputStrict(root);
  }

  function findConfirmScheduleButton(dialog) {
    const root = dialog || findPickDateTimeDialog();
    if (!root) return null;

    const matches = [];
    for (const el of root.querySelectorAll('button, [role="button"], div[role="button"]')) {
      if (!visible(el) || !root.contains(el)) continue;
      if (el.getAttribute('aria-disabled') === 'true' || el.disabled) continue;
      const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      if (t !== 'schedule send') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 48 || rect.height < 24) continue;
      // Must be the uncovered top-dialog button, not anything behind.
      if (!isUncoveredInDialog(el, root)) continue;
      matches.push(el);
    }
    if (!matches.length) {
      // Fallback: still inside this dialog even if hit-test is flaky.
      for (const el of root.querySelectorAll('button, [role="button"], div[role="button"]')) {
        if (!visible(el) || !root.contains(el)) continue;
        if (el.getAttribute('aria-disabled') === 'true' || el.disabled) continue;
        const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');
        if (t !== 'schedule send') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 48 || rect.height < 24) continue;
        matches.push(el);
      }
    }
    if (!matches.length) return null;
    matches.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.top - ar.top || br.left - ar.left || br.width - ar.width;
    });
    return matches[0];
  }

  function gmailScheduledToastVisible() {
    const nodes = document.querySelectorAll('div, span');
    for (const el of nodes) {
      if (!visible(el)) continue;
      const t = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (!t || t.length > 80) continue;
      if (t.includes('message scheduled') || t.includes('scheduled send')) return true;
    }
    return false;
  }

  /** True while the top Pick date & time modal is still open. */
  function pickerStillOpen() {
    const dialog = findPickDateTimeDialog();
    return Boolean(dialog && visible(dialog) && findTimeInputStrict(dialog));
  }

  function pickerValidationError() {
    const dialog = findPickDateTimeDialog();
    if (!dialog) return '';
    const text = (dialog.innerText || dialog.textContent || '').replace(/\s+/g, ' ').trim();
    const patterns = [
      /enter a valid (date|time)/i,
      /invalid (date|time)/i,
      /choose a (date|time) in the future/i,
      /must be in the future/i,
      /time must be/i,
      /date must be/i
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return m[0];
    }
    for (const el of dialog.querySelectorAll('[aria-invalid="true"], .error, [role="alert"]')) {
      if (!visible(el)) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (t) return t.slice(0, 120);
    }
    return '';
  }

  /**
   * After clicking confirm, success = popup closed.
   * Invalid date/time keeps the dialog open → failure.
   */
  async function waitForPickerClosed(onProgress = () => {}) {
    onProgress('Waiting for schedule popup to close…');
    const closed = await waitFor(() => !pickerStillOpen(), {
      label: 'schedule popup closed',
      timeoutMs: 10000,
      intervalMs: 200
    }).catch(() => null);

    if (closed !== null || !pickerStillOpen()) {
      // Brief settle; toast is optional confirmation.
      await sleep(400);
      return { ok: true };
    }

    const err = pickerValidationError();
    if (err) {
      throw new Error(`Schedule send rejected — ${err}`);
    }
    throw new Error(
      'Schedule send failed — popup still open (date/time may be invalid). Not marked as sent.'
    );
  }

  function keyCodeForChar(ch) {
    if (ch >= '0' && ch <= '9') return 48 + (ch.charCodeAt(0) - 48);
    if (ch === ':') return 186;
    if (ch === ' ') return 32;
    if (ch === '\u202f') return 32;
    const upper = ch.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return upper.charCodeAt(0);
    return ch.charCodeAt(0);
  }

  function codeForChar(ch) {
    if (ch >= '0' && ch <= '9') return `Digit${ch}`;
    if (ch === ':') return 'Semicolon';
    if (ch === ' ' || ch === '\u202f') return 'Space';
    if (/[a-zA-Z]/.test(ch)) return `Key${ch.toUpperCase()}`;
    return 'Unidentified';
  }

  async function fireKey(el, key, type = 'keydown') {
    const keyCode = key === 'Backspace' ? 8 : key === 'Delete' ? 46 : keyCodeForChar(key);
    const code =
      key === 'Backspace' ? 'Backspace' : key === 'Delete' ? 'Delete' : codeForChar(key);
    el.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        code,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true
      })
    );
  }

  async function clearInput(el) {
    humanClick(el, { allowFocus: true });
    await sleep(150);
    el.focus();
    try {
      el.select?.();
    } catch {
      /* ignore */
    }
    // Ctrl+A then Backspace — frameworks treat this as a real edit.
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        keyCode: 65,
        which: 65,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    document.execCommand('selectAll', false, null);
    await fireKey(el, 'Backspace', 'keydown');
    if (!document.execCommand('delete', false, null)) {
      const proto =
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (proto && proto.set) proto.set.call(el, '');
      else el.value = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    await fireKey(el, 'Backspace', 'keyup');
    await sleep(100);
  }

  async function typeIntoInput(el, value) {
    // Real keydown/insertText/keyup per character so Gmail's model updates (not just the DOM).
    // Never press Enter — that confirms Schedule send with the old time.
    el.focus();
    for (const ch of String(value)) {
      const insertCh = ch === '\u202f' ? ' ' : ch;
      await fireKey(el, insertCh, 'keydown');
      await fireKey(el, insertCh, 'keypress');
      const ok = document.execCommand('insertText', false, insertCh);
      if (!ok) {
        const proto =
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (proto && proto.set) proto.set.call(el, String(el.value || '') + insertCh);
        else el.value = String(el.value || '') + insertCh;
      }
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: insertCh, inputType: 'insertText' })
      );
      await fireKey(el, insertCh, 'keyup');
      await sleep(40 + Math.floor(Math.random() * 40));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Commit by clicking the date field inside the SAME top dialog — never background layers. */
  async function commitPickerField(el) {
    const dialog = findPickDateTimeDialog();
    if (!dialog) {
      el?.blur?.();
      await sleep(250);
      return;
    }
    const dateInput = findDateInputStrict(dialog);
    const timeInput = findTimeInputStrict(dialog);
    let other = null;
    if (el && dateInput && el !== dateInput) other = dateInput;
    else if (el && timeInput && el !== timeInput) other = timeInput;
    if (other && dialog.contains(other)) {
      directClick(other);
      await sleep(350);
      return;
    }
    const rect = dialog.getBoundingClientRect();
    const probe = withPanelPassThrough(() =>
      document.elementFromPoint(rect.left + 24, rect.top + 18)
    );
    if (probe && dialog.contains(probe) && !probe.closest('button, [role="button"], input')) {
      directClick(probe);
    } else {
      el?.blur?.();
    }
    await sleep(350);
  }

  async function setNativeInput(el, value) {
    const dialog = findPickDateTimeDialog();
    if (!dialog || !dialog.contains(el)) {
      throw new Error('Refusing to type outside the top Pick date & time dialog.');
    }
    if (!isUncoveredInDialog(el, dialog)) {
      throw new Error('Target input is covered — only the top dialog may be edited.');
    }
    await clearInput(el);
    await typeIntoInput(el, value);
    await sleep(200);
    if (normalizeTimeText(el.value) !== normalizeTimeText(value) && !isDateValue(value)) {
      await clearInput(el);
      const proto =
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (proto && proto.set) proto.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: value, inputType: 'insertFromPaste' })
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await commitPickerField(el);
    await sleep(300);
  }

  function readPickerTime() {
    const dialog = findPickDateTimeDialog();
    const input = findTimeInputStrict(dialog);
    return input ? String(input.value || '') : '';
  }

  function timeMatches(actual, wanted) {
    const a = normalizeTimeText(actual);
    const w = normalizeTimeText(wanted);
    if (a === w) return true;
    if (a === normalizeTimeText(wanted.replace(/\u202f/g, ' '))) return true;
    if (a === normalizeTimeText(wanted.replace(/ /g, '\u202f'))) return true;
    return false;
  }

  async function setPickerTimeVerified(timeStr, onProgress = () => {}) {
    const variants = [
      timeStr,
      timeStr.replace(/\u202f/g, ' '),
      timeStr.replace(/(\d)\s+([AaPp][Mm])$/, '$1\u202f$2')
    ];
    const m = normalizeTimeText(timeStr).match(/^(\d{1,2}:\d{2})([ap]m)$/i);
    if (m) variants.push(`${m[1]} ${m[2].toUpperCase()}`, `${m[1]}\u202f${m[2].toUpperCase()}`);

    const tried = new Set();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const dialog = findPickDateTimeDialog();
      if (!dialog) {
        throw new Error('Top Pick date & time dialog closed while setting time. Not marked as sent.');
      }
      const input = findTimeInputStrict(dialog);
      if (!input) throw new Error('No time input in the top Pick date & time dialog.');
      if (!isUncoveredInDialog(input, dialog)) {
        throw new Error('Time input is not on the top dialog (covered). Not marking as sent.');
      }

      const candidate = variants.find((v) => v && !tried.has(v)) || timeStr;
      tried.add(candidate);
      onProgress(`Setting top-dialog time ${candidate} (try ${attempt})…`);
      await setNativeInput(input, candidate);

      await sleep(400);
      const nowVal = readPickerTime();
      onProgress(`Top dialog time now: “${nowVal || 'empty'}”`);
      if (timeMatches(nowVal, timeStr) || timeMatches(nowVal, candidate)) {
        return candidate;
      }
    }
    throw new Error(
      `Could not commit schedule time (wanted ${timeStr}, field shows “${readPickerTime() || 'empty'}”). Not confirming.`
    );
  }

  function findPickDateTimeOption(root = document) {
    const candidates = [];
    const nodes = root.querySelectorAll(
      '[role="menuitem"], [role="option"], [role="button"], div.J-N, span.J-N-Jz, button, div, span, li'
    );
    for (const el of nodes) {
      if (!visible(el)) continue;
      const text = menuItemText(el);
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (!/pick date/.test(text) && !/pick date/.test(aria)) continue;
      if (!/time/.test(text) && !/time/.test(aria)) continue;
      // Prefer the compact row, not a huge dialog that merely contains the phrase.
      const rect = el.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 12) continue;
      if (rect.height > 80 || rect.width > 480) continue;
      if (text.length > 40) continue;
      const clickable =
        el.closest('[role="menuitem"], [role="option"], [role="button"], div.J-N, button') || el;
      candidates.push({
        el: clickable,
        score: 1000 - rect.height - text.length + (text === 'pick date & time' ? 50 : 0)
      });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].el;
  }

  async function chooseCustomSchedule(sendAtIso, onProgress = () => {}) {
    const sendAt = new Date(sendAtIso);
    if (Number.isNaN(sendAt.getTime())) throw new Error(`Invalid send_at: ${sendAtIso}`);

    await waitFor(
      () =>
        findPickDateTimeDialog() ||
        findScheduleChooserDialog() ||
        findPickDateTimeOption() ||
        findMenuItem(['pick date & time'], document),
      {
        label: 'schedule send dialog',
        timeoutMs: 15000
      }
    );

    // Open the top custom picker — exactly one click (never retry-click; that stacks dialogs).
    if (!findPickDateTimeDialog()) {
      const pick =
        findPickDateTimeOption() ||
        findMenuItem(['pick date & time', 'pick date and time'], document);
      if (!pick) {
        throw new Error('Could not find Pick date & time in the schedule menu.');
      }

      onProgress('Clicking Pick date & time once…');
      humanClick(pick);

      onProgress('Waiting for Pick date & time dialog…');
      await waitFor(() => findPickDateTimeDialog(), {
        label: 'Pick date & time dialog',
        timeoutMs: 20000,
        intervalMs: 250
      });

      onProgress('Waiting 15s after Pick date & time…');
      await sleep(15000);
    } else {
      onProgress('Waiting 5s for Pick date & time dialog…');
      await sleep(5000);
    }

    let dialog = findPickDateTimeDialog();
    if (!dialog) throw new Error('Pick date & time dialog not open.');

    // If a double-activation left extras underneath, Cancel them before editing.
    const stacked = listPickDateTimeDialogs();
    if (stacked.length > 1) {
      onProgress(`Found ${stacked.length} Pick date & time dialogs — keeping top only…`);
      await dismissExtraPickDialogs(dialog, onProgress);
      dialog = findPickDateTimeDialog();
      if (!dialog) throw new Error('Top Pick date & time dialog disappeared after cleanup.');
    }

    onProgress('Using top Pick date & time dialog only…');
    const workingDialog = dialog;
    const dateInput = findDateInputStrict(workingDialog);
    if (dateInput) {
      const sample = dateInput.value || 'Aug 4, 2026';
      const dateStr = formatDateLikeSample(sendAt, sample);
      onProgress(`Setting top-dialog date ${dateStr}…`);
      await setNativeInput(dateInput, dateStr);
      await sleep(300);
      if (!document.contains(workingDialog) || !visible(workingDialog)) {
        throw new Error(
          'Top Pick date & time dialog closed while setting date — not marked as sent.'
        );
      }
    }

    dialog = findPickDateTimeDialog() || workingDialog;
    if (!dialog || !document.contains(dialog)) {
      throw new Error('Top Pick date & time dialog disappeared.');
    }
    const liveTime = findTimeInputStrict(dialog);
    if (!liveTime) throw new Error('No time input in the top Pick date & time dialog.');

    const sampleTime = liveTime.value || '11:31\u202fPM';
    const timeStr = formatTimeLikeSample(sendAt, sampleTime);
    const committedStr = await setPickerTimeVerified(timeStr, onProgress);

    await sleep(500);
    const committed = readPickerTime();
    if (!timeMatches(committed, timeStr) && !timeMatches(committed, committedStr)) {
      throw new Error(
        `Top-dialog time not committed (wanted ${timeStr}, got “${committed}”). Not clicking Schedule send.`
      );
    }
    onProgress(`Verified top-dialog time “${committed}” — clicking Schedule send…`);

    dialog = findPickDateTimeDialog();
    if (!dialog) {
      throw new Error(
        'Top dialog closed before confirm — not marked as sent (wrong-layer risk).'
      );
    }

    // Cancel any background duplicates again right before confirm.
    if (listPickDateTimeDialogs().length > 1) {
      await dismissExtraPickDialogs(dialog, onProgress);
      dialog = findPickDateTimeDialog();
      if (!dialog) throw new Error('Top dialog lost during extra cleanup.');
    }

    let confirm = findConfirmScheduleButton(dialog);
    if (!confirm) {
      await sleep(500);
      confirm = findConfirmScheduleButton(findPickDateTimeDialog());
    }
    if (!confirm) {
      throw new Error('Could not find Schedule send button on the top Pick date & time dialog.');
    }

    onProgress(`Confirming Schedule send at ${committed || timeStr}…`);
    const beforeClick = readPickerTime();
    if (
      beforeClick &&
      !timeMatches(beforeClick, timeStr) &&
      !timeMatches(beforeClick, committedStr)
    ) {
      throw new Error(
        `Top-dialog time reverted to “${beforeClick}” before confirm (wanted ${timeStr}). Not confirming.`
      );
    }

    const btn = findConfirmScheduleButton(dialog) || confirm;
    if (!dialog.contains(btn)) {
      throw new Error('Schedule send button is not inside the top dialog.');
    }
    // One click only.
    humanClick(btn);

    await waitFor(
      () => !document.contains(dialog) || !visible(dialog) || !findTimeInputStrict(dialog),
      {
        label: 'confirmed picker closed',
        timeoutMs: 10000,
        intervalMs: 200
      }
    ).catch(() => null);

    if (document.contains(dialog) && visible(dialog) && findTimeInputStrict(dialog)) {
      const err = pickerValidationError();
      if (err) throw new Error(`Schedule send rejected — ${err}`);
      throw new Error(
        'Schedule send failed — top Pick date & time dialog still open. Not marked as sent.'
      );
    }

    // Dismiss any leftover underneath dialog so Gmail is clean.
    if (listPickDateTimeDialogs().length) {
      await dismissAllPickDialogs(onProgress);
    }

    onProgress('Scheduled in Gmail.');
    return { ok: true };
  }

  function nodeText(el) {
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function gmailSentToastVisible() {
    const nodes = document.querySelectorAll('[role="alert"], [role="status"], .bAq, .vh, .aT, span, div');
    for (const el of nodes) {
      if (!visible(el)) continue;
      const t = nodeText(el);
      if (!t || t.length > 90) continue;
      if (t.includes('message sent') || t.includes('sent. undo')) return true;
    }
    return false;
  }

  function composeSendError(compose) {
    const roots = [compose, ...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].filter(
      Boolean
    );
    const patterns = [
      /please specify at least one recipient/i,
      /address .* not recognized/i,
      /wasn't delivered/i,
      /was not delivered/i,
      /couldn't send/i,
      /could not send/i,
      /error sending/i
    ];
    for (const root of roots) {
      if (!visible(root)) continue;
      const text = (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 600) continue;
      for (const re of patterns) {
        const m = text.match(re);
        if (m) return m[0];
      }
    }
    return '';
  }

  function composeStillOpen(compose) {
    if (!compose) return Boolean(latestCompose());
    return document.contains(compose) && visible(compose);
  }

  async function clickSend(compose, onProgress = () => {}) {
    const sendBtn = await waitFor(() => findSendButton(compose), {
      label: 'Send button',
      timeoutMs: 12000
    });
    onProgress('Clicking Send…');

    const host = document.getElementById('cvlist-host');
    const prev = host ? host.style.pointerEvents : '';
    if (host) host.style.pointerEvents = 'none';
    try {
      const ok = await trustedClickElement(sendBtn);
      if (!ok) humanClick(sendBtn);
    } finally {
      if (host) host.style.pointerEvents = prev || '';
    }
  }

  async function waitForSent(compose, onProgress = () => {}) {
    onProgress('Waiting for Gmail to send…');
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const err = composeSendError(compose);
      if (err) throw new Error(`Send rejected — ${err}`);
      const toast = gmailSentToastVisible();
      const open = composeStillOpen(compose);
      if (toast && !open) return { ok: true };
      if (!open) {
        await sleep(350);
        const lateErr = composeSendError(null);
        if (lateErr) throw new Error(`Send rejected — ${lateErr}`);
        return { ok: true };
      }
      await sleep(200);
    }
    throw new Error('Send failed — compose still open. Not marked as sent.');
  }

  async function fillCompose(card, onProgress = () => {}) {
    const toEmail = String(card.toEmail || card.to_email || '').trim();
    const subject = card.messageTitle || card.message_title || '';
    const body = card.messageBody || card.message_body || '';

    if (!toEmail) throw new Error('Card missing target email (To).');

    await waitUntilGmailReady(onProgress);
    onProgress('Opening compose…');
    const compose = await openCompose(onProgress);
    await randDelay(700, 1800);

    onProgress(`Filling To (${toEmail})…`);
    await fillRecipient(compose, toEmail);
    await randDelay(800, 2000);

    onProgress('Filling Subject…');
    await fillSubject(compose, subject);
    await randDelay(800, 2000);

    onProgress('Filling body…');
    await fillBody(compose, body);
    await randDelay(1000, 2800);

    return { compose, toEmail };
  }

  /**
   * Full flow for one matching card: Gmail Schedule send.
   */
  async function scheduleCard(card, onProgress = () => {}) {
    const sendAt = card.sendAt || card.send_at;
    if (!sendAt) throw new Error('Card missing send_at.');

    const { compose, toEmail } = await fillCompose(card, onProgress);

    onProgress('Opening Schedule send…');
    await openScheduleSend(compose, onProgress);

    onProgress(`Setting schedule time (${sendAt})…`);
    await chooseCustomSchedule(sendAt, onProgress);

    onProgress('Scheduled in Gmail.');
    return { ok: true, toEmail };
  }

  /**
   * Full flow for one queued account: compose, fill, click Send now.
   */
  async function sendCard(card, onProgress = () => {}) {
    const { compose, toEmail } = await fillCompose(card, onProgress);
    await clickSend(compose, onProgress);
    await waitForSent(compose, onProgress);
    await randDelay(600, 1400);
    onProgress('Sent in Gmail.');
    return { ok: true, toEmail };
  }

  global.CVListGmail = {
    platformName: 'Gmail',
    supportsSchedule: true,
    detectLoggedInEmail,
    emailsMatch,
    normalizeEmail,
    scheduleCard,
    sendCard,
    findComposeButton,
    latestCompose,
    queryAllDeep,
    isPageReady: isGmailPageReady,
    isGmailPageReady,
    waitUntilReady: waitUntilGmailReady,
    waitUntilGmailReady
  };
  global.CVListMail = global.CVListGmail;
})(typeof globalThis !== 'undefined' ? globalThis : window);
