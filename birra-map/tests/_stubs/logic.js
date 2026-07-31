/* ⚠️ STUB solo para tests. NO subir: conserva tu logic.js completo. */
const MAX_TS = 9999999999999;
const invKey = ms => String(MAX_TS - ms).padStart(13, '0');
const uniq = () => Math.random().toString(36).slice(2, 8);
const rowKeyFor = (ms, u, s = uniq()) => `${invKey(ms)}_${String(u).replace(/[/\\#?]/g, '')}_${s}`;
module.exports = { MAX_TS, invKey, uniq, rowKeyFor };
