/* Private Email webmail (Spacemail) compose automation. */

(function (global) {
  const Human = () => global.CVListHuman;

  const SUCCESS_RE = /message has been successfully sent/i;
  const FAIL_RES = [
    /message has not been sent/i,
    /email wasn'?t sent/i,
    /email was not sent/i,
    /invalid email address/i,
    /at least one email address/i,
    /recipient limit exceeded/i,
    /outgoing email limit/i,
    /quota exceeded/i,
    /delivery failed/i,
    /subject max length/i,
    /mail has no subject/i
  ];

  function sleep(ms) {
    return Human().delay(ms);
  }

  function randDelay(min, max) {
    return Human().randomDelay(min, max);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
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
    walk(root || document);
    return results;
  }

  async function waitFor(fn, { timeoutMs = 15000, intervalMs = 200, label = 'element' } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = fn();
      if (value) return value;
      await sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}. Private Email layout may have changed.`);
  }

  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

  function extractEmail(text) {
    const match = String(text || '').match(EMAIL_RE);
    if (!match) return null;
    const email = match[0].toLowerCase();
    if (/\.(png|jpe?g|gif|webp|svg|ico)(?:\?|$)/i.test(email)) return null;
    return email;
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function emailsMatch(a, b) {
    const left = normalizeEmail(a);
    const right = normalizeEmail(b);
    return Boolean(left && right && left === right);
  }

  function composeButtons() {
    return queryAllDeep(
      document,
      '#composeButton, [data-zid="composeButton"], [data-zid="mobileComposeButton"]'
    ).filter(visible);
  }

  function findComposeButton() {
    return (
      composeButtons().find((el) => el.getAttribute('aria-disabled') !== 'true' && !el.disabled) || null
    );
  }

  function isPageReady() {
    if (document.readyState === 'loading') return false;
    return composeButtons().length > 0;
  }

  async function waitUntilReady(onProgress = () => {}, timeoutMs = 60000) {
    if (isPageReady()) {
      await sleep(300);
      if (isPageReady()) return true;
    }
    onProgress('Waiting for Private Email to finish loading…');
    const start = Date.now();
    let stableSince = 0;
    while (Date.now() - start < timeoutMs) {
      if (isPageReady()) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 500) return true;
      } else {
        stableSince = 0;
      }
      await sleep(200);
    }
    throw new Error('Private Email is still loading. Open the mailbox and wait until Compose is shown.');
  }

  function composeWindows() {
    const seen = new Set();
    const list = [];
    for (const el of queryAllDeep(document, '[data-zid="composeWindow"], .spm-compose')) {
      const win = el.closest?.('.spm-compose') || el;
      if (!win || seen.has(win)) continue;
      if (win.getAttribute('data-zid') !== 'composeWindow' && !win.classList.contains('spm-compose')) continue;
      seen.add(win);
      list.push(win);
    }
    return list;
  }

  function findHeaderRow(compose, labelRe) {
    const labels = compose.querySelectorAll('label, .spm-label-form');
    for (const label of labels) {
      const text = (label.textContent || '').replace(/\s+/g, ' ').trim();
      if (!labelRe.test(text)) continue;
      return label.closest('.spm-compose__header-item') || label.parentElement?.parentElement || null;
    }
    return null;
  }

  function findSubjectInput(compose) {
    if (!compose) return null;
    const direct = compose.querySelector(
      'input#subject, textarea#subject, input[name="subject"], textarea[name="subject"], input[data-zid="subject"]'
    );
    if (direct) return direct;
    const row = findHeaderRow(compose, /^subject:?$/i);
    const htmlFor = row?.querySelector('label')?.htmlFor;
    if (htmlFor) {
      const linked = compose.querySelector(`#${CSS.escape(htmlFor)}`);
      if (linked && (linked.tagName === 'INPUT' || linked.tagName === 'TEXTAREA')) return linked;
    }
    return row?.querySelector('input, textarea') || null;
  }

  function findToRow(compose) {
    return findHeaderRow(compose, /^to:?$/i);
  }

  function findToInput(compose) {
    const row = findToRow(compose);
    if (!row) return null;
    return (
      row.querySelector('.gb-tag-input input, .gb-tag-input textarea') ||
      row.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])') ||
      row.querySelector('[contenteditable="true"]') ||
      null
    );
  }

  function controlLabel(el) {
    return (el.innerText || el.getAttribute('aria-label') || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isSendControl(el) {
    if (!el || !visible(el)) return false;
    if (el.getAttribute('data-zid') === 'sendEmailButton') return true;
    const text = controlLabel(el);
    if (!/^send$/i.test(text)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 36 && rect.width <= 240 && rect.height >= 24 && rect.height <= 72;
  }

  function findSendButton(compose) {
    const roots = [compose, document].filter(Boolean);
    const hits = [];
    const composeRect = compose && compose.getBoundingClientRect ? compose.getBoundingClientRect() : null;
    for (const root of roots) {
      for (const el of queryAllDeep(root, 'button, [role="button"], [data-zid="sendEmailButton"]')) {
        if (!isSendControl(el) || hits.includes(el)) continue;
        if (composeRect && root === document) {
          const rect = el.getBoundingClientRect();
          const inside =
            rect.top >= composeRect.top - 8 &&
            rect.left >= composeRect.left - 8 &&
            rect.bottom <= composeRect.bottom + 12 &&
            rect.right <= composeRect.right + 12;
          if (!inside) continue;
        }
        hits.push(el);
      }
      if (hits.length) break;
    }
    hits.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const zid = (el) => (el.getAttribute('data-zid') === 'sendEmailButton' ? 1 : 0);
      const enabled = (el) => (el.disabled || el.getAttribute('aria-disabled') === 'true' ? 0 : 1);
      return enabled(b) - enabled(a) || zid(b) - zid(a) || br.bottom - ar.bottom || br.right - ar.right;
    });
    return hits[0] || null;
  }

  function usableCompose(compose) {
    return Boolean(compose && compose.isConnected && findSubjectInput(compose) && findToInput(compose) && findSendButton(compose));
  }

  function latestUsableCompose() {
    const list = composeWindows().filter(usableCompose);
    return list[list.length - 1] || null;
  }

  function editorDoc(compose) {
    const iframe = compose.querySelector(
      '.spm-compose__editor-container iframe, .spm-compose__body iframe, iframe#htmlEditorIframeEditor, iframe'
    );
    if (iframe) {
      const doc = iframe.contentDocument;
      if (!doc) return null;
      const editor =
        doc.getElementById('htmlEditorIframeEditor') ||
        doc.querySelector('[contenteditable="true"]') ||
        null;
      if (editor) return { editor, doc, iframe };
    }
    const editor =
      compose.querySelector('#htmlEditorIframeEditor') ||
      compose.querySelector('.spm-compose__body [contenteditable="true"]');
    if (!editor) return null;
    return { editor, doc: editor.ownerDocument, iframe: null };
  }

  function editorPlain(editor) {
    if (!editor) return '';
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.spm-signature-block, .spm-quote-block').forEach((el) => el.remove());
    return (clone.textContent || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
  }

  function findFromRow(compose) {
    return findHeaderRow(compose, /^from:?$/i);
  }

  function findFromSelect(compose) {
    const row = findFromRow(compose);
    if (!row) return null;
    return (
      row.querySelector('select[name="from"], select#from, select[data-zid*="from" i]') ||
      row.querySelector('select') ||
      null
    );
  }

  function findFromTrigger(compose) {
    const row = findFromRow(compose);
    if (!row) return null;
    return (
      row.querySelector(
        '[data-zid*="from" i], [aria-haspopup="listbox"], [aria-haspopup="menu"], .spm-select, .gb-select, button, [role="button"], [role="combobox"]'
      ) ||
      row.querySelector('.spm-compose__header-item-value, .spm-field-value') ||
      row
    );
  }

  function fromDropdownNodes(compose) {
    const nodes = [];
    const roots = [compose, document.body, document].filter(Boolean);
    const selectors = [
      '[role="listbox"]',
      '[role="menu"]',
      '.spm-dropdown',
      '.spm-select-dropdown',
      '.gb-dropdown',
      '.spm-popover',
      '[data-zid*="from" i][role]',
      '.MuiMenu-list',
      '.MuiPopover-root'
    ];
    for (const root of roots) {
      for (const sel of selectors) {
        for (const el of queryAllDeep(root, sel)) {
          if (!visible(el)) continue;
          if (nodes.includes(el)) continue;
          nodes.push(el);
        }
      }
    }
    return nodes;
  }

  function emailsFromNode(el) {
    if (!el) return [];
    const bits = [
      el.value,
      el.getAttribute('data-value'),
      el.getAttribute('data-email'),
      el.getAttribute('title'),
      el.getAttribute('aria-label'),
      el.innerText,
      el.textContent
    ];
    return emailsInText(bits.filter(Boolean).join(' '));
  }

  function collectFromAliases(compose) {
    const found = new Set();
    const row = findFromRow(compose);
    const select = findFromSelect(compose);
    if (select) {
      for (const opt of select.querySelectorAll('option')) {
        for (const email of emailsFromNode(opt)) found.add(email);
      }
    }
    if (row) {
      for (const email of emailsInText(row.innerText || row.textContent || '')) found.add(email);
      for (const el of row.querySelectorAll('[data-email], [title], [aria-label], option, li, [role="option"]')) {
        for (const email of emailsFromNode(el)) found.add(email);
      }
    }
    for (const menu of fromDropdownNodes(compose)) {
      for (const el of menu.querySelectorAll(
        '[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, a, label, div, span'
      )) {
        for (const email of emailsFromNode(el)) found.add(email);
      }
      for (const email of emailsInText(menu.innerText || menu.textContent || '')) found.add(email);
    }
    return [...found];
  }

  function currentFromEmail(compose) {
    const select = findFromSelect(compose);
    if (select) {
      const opt = select.selectedOptions && select.selectedOptions[0];
      return extractEmail((opt && (opt.value || opt.textContent)) || select.value) || null;
    }
    const row = findFromRow(compose);
    return extractEmail(row && (row.innerText || row.textContent)) || null;
  }

  async function openFromMenu(compose) {
    const select = findFromSelect(compose);
    if (select) {
      select.focus();
      select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      select.click();
      await sleep(150);
      return select;
    }
    const trigger = findFromTrigger(compose);
    if (!trigger) return null;
    clickElement(trigger);
    await sleep(250);
    if (!fromDropdownNodes(compose).length) {
      await trustedClick(trigger);
      await sleep(300);
    }
    return trigger;
  }

  async function closeFromMenu(compose) {
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    pressKey(document.body, 'Escape');
    await sleep(120);
    const menus = fromDropdownNodes(compose);
    for (const menu of menus) {
      if (!visible(menu)) continue;
      pressKey(menu, 'Escape');
    }
  }

  function findComposeCloseButton(compose) {
    if (!compose) return null;
    const selectors = [
      '[data-zid="closeComposeButton"]',
      '[data-zid*="closeCompose" i]',
      'button[aria-label*="close" i]',
      '[aria-label*="Close compose" i]',
      '.spm-compose__close',
      '.spm-icon-close'
    ];
    for (const sel of selectors) {
      const el = compose.querySelector(sel);
      if (el && visible(el)) return el;
    }
    for (const el of compose.querySelectorAll('button, [role="button"], a')) {
      const label = controlLabel(el);
      if (/^close$/i.test(label) || /^×$/.test(label) || /^x$/i.test(label)) return el;
    }
    return null;
  }

  async function discardCompose(compose) {
    if (!compose || !compose.isConnected) return;
    const closeBtn = findComposeCloseButton(compose);
    if (closeBtn) {
      clickElement(closeBtn);
      await sleep(350);
      const discard = [...document.querySelectorAll('button, [role="button"]')].find((el) =>
        /^(discard|don't save|dont save|delete draft)$/i.test((el.innerText || '').replace(/\s+/g, ' ').trim())
      );
      if (discard && visible(discard)) {
        clickElement(discard);
        await sleep(250);
      }
    }
  }

  async function listAliases(onProgress = () => {}) {
    await waitUntilReady(onProgress);
    const existing = latestUsableCompose();
    let compose = existing;
    let opened = false;
    if (!compose) {
      onProgress('Opening compose to read aliases…');
      compose = await openCompose(onProgress);
      opened = true;
    } else {
      onProgress('Reading From aliases…');
    }

    try {
      let aliases = collectFromAliases(compose);
      if (aliases.length <= 1) {
        await openFromMenu(compose);
        await sleep(200);
        aliases = collectFromAliases(compose);
        await closeFromMenu(compose);
      }
      const current = currentFromEmail(compose);
      if (current && !aliases.includes(current)) aliases.push(current);
      aliases = [...new Set(aliases.map(normalizeEmail).filter(Boolean))];
      if (!aliases.length) {
        const fallback = detectLoggedInEmail();
        if (fallback) aliases = [fallback];
      }
      return aliases;
    } finally {
      if (opened) await discardCompose(compose);
    }
  }

  async function setFromAlias(compose, email, onProgress = () => {}) {
    const wanted = normalizeEmail(email);
    if (!wanted) throw new Error('No From alias selected.');
    if (emailsMatch(currentFromEmail(compose), wanted)) return true;

    onProgress(`Setting From to ${wanted}…`);
    const select = findFromSelect(compose);
    if (select) {
      const option = [...select.options].find((opt) =>
        emailsFromNode(opt).some((item) => emailsMatch(item, wanted))
      );
      if (!option) throw new Error(`From alias ${wanted} was not found in Private Email.`);
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
      if (emailsMatch(currentFromEmail(compose), wanted)) return true;
    }

    await openFromMenu(compose);
    await sleep(200);
    const menus = fromDropdownNodes(compose);
    const candidates = [];
    for (const menu of menus.length ? menus : [compose, document.body]) {
      for (const el of queryAllDeep(
        menu,
        '[role="option"], [role="menuitem"], [role="menuitemradio"], li, button, a, label, div, span'
      )) {
        if (!visible(el)) continue;
        if (!emailsFromNode(el).some((item) => emailsMatch(item, wanted))) continue;
        candidates.push(el);
      }
    }
    candidates.sort((a, b) => {
      const aText = (a.innerText || '').length;
      const bText = (b.innerText || '').length;
      return aText - bText;
    });
    const pick = candidates[0];
    if (!pick) {
      await closeFromMenu(compose);
      throw new Error(`From alias ${wanted} was not found in Private Email.`);
    }
    clickElement(pick);
    await sleep(300);
    if (!emailsMatch(currentFromEmail(compose), wanted)) {
      await trustedClick(pick);
      await sleep(350);
    }
    await closeFromMenu(compose);
    if (!emailsMatch(currentFromEmail(compose), wanted)) {
      throw new Error(`Could not set From to ${wanted}.`);
    }
    return true;
  }

  function detectLoggedInEmail() {
    const nodes = [
      document.querySelector('[data-zid="sidebarUserProfile"]'),
      document.querySelector('.spm-user-profile-dropdown'),
      document.querySelector('#userProfileDropdown'),
      document.querySelector('.spm-user-profile-email'),
      document.querySelector('[data-zid="displayUserEmail"]')
    ];
    for (const node of nodes) {
      const email = extractEmail(node && (node.innerText || node.textContent));
      if (email) return email;
    }
    for (const el of document.querySelectorAll('[role="tooltip"]')) {
      const email = extractEmail(el.innerText || el.textContent);
      if (email) return email;
    }
    const compose = latestUsableCompose();
    if (compose) {
      const email = currentFromEmail(compose);
      if (email) return email;
    }
    return null;
  }

  function clickElement(el) {
    if (!el) throw new Error('Nothing to click.');
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
  }

  async function trustedClick(el) {
    if (!el || !chrome.runtime?.sendMessage) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const host = document.getElementById('cvlist-host');
    const prev = host ? host.style.pointerEvents : '';
    if (host) host.style.pointerEvents = 'none';
    try {
      return await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'CVLIST_API', action: 'trustedClick', payload: { x, y } },
          (response) => {
            if (chrome.runtime.lastError || !response || response.ok === false) {
              resolve(false);
              return;
            }
            resolve(true);
          }
        );
      });
    } finally {
      if (host) host.style.pointerEvents = prev || '';
    }
  }

  async function openCompose(onProgress = () => {}) {
    const existing = composeWindows().filter(usableCompose);
    const empty = existing.find((win) => {
      const subject = findSubjectInput(win);
      const toRow = findToRow(win);
      const subjectEmpty = !subject || !String(subject.value || '').trim();
      const toEmpty = !toRow || !extractEmail(toRow.innerText || '');
      const body = editorDoc(win);
      const bodyEmpty = !body || !editorPlain(body.editor);
      return subjectEmpty && toEmpty && bodyEmpty;
    });
    if (empty) {
      onProgress('Using the open compose window…');
      return empty;
    }

    const before = new Set(composeWindows());
    const btn = await waitFor(() => findComposeButton() || (composeButtons().length ? 'disabled' : null), {
      label: 'Compose button',
      timeoutMs: 20000
    });
    if (btn === 'disabled') {
      throw new Error(
        'Compose is unavailable. Close an open compose window (only a few can stay open) and try again.'
      );
    }
    onProgress('Opening compose…');
    clickElement(btn);
    await randDelay(500, 900);
    if (!composeWindows().some((win) => !before.has(win))) {
      await trustedClick(btn);
      await sleep(700);
    }

    const compose = await waitFor(
      () => {
        const created = composeWindows().find((win) => !before.has(win) && usableCompose(win));
        return created || null;
      },
      { label: 'compose window', timeoutMs: 20000 }
    );
    await randDelay(250, 600);
    return compose;
  }

  function setInputValue(el, value) {
    const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
    if (isEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      return;
    }
    const proto =
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (proto && proto.set) proto.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressKey(el, key) {
    const keyCode = key === 'Enter' ? 13 : key === 'Escape' ? 27 : key === 'Tab' ? 9 : 0;
    const code = key === 'Enter' ? 'Enter' : key === 'Escape' ? 'Escape' : key === 'Tab' ? 'Tab' : key;
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true })
    );
    if (key === 'Enter' || key === 'Tab') {
      el.dispatchEvent(
        new KeyboardEvent('keypress', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true })
      );
    }
    el.dispatchEvent(
      new KeyboardEvent('keyup', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true })
    );
  }

  function emailsInText(text) {
    return [
      ...new Set(
        (String(text || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((item) =>
          item.toLowerCase()
        )
      )
    ];
  }

  function committedEmails(row) {
    if (!row) return [];
    const fromTags = [...row.querySelectorAll('.gb-tag')].flatMap((el) =>
      emailsInText(`${el.innerText || el.textContent || ''} ${el.getAttribute('title') || ''}`)
    );
    if (fromTags.length) return [...new Set(fromTags)];
    const clone = row.cloneNode(true);
    clone.querySelectorAll('input, textarea, [contenteditable="true"]').forEach((el) => el.remove());
    return emailsInText(clone.textContent || '');
  }

  async function fillRecipient(compose, email) {
    const row = await waitFor(() => findToRow(compose), { label: 'To field' });
    const input = findToInput(compose);
    if (!input) throw new Error('Could not find the To input.');

    input.focus();
    await randDelay(150, 350);
    setInputValue(input, email);
    await sleep(450);
    pressKey(input, 'Escape');
    await sleep(120);
    pressKey(input, 'Enter');
    await sleep(250);
    input.blur();
    await sleep(350);

    if (!committedEmails(row).some((item) => emailsMatch(item, email))) {
      input.focus();
      setInputValue(input, email);
      await sleep(300);
      pressKey(input, 'Tab');
      await sleep(400);
    }

    const kept = committedEmails(row);
    if (kept.length !== 1 || !emailsMatch(kept[0], email)) {
      throw new Error(
        kept.length
          ? `To field kept ${kept.join(', ')} instead of ${email}.`
          : `To field did not keep ${email}.`
      );
    }
  }

  async function fillSubject(compose, subject) {
    const field = await waitFor(() => findSubjectInput(compose), { label: 'Subject field' });
    const value = String(subject || '');
    if (value.length > 255) {
      throw new Error('Subject is longer than Private Email allows (255 characters).');
    }
    field.focus();
    await randDelay(120, 280);
    setInputValue(field, value);
    await sleep(200);
    if (String(field.value || '') !== value) {
      setInputValue(field, value);
      await sleep(150);
    }
    if (String(field.value || '') !== value) {
      throw new Error('Subject was not accepted by the compose form.');
    }
  }

  function findSignature(editor) {
    if (!editor) return null;
    return (
      editor.querySelector(':scope > .spm-signature-block[signatureid]') ||
      editor.querySelector(':scope > .spm-signature-block') ||
      editor.querySelector(':scope > [signatureid]') ||
      editor.querySelector('.spm-signature-block[signatureid]') ||
      editor.querySelector('.spm-signature-block') ||
      editor.querySelector('[signatureid]')
    );
  }

  function signatureAnchor(editor) {
    const signature = findSignature(editor);
    if (!signature) return null;
    let anchor = signature;
    while (anchor.parentNode && anchor.parentNode !== editor) anchor = anchor.parentNode;
    if (anchor.parentNode !== editor) return null;
    const prev = anchor.previousElementSibling;
    if (prev && prev.classList.contains('spm-empty-space')) return prev;
    return anchor;
  }

  function writeAboveSignature(editor, html) {
    const doc = editor.ownerDocument;
    const signature = findSignature(editor);
    const saved = signature ? signature.cloneNode(true) : null;
    const anchor = signatureAnchor(editor);
    while (editor.firstChild && editor.firstChild !== anchor) {
      editor.removeChild(editor.firstChild);
    }
    const block = doc.createElement('div');
    block.style.fontSize = '10.5pt';
    block.style.fontFamily = 'Arial, Helvetica, sans-serif';
    block.innerHTML = html || '<br>';
    if (anchor && anchor.parentNode === editor) editor.insertBefore(block, anchor);
    else editor.appendChild(block);
    if (saved && !findSignature(editor)) {
      const space = doc.createElement('div');
      space.className = 'spm-empty-space';
      space.appendChild(doc.createElement('br'));
      editor.appendChild(space);
      editor.appendChild(saved);
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  }

  async function fillBody(compose, body) {
    const found = await waitFor(() => editorDoc(compose), { label: 'message editor', timeoutMs: 20000 });
    const { editor, iframe } = found;
    const value = String(body || '');
    const html = Human().textToGmailHtml(value);
    iframe?.focus();
    editor.focus();
    writeAboveSignature(editor, html || '<br>');
    await sleep(200);
    const plain = editorPlain(editor);
    const snippet = value.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (value.trim() && snippet && !plain.includes(snippet)) {
      writeAboveSignature(editor, html || '<br>');
      await sleep(150);
    }
  }

  function noticeNodes(re) {
    const nodes = [];
    const all = document.querySelectorAll(
      '[role="alert"], [role="status"], [role="dialog"], [class*="toast"], [class*="notification"], [class*="system"], [class*="snack"]'
    );
    for (const el of all) {
      if (!visible(el)) continue;
      if (el.closest('.spm-email-viewer, .spm-conversation-viewer, .spm-search-panel')) continue;
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 280) continue;
      if (re.test(text)) nodes.push(el);
    }
    return nodes;
  }

  function sendErrorText() {
    for (const re of FAIL_RES) {
      const hit = noticeNodes(re)[0];
      if (hit) return (hit.innerText || hit.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  function freshSuccess(prior) {
    return noticeNodes(SUCCESS_RE).some((el) => !prior.has(el));
  }

  function composeClosed(compose) {
    return !compose.isConnected || !visible(compose);
  }

  async function clickSend(compose, onProgress, priorSuccess) {
    const sendBtn = await waitFor(() => findSendButton(compose), { label: 'Send button' });
    if (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') {
      throw new Error('Send is disabled. Check the recipient and subject.');
    }
    onProgress('Clicking Send…');
    const form = sendBtn.closest('form');
    try {
      if (form && typeof form.requestSubmit === 'function') form.requestSubmit(sendBtn);
      else clickElement(sendBtn);
    } catch {
      clickElement(sendBtn);
    }
    await sleep(700);
    if (sendErrorText() || freshSuccess(priorSuccess) || composeClosed(compose)) return;
    const busy =
      sendBtn.isConnected &&
      (sendBtn.disabled ||
        sendBtn.getAttribute('aria-disabled') === 'true' ||
        sendBtn.getAttribute('aria-busy') === 'true');
    if (busy) return;
    onProgress('Send click did not register. Trying again…');
    const again = findSendButton(compose) || sendBtn;
    const ok = await trustedClick(again);
    if (!ok && again.isConnected) clickElement(again);
  }

  async function waitForSent(compose, onProgress, priorSuccess) {
    onProgress('Waiting for Private Email to send…');
    const start = Date.now();
    while (Date.now() - start < 25000) {
      const err = sendErrorText();
      if (err) {
        if (/no subject/i.test(err)) {
          const add = [...document.querySelectorAll('button, [role="button"]')].find((el) =>
            /^add subject$/i.test((el.innerText || '').trim())
          );
          if (add) add.click();
        }
        throw new Error(`Send rejected — ${err}`);
      }
      if (freshSuccess(priorSuccess)) return { ok: true };
      if (composeClosed(compose)) {
        await sleep(500);
        const late = sendErrorText();
        if (late) throw new Error(`Send rejected — ${late}`);
        return { ok: true };
      }
      await sleep(200);
    }
    throw new Error('Send failed — compose is still open. Not marked as sent.');
  }

  async function sendCard(card, onProgress = () => {}) {
    const toEmail = String(card.toEmail || card.to_email || '').trim();
    const subject = card.messageTitle || card.message_title || '';
    const body = card.messageBody || card.message_body || '';
    const fromEmail = String(card.fromEmail || card.from_email || '').trim();
    if (!toEmail) throw new Error('Card missing target email (To).');

    await waitUntilReady(onProgress);
    const compose = await openCompose(onProgress);
    await randDelay(300, 700);

    if (fromEmail) {
      await setFromAlias(compose, fromEmail, onProgress);
      await randDelay(200, 450);
    }

    onProgress(`Filling To (${toEmail})…`);
    await fillRecipient(compose, toEmail);
    await randDelay(250, 600);

    onProgress('Filling Subject…');
    await fillSubject(compose, subject);
    await randDelay(250, 600);

    onProgress('Pasting message…');
    await fillBody(compose, body);

    const priorSuccess = new Set(noticeNodes(SUCCESS_RE));
    onProgress('Pasted. Sending…');
    await clickSend(compose, onProgress, priorSuccess);
    await waitForSent(compose, onProgress, priorSuccess);
    await randDelay(500, 1100);
    onProgress('Sent in Private Email.');
    return { ok: true, toEmail };
  }

  async function scheduleCard() {
    throw new Error('Private Email has no Schedule send. Use Direct send.');
  }

  const api = {
    platformName: 'Private Email',
    supportsSchedule: false,
    supportsAliases: true,
    detectLoggedInEmail,
    listAliases,
    setFromAlias,
    emailsMatch,
    normalizeEmail,
    sendCard,
    scheduleCard,
    isPageReady,
    isGmailPageReady: isPageReady,
    waitUntilReady,
    waitUntilGmailReady: waitUntilReady,
    findComposeButton
  };

  global.CVListPrivateEmail = api;
  global.CVListMail = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
