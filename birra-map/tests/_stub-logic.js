/* ⚠️ Este fichero es SOLO un stub para que los tests del parche puedan cargar store.js.
   NO lo subas: conserva el logic.js completo que ya tienes en tu repo. */
const MAX_TS = 9999999999999;
const invKey = ms => String(MAX_TS - ms).padStart(13, '0');
const uniq = () => Math.random().toString(36).slice(2, 8);
const rowKeyFor = (ms, userId, suffix = uniq()) => `${invKey(ms)}_${String(userId).replace(/[/\\#?]/g, '')}_${suffix}`;
module.exports = { MAX_TS, invKey, uniq, rowKeyFor };
