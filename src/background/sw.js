/* ContactVault List Send — independent store. Verify status comes from the uploaded sheet. */

const MAX_ACCOUNTS = 20000;
const GAP_MINUTES = 1;
const TITLE_MAX = 500;
const CONTENT_MAX = 8000;

const STORAGE = {
  accounts: 'cvlist.accounts',
  templates: 'cvlist.templates',
  schedule: 'cvlist.schedule'
};

let storeLock = Promise.resolve();

function withStore(fn) {
  const next = storeLock.then(fn, fn);
  storeLock = next.catch(() => {});
  return next;
}

function nid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isStrictEmail(value) {
  const email = String(value ?? '').trim();
  if (!email) return false;
  if (/\s/.test(email)) return false;
  if (email.length > 254) return false;
  if (email.includes('..')) return false;
  if ((email.match(/@/g) || []).length !== 1) return false;
  return /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
    email
  );
}

function normalizeEmail(value) {
  return isStrictEmail(value) ? String(value).trim().toLowerCase() : '';
}

function normalizeVerifyStatus(status) {
  const raw = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!raw) return 'unknown';
  if (['valid', 'vaild', 'valied', 'verified', 'deliverable', 'ok', 'okay', 'true', 'yes', '1'].includes(raw)) {
    return 'valid';
  }
  if (['invalid', 'undeliverable', 'bounce', 'bounced', 'false', 'no', '0'].includes(raw)) {
    return 'invalid';
  }
  if (raw === 'unknown') return 'unknown';
  if (['catch_all', 'catchall', 'risky', 'accept_all', 'acceptall'].includes(raw)) {
    return 'risky';
  }
  if (raw === 'error' || raw === 'pending') return raw;
  return 'risky';
}

function resolveTemplate(text) {
  return String(text || '').replace(/\{([^{}]+)\}/g, (match, inner) => {
    if (!String(inner).includes('|')) return match;
    const options = String(inner)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!options.length) return '';
    return options[Math.floor(Math.random() * options.length)];
  });
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function takeEligibleBatch(state, count, accountIds) {
  const titles = state.templates.filter((t) => t.kind === 'title');
  const contents = state.templates.filter((t) => t.kind === 'content');
  if (!titles.length) {
    throw Object.assign(new Error('Create a title template first.'), { status: 400 });
  }
  if (!contents.length) {
    throw Object.assign(new Error('Create a content template first.'), { status: 400 });
  }
  let eligible = state.accounts.filter(
    (a) => (a.verifyStatus === 'valid' || a.verifyStatus === 'unknown') && !a.sent
  );
  if (Array.isArray(accountIds)) {
    const order = new Map(accountIds.map((id, index) => [String(id), index]));
    eligible = eligible
      .filter((a) => order.has(String(a.id)))
      .sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)));
  }
  const n = Array.isArray(accountIds) ? eligible.length : Math.min(count, eligible.length);
  if (!n) {
    throw Object.assign(
      new Error('No unsent accounts with valid or unknown status available to send.'),
      { status: 400 }
    );
  }
  return eligible.slice(0, n).map((acc) => ({
    accountId: acc.id,
    email: acc.email,
    title: resolveTemplate(pick(titles).content),
    body: resolveTemplate(pick(contents).content)
  }));
}

function statsOf(accounts) {
  const list = Array.isArray(accounts) ? accounts : [];
  return {
    total: list.length,
    sent: list.filter((a) => a.sent).length,
    verified: list.filter((a) => a.verifyStatus === 'valid').length
  };
}

async function loadAll() {
  const stored = await chrome.storage.local.get([
    STORAGE.accounts,
    STORAGE.templates,
    STORAGE.schedule
  ]);
  return {
    accounts: Array.isArray(stored[STORAGE.accounts]) ? stored[STORAGE.accounts] : [],
    templates: Array.isArray(stored[STORAGE.templates]) ? stored[STORAGE.templates] : [],
    schedule: Array.isArray(stored[STORAGE.schedule]) ? stored[STORAGE.schedule] : []
  };
}

async function saveAll(patch) {
  const next = {};
  if (patch.accounts) next[STORAGE.accounts] = patch.accounts;
  if (patch.templates) next[STORAGE.templates] = patch.templates;
  if (patch.schedule) next[STORAGE.schedule] = patch.schedule;
  if (Object.keys(next).length) await chrome.storage.local.set(next);
}

async function snapshot() {
  const all = await loadAll();
  return {
    ok: true,
    ...all,
    stats: statsOf(all.accounts)
  };
}

