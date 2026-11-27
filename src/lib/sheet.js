/* Parse CSV / XLSX lists: column A = email, column B = verify status. */

(function (global) {
  const HEADER_RE = /^(e-?mails?|gmails?)$/i;
  const STATUS_HEADER_RE = /^(status|verify(?:[_\s-]?status)?|verified)$/i;
  const EMAIL_RE =
    /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

  function isStrictEmail(value) {
    const email = String(value ?? '').trim();
    if (!email) return false;
    if (/\s/.test(email)) return false;
    if (email.length > 254) return false;
    if (email.includes('..')) return false;
    if ((email.match(/@/g) || []).length !== 1) return false;
    return EMAIL_RE.test(email);
  }

  function normalizeEmail(value) {
    if (!isStrictEmail(value)) return '';
    return String(value).trim().toLowerCase();
  }

  function normalizeVerifyStatus(value) {
    const raw = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (!raw) return 'unknown';
    if (
      ['valid', 'vaild', 'valied', 'verified', 'deliverable', 'ok', 'okay', 'true', 'yes', '1'].includes(
        raw
      )
    ) {
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

  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function collectFromRows(rows) {
    const accounts = [];
    const emails = [];
    const seen = new Set();
    let empty = 0;
    let invalid = 0;
    let duplicates = 0;
    if (!rows.length) {
      return { accounts, emails, empty, invalid, duplicates, totalRows: 0 };
    }

    let start = 0;
    let emailCol = 0;
    let statusCol = 1;
    const first = rows[0] || [];
    const headerEmailIdx = first.findIndex((cell) => HEADER_RE.test(String(cell || '').trim()));
    const headerStatusIdx = first.findIndex((cell) => STATUS_HEADER_RE.test(String(cell || '').trim()));
    if (headerEmailIdx >= 0 || headerStatusIdx >= 0) {
      start = 1;
      if (headerEmailIdx >= 0) emailCol = headerEmailIdx;
      statusCol = headerStatusIdx >= 0 ? headerStatusIdx : emailCol + 1;
    }

    for (let i = start; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const raw = emailCol < row.length ? row[emailCol] : '';
      const cell = String(raw ?? '').trim();
      if (!cell) {
        empty += 1;
        continue;
      }
      if (HEADER_RE.test(cell)) continue;
      const email = normalizeEmail(cell);
      if (!email) {
        invalid += 1;
        continue;
      }
      if (seen.has(email)) {
        duplicates += 1;
        continue;
      }
      seen.add(email);
      const statusRaw = statusCol < row.length ? row[statusCol] : '';
      const verifyStatus = normalizeVerifyStatus(statusRaw);
      accounts.push({ email, verifyStatus });
      emails.push(email);
    }

    return { accounts, emails, empty, invalid, duplicates, totalRows: Math.max(0, rows.length - start) };
  }

  function rowsFromCsv(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '');
    return raw
      .split(/\r?\n/)
      .map((line) => parseCsvLine(line).map((cell) => String(cell || '').trim()))
      .filter((row) => row.some((cell) => cell));
  }

  function u16(view, offset) {
    return view.getUint16(offset, true);
  }

  function u32(view, offset) {
    return view.getUint32(offset, true);
  }

  async function inflateRaw(bytes) {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (err) {
      const msg = String(err && err.message ? err.message : err || '');
      if (/failed to fetch|networkerror|decompression/i.test(msg)) {
        throw new Error('Could not decompress this Excel file. Save as .xlsx or .csv and try again.');
      }
      throw err;
    }
  }

  function findDataDescriptor(buf, view, dataStart) {
    // ZIP bit 3: sizes come after the file data in a data descriptor.
    let i = dataStart;
    while (i + 16 <= buf.length) {
      if (u32(view, i) === 0x08074b50) {
        return { compSize: u32(view, i + 8), next: i + 16 };
      }
      // Descriptor without signature (some writers omit it).
      if (i > dataStart + 4 && u32(view, i + 8) === 0x04034b50) {
        return { compSize: i - dataStart, next: i };
      }
      if (u32(view, i) === 0x04034b50 || u32(view, i) === 0x02014b50) {
        return { compSize: Math.max(0, i - dataStart), next: i };
      }
      i += 1;
    }
    throw new Error('This Excel file uses an unsupported ZIP layout. Save as .csv and upload that.');
  }

  async function unzip(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const files = {};
    let offset = 0;
    while (offset + 30 <= buf.length) {
      if (u32(view, offset) !== 0x04034b50) break;
      const flags = u16(view, offset + 6);
      const method = u16(view, offset + 8);
      let compSize = u32(view, offset + 18);
      const nameLen = u16(view, offset + 26);
      const extraLen = u16(view, offset + 28);
      const nameBytes = buf.subarray(offset + 30, offset + 30 + nameLen);
      const name = new TextDecoder().decode(nameBytes);
      const dataStart = offset + 30 + nameLen + extraLen;
      let dataEnd = dataStart + compSize;
      if ((flags & 0x8) !== 0 || compSize === 0) {
        const desc = findDataDescriptor(buf, view, dataStart);
        compSize = desc.compSize;
        dataEnd = dataStart + compSize;
        offset = desc.next;
      } else {
        offset = dataEnd;
      }
      if (dataEnd > buf.length) {
        throw new Error('Excel file looks truncated or corrupted. Re-export as .xlsx or .csv.');
      }
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) files[name] = data.slice();
      else if (method === 8) files[name] = await inflateRaw(data);
      else throw new Error(`Cannot read ${name} from this Excel file (compression ${method}).`);
    }
    return files;
  }

  function localName(el) {
    return String(el.localName || el.tagName || '')
      .replace(/^.*:/, '')
      .toLowerCase();
  }

  function decodeXml(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function parseSharedStrings(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const list = [];
    for (const si of doc.getElementsByTagName('*')) {
      if (localName(si) !== 'si') continue;
      const parts = [];
      for (const node of si.getElementsByTagName('*')) {
        if (localName(node) === 't') parts.push(node.textContent || '');
      }
      list.push(parts.join(''));
    }
    return list;
  }

  function colIndex(ref) {
    const letters = String(ref || '').match(/^[A-Za-z]+/)?.[0] || 'A';
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function cellText(cell, shared) {
    const type = (cell.getAttribute('t') || '').toLowerCase();
    if (type === 'inlineStr' || type === 'inlinestr') {
      const parts = [];
      for (const node of cell.getElementsByTagName('*')) {
        if (localName(node) === 't') parts.push(node.textContent || '');
      }
      return parts.join('');
    }
    let value = '';
    for (const node of cell.children) {
      if (localName(node) === 'v') {
        value = node.textContent || '';
        break;
      }
    }
    if (type === 's') {
      const idx = Number(value);
      return Number.isInteger(idx) && shared[idx] != null ? String(shared[idx]) : '';
    }
    return value;
  }

  function rowsFromSheetXml(xml, shared) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rows = [];
    for (const rowEl of doc.getElementsByTagName('*')) {
      if (localName(rowEl) !== 'row') continue;
      const cells = [];
      for (const cellEl of rowEl.children) {
        if (localName(cellEl) !== 'c') continue;
        const idx = colIndex(cellEl.getAttribute('r') || '');
        while (cells.length < idx) cells.push('');
        cells[idx] = String(cellText(cellEl, shared) || '').trim();
      }
      if (cells.some((cell) => cell)) rows.push(cells);
    }
    return rows;
  }

  function firstSheetPath(files) {
    const names = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
    names.sort((a, b) => {
      const na = Number((a.match(/sheet(\d+)/i) || [])[1] || 0);
      const nb = Number((b.match(/sheet(\d+)/i) || [])[1] || 0);
      return na - nb;
    });
    return names[0] || '';
  }

  async function rowsFromXlsx(arrayBuffer) {
    const files = await unzip(arrayBuffer);
    const sheetPath = firstSheetPath(files);
    if (!sheetPath || !files[sheetPath]) {
      throw new Error('This Excel file has no worksheet.');
    }
    const shared = files['xl/sharedStrings.xml']
      ? parseSharedStrings(decodeXml(files['xl/sharedStrings.xml']))
      : [];
    return rowsFromSheetXml(decodeXml(files[sheetPath]), shared);
  }

  function isXlsxName(name) {
    return /\.xlsx$/i.test(String(name || ''));
  }

  function isLegacyXlsName(name) {
    return /\.xls$/i.test(String(name || '')) && !isXlsxName(name);
  }

  async function parseEmailListFile(file) {
    if (!file) throw new Error('No file selected.');
    const name = file.name ? file.name : '';
    if (isLegacyXlsName(name)) {
      throw new Error('Old .xls is not supported. Save the sheet as .xlsx or .csv, then upload again.');
    }
    let rows;
    try {
      if (isXlsxName(name) || /spreadsheetml/i.test(file.type || '')) {
        rows = await rowsFromXlsx(await file.arrayBuffer());
      } else if (/\.csv$/i.test(name) || /csv|text\/plain/i.test(file.type || '') || !name) {
        rows = rowsFromCsv(await file.text());
      } else {
        throw new Error('Use a .csv or .xlsx file.');
      }
    } catch (err) {
      const msg = String(err && err.message ? err.message : err || '');
      if (/failed to fetch/i.test(msg)) {
        throw new Error(
          'Could not read this Excel file. Open it in Excel/Sheets, Save as .csv or .xlsx, then upload again.'
        );
      }
      throw err instanceof Error ? err : new Error(msg || 'Could not read the list file.');
    }
    return collectFromRows(rows);
  }

  global.CVListSheet = {
    isStrictEmail,
    normalizeEmail,
    normalizeVerifyStatus,
    parseEmailListFile
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
