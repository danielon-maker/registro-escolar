// Simulador mínimo de Google Apps Script para probar Code.gs en Node.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const path = require('path');

function makeSheet(name) {
  let cells = []; // matriz de filas
  const sh = {
    name,
    getLastRow: () => { for (let i = cells.length; i > 0; i--) if (cells[i - 1] && cells[i - 1].some(v => v !== '' && v != null)) return i; return 0; },
    getLastColumn: () => cells.reduce((m, r) => Math.max(m, r ? r.reduce((mm, v, j) => (v !== '' && v != null ? j + 1 : mm), 0) : 0), 0),
    getMaxRows: () => Math.max(1000, cells.length), getMaxColumns: () => 26,
    setFrozenRows() {},
    getRange(r, c, nr = 1, nc = 1) {
      const rng = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((cells[r - 1 + i] || [])[c - 1 + j]) ?? ''); out.push(row); } return out; },
        setValues: (v) => { if (v.length !== nr || v[0].length !== nc) throw new Error('size mismatch'); v.forEach((row, i) => row.forEach((x, j) => { (cells[r - 1 + i] = cells[r - 1 + i] || [])[c - 1 + j] = x; })); return rng; },
        setValue: (x) => { (cells[r - 1] = cells[r - 1] || [])[c - 1] = x; return rng; },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (cells[r - 1 + i]) cells[r - 1 + i][c - 1 + j] = ''; return rng; },
        setNumberFormat: () => rng, setFontWeight: () => rng
      };
      return rng;
    },
    _cells: () => cells
  };
  return sh;
}

function load() {
  const sheets = {};
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)) };
  const cache = new Map();
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui'); } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, v) => [...crypto.createHash('sha256').update(v, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      base64Encode: bytes => Buffer.from(bytes.map(b => (b + 256) % 256)).toString('base64'),
      getUuid: () => crypto.randomUUID(),
      formatDate: d => d.toISOString().slice(0, 10)
    },
    Session: { getScriptTimeZone: () => 'America/Mexico_City' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
  ctx.call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  ctx._sheets = sheets;
  return ctx;
}
module.exports = { load };