async function importAccounts(rawRows) {
  const incoming = [];
  const seen = new Set();
  for (const row of rawRows || []) {
    const email = normalizeEmail(typeof row === 'string' ? row : row && row.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    incoming.push({
      email,
      verifyStatus: normalizeVerifyStatus(typeof row === 'string' ? '' : row && row.verifyStatus)
    });
  }
  if (!incoming.length) {
    throw Object.assign(new Error('No valid email addresses found in the file.'), { status: 400 });
  }

  return withStore(async () => {
    const all = await loadAll();
    const existing = new Map(all.accounts.map((a) => [a.email, a]));
    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const next = [...all.accounts];
    for (const row of incoming) {
      const prev = existing.get(row.email);
      if (prev) {
        if (prev.sent) {
          skipped += 1;
          continue;
        }
        const idx = next.findIndex((a) => a.id === prev.id);
        if (idx >= 0 && next[idx].verifyStatus !== row.verifyStatus) {
          next[idx] = {
            ...next[idx],
            verifyStatus: row.verifyStatus,
            verifyScore: null,
            verifiedAt: now,
            verifyError: ''
          };
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      if (next.length >= MAX_ACCOUNTS) {
        throw Object.assign(new Error(`Account cap is ${MAX_ACCOUNTS}.`), { status: 400 });
      }
      next.push({
        id: nid('acc'),
        email: row.email,
        verifyStatus: row.verifyStatus,
        verifyScore: null,
        verifiedAt: now,
        sent: false,
        sentAt: null,
        createdAt: now
      });
      added += 1;
    }
    await saveAll({ accounts: next });
    return { added, updated, skipped, total: next.length, stats: statsOf(next) };
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function trustedClickAt(tabId, x, y) {
  const target = { tabId };
  let attachedHere = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attachedHere = true;
  } catch (err) {
    const msg = String(err && err.message);
    if (!/already attached/i.test(msg)) throw err;
  }
  try {
    await sleep(40);
    const moved = { type: 'mouseMoved', x, y };
    const down = { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 };
    const up = { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 };
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', moved);
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', down);
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', up);
  } finally {
    if (attachedHere) {
      try {
        await chrome.debugger.detach(target);
      } catch {
        /* already detached */
      }
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('ContactVault List Send ready.');
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cvlist-keepalive') return;
  port.onDisconnect.addListener(() => {});
});

function isMailTab(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const path = parsed.pathname || '/';
    if (host === 'mail.google.com') return true;
    if (host === 'privateemail.com') return /^\/(spm|pm)\/(?:[^/]+\/)?mail/i.test(path);
    if (host === 'www.spacemail.com' || host === 'spacemail.com') return /\/mail/i.test(path);
  } catch {
    return false;
  }
  return false;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !isMailTab(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'CVLIST_TOGGLE_PANEL' });
  } catch {
    /* content script may not be ready yet */
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'CVLIST_API') return undefined;

  (async () => {
    const { action, payload = {} } = message;
    switch (action) {
      case 'trustedClick': {
        const tabId = sender.tab && sender.tab.id;
        if (!tabId) throw new Error('No mail tab for the send click.');
        await trustedClickAt(tabId, Number(payload.x), Number(payload.y));
        return { ok: true };
      }
      case 'getState':
        return snapshot();
      case 'importAccounts': {
        const data = await importAccounts(payload.accounts || payload.emails || []);
        return { ok: true, ...data };
      }
      case 'clearAccounts': {
        await withStore(async () => {
          await saveAll({ accounts: [], schedule: [] });
        });
        return snapshot();
      }
      case 'saveTemplate': {
        const kind = payload.kind === 'title' ? 'title' : payload.kind === 'content' ? 'content' : '';
        const content = String(payload.content || '').trim();
        if (!kind) throw Object.assign(new Error('Kind must be title or content.'), { status: 400 });
        if (!content) throw Object.assign(new Error('Template content is required.'), { status: 400 });
        const max = kind === 'title' ? TITLE_MAX : CONTENT_MAX;
        if (content.length > max) {
          throw Object.assign(new Error(`Template is too long (max ${max}).`), { status: 400 });
        }
        const all = await withStore(async () => {
          const state = await loadAll();
          const now = new Date().toISOString();
          const id = payload.id ? String(payload.id) : '';
          if (id) {
            const idx = state.templates.findIndex((t) => t.id === id);
            if (idx < 0) throw Object.assign(new Error('Template not found.'), { status: 404 });
            state.templates[idx] = { ...state.templates[idx], kind, content, updatedAt: now };
          } else {
            state.templates.unshift({
              id: nid('tpl'),
              kind,
              content,
              createdAt: now,
              updatedAt: now
            });
          }
          await saveAll({ templates: state.templates });
          return state;
        });
        return { ok: true, templates: all.templates };
      }
      case 'deleteTemplate': {
        const id = String(payload.id || '');
        const all = await withStore(async () => {
          const state = await loadAll();
          const next = state.templates.filter((t) => t.id !== id);
          if (next.length === state.templates.length) {
            throw Object.assign(new Error('Template not found.'), { status: 404 });
          }
          await saveAll({ templates: next });
          return { ...state, templates: next };
        });
        return { ok: true, templates: all.templates };
      }
      case 'buildSchedule': {
        const count = Math.max(0, Math.floor(Number(payload.count) || 0));
        if (!count) throw Object.assign(new Error('Enter how many accounts to schedule.'), { status: 400 });
        const all = await withStore(async () => {
          const state = await loadAll();
          const batch = takeEligibleBatch(state, count);
          let t = Date.now() + 15 * 60 * 1000;
          const schedule = batch.map((item, i) => {
            if (i > 0) t += GAP_MINUTES * 60 * 1000;
            return {
              id: nid('sch'),
              accountId: item.accountId,
              email: item.email,
              sendAt: new Date(t).toISOString(),
              title: item.title,
              body: item.body,
              error: '',
              createdAt: new Date().toISOString()
            };
          });
          await saveAll({ schedule });
          return { ...state, schedule };
        });
        return {
          ok: true,
          schedule: all.schedule,
          queued: all.schedule.length,
          stats: statsOf(all.accounts)
        };
      }
      case 'prepareDirectSend': {
        const accountIds = Array.isArray(payload.accountIds)
          ? payload.accountIds.map((id) => String(id || '')).filter(Boolean)
          : [];
        const count = Math.max(0, Math.floor(Number(payload.count) || 0));
        if (!accountIds.length && !count) {
          throw Object.assign(new Error('Select accounts to send.'), { status: 400 });
        }
        const all = await withStore(async () => {
          const state = await loadAll();
          const items = takeEligibleBatch(
            state,
            accountIds.length || count,
            accountIds.length ? accountIds : undefined
          );
          await saveAll({ schedule: [] });
          return { ...state, schedule: [], items };
        });
        return {
          ok: true,
          items: all.items,
          schedule: [],
          stats: statsOf(all.accounts)
        };
      }
      case 'markAccountSent': {
        const accountId = String(payload.accountId || '');
        const all = await withStore(async () => {
          const state = await loadAll();
          const sentAt = new Date().toISOString();
          const accounts = state.accounts.map((a) =>
            a.id === accountId ? { ...a, sent: true, sentAt } : a
          );
          if (!accounts.some((a) => a.id === accountId)) {
            throw Object.assign(new Error('Account not found.'), { status: 404 });
          }
          await saveAll({ accounts, schedule: [] });
          return { ...state, accounts, schedule: [] };
        });
        return { ok: true, ...all, stats: statsOf(all.accounts) };
      }
      case 'removeScheduleItem': {
        const id = String(payload.id || '');
        const all = await withStore(async () => {
          const state = await loadAll();
          await saveAll({ schedule: state.schedule.filter((s) => s.id !== id) });
          return loadAll();
        });
        return { ok: true, schedule: all.schedule };
      }
      case 'completeScheduleItem': {
        const id = String(payload.id || '');
        const all = await withStore(async () => {
          const state = await loadAll();
          const item = state.schedule.find((s) => s.id === id);
          if (!item) throw Object.assign(new Error('Schedule item not found.'), { status: 404 });
          const sentAt = payload.immediate ? new Date().toISOString() : item.sendAt || new Date().toISOString();
          await saveAll({
            schedule: state.schedule.filter((s) => s.id !== id),
            accounts: state.accounts.map((a) =>
              a.id === item.accountId ? { ...a, sent: true, sentAt } : a
            )
          });
          return loadAll();
        });
        return { ok: true, ...all, stats: statsOf(all.accounts) };
      }
      case 'failScheduleItem': {
        const id = String(payload.id || '');
        const error = String(payload.error || 'Schedule failed.');
        const all = await withStore(async () => {
          const state = await loadAll();
          await saveAll({
            schedule: state.schedule.map((s) => (s.id === id ? { ...s, error } : s))
          });
          return loadAll();
        });
        return { ok: true, schedule: all.schedule };
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  })()
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error),
        status: error && error.status ? error.status : 500
      })
    );

  return true;
});
