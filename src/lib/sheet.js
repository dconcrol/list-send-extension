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

  async function inflateWith(format, bytes) {
    const ds = new DecompressionStream(format);
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function inflateZipEntry(bytes) {
    try {
      return await inflateWith('deflate-raw', bytes);
    } catch {
      try {
        return await inflateWith('deflate', bytes);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err || '');
        if (/failed to fetch|networkerror|decompression/i.test(msg)) {
          throw new Error('Could not decompress this .xlsx file. Re-save it as .xlsx in Excel and upload again.');
        }
        throw err;
      }
    }
  }

  function findEndOfCentralDirectory(view, buf) {
    // EOCD is at the end; comment can be up to 64KB.
    const maxBack = Math.min(buf.length - 22, 0xffff + 22);
    for (let i = buf.length - 22; i >= buf.length - 22 - maxBack && i >= 0; i -= 1) {
      if (u32(view, i) === 0x06054b50) return i;
    }
    return -1;
  }

  async function unzip(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    if (buf.length < 30 || u32(view, 0) !== 0x04034b50) {
      throw new Error('This is not a valid .xlsx file.');
    }

    const eocd = findEndOfCentralDirectory(view, buf);
    if (eocd < 0) {
      throw new Error('Could not read this .xlsx archive. Re-save as .xlsx and try again.');
    }

    const totalEntries = u16(view, eocd + 10);
    let centralOffset = u32(view, eocd + 16);
    const files = {};

    for (let n = 0; n < totalEntries; n += 1) {
      if (centralOffset + 46 > buf.length || u32(view, centralOffset) !== 0x02014b50) {
        throw new Error('Excel .xlsx central directory is invalid.');
      }
      const method = u16(view, centralOffset + 10);
      const compSize = u32(view, centralOffset + 20);
      const nameLen = u16(view, centralOffset + 28);
      const extraLen = u16(view, centralOffset + 30);
      const commentLen = u16(view, centralOffset + 32);
      const localHeader = u32(view, centralOffset + 42);
      const nameBytes = buf.subarray(centralOffset + 46, centralOffset + 46 + nameLen);
      const name = new TextDecoder().decode(nameBytes);

      if (localHeader + 30 > buf.length || u32(view, localHeader) !== 0x04034b50) {
        throw new Error(`Missing data for ${name} in .xlsx.`);
      }
      const localNameLen = u16(view, localHeader + 26);
      const localExtraLen = u16(view, localHeader + 28);
      const dataStart = localHeader + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > buf.length) {
        throw new Error('Excel file looks truncated or corrupted.');
      }
      const data = buf.subarray(dataStart, dataEnd);
      if (method === 0) files[name] = data.slice();
      else if (method === 8) files[name] = await inflateZipEntry(data);
      else throw new Error(`Cannot read ${name} from this Excel file (compression ${method}).`);

      centralOffset += 46 + nameLen + extraLen + commentLen;
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
    const names = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet[^/]+\.xml$/i.test(name));
    names.sort((a, b) => {
      const na = Number((a.match(/sheet(\d+)/i) || [])[1] || 0);
      const nb = Number((b.match(/sheet(\d+)/i) || [])[1] || 0);
      return na - nb || a.localeCompare(b);
    });
    return names[0] || '';
  }

  function looksLikeZip(bytes) {
    return bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
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
    const rows = rowsFromSheetXml(decodeXml(files[sheetPath]), shared);
    if (!rows.length) throw new Error('The first sheet is empty.');
    return rows;
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
      throw new Error('Old .xls is not supported. Save as .xlsx (Excel Workbook) or .csv, then upload again.');
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const asXlsx =
      isXlsxName(name) ||
      /spreadsheetml|officedocument\.spreadsheetml/i.test(file.type || '') ||
      looksLikeZip(bytes);

    let rows;
    try {
      if (asXlsx) {
        if (!looksLikeZip(bytes)) {
          throw new Error('This file is not a real .xlsx. In Excel use File → Save As → Excel Workbook (.xlsx).');
        }
        rows = await rowsFromXlsx(buffer);
      } else if (/\.csv$/i.test(name) || /csv|text\/plain/i.test(file.type || '') || !name) {
        rows = rowsFromCsv(await file.text());
      } else {
        throw new Error('Upload a .xlsx or .csv list file.');
      }
    } catch (err) {
      const msg = String(err && err.message ? err.message : err || '');
      if (/failed to fetch/i.test(msg)) {
        throw new Error(
          'Could not read this .xlsx. Re-save it in Excel as .xlsx (or .csv) and upload again.'
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
