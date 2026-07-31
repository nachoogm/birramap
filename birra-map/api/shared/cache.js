/* ============================================================
   Caché en memoria del proceso.
   ============================================================
   Las Azure Functions reutilizan la instancia entre llamadas, así
   que guardar en memoria evita releer Table Storage una y otra vez.
   Es lo que hacía lentas las pestañas de Bares y Deudas: cada carga
   escaneaba dos años de filas.

   Con TTL corto (30-60 s) los datos siguen siendo frescos: si alguien
   vota o paga una ronda, se invalida la clave de su grupo al momento.
   ============================================================ */

const almacen = new Map();
let aciertos = 0, fallos = 0;

const ahora = () => Date.now();

/** Lee del caché si no ha caducado */
function get(clave) {
  const e = almacen.get(clave);
  if (!e) { fallos++; return null; }
  /* <= y no <: con TTL 0 tiene que caducar en el mismo milisegundo */
  if (e.expira <= ahora()) { almacen.delete(clave); fallos++; return null; }
  aciertos++;
  return e.valor;
}

/** Guarda con TTL en segundos */
function set(clave, valor, ttlSeg = 45) {
  /* tope defensivo: en una Function no queremos crecer sin control */
  if (almacen.size > 300) limpiar();
  almacen.set(clave, { valor, expira: ahora() + ttlSeg * 1000 });
  return valor;
}

/** Envuelve una función asíncrona con caché */
async function conCache(clave, ttlSeg, fn) {
  const hit = get(clave);
  if (hit !== null) return hit;
  const v = await fn();
  return set(clave, v, ttlSeg);
}

/** Borra todo lo de un grupo. Se llama al escribir. */
function invalidarGrupo(groupId) {
  const pre = `${groupId}:`;
  let n = 0;
  for (const k of [...almacen.keys()]) if (k.startsWith(pre)) { almacen.delete(k); n++; }
  return n;
}

/** Borra solo unas claves concretas de un grupo */
function invalidar(groupId, ...tipos) {
  let n = 0;
  for (const t of tipos) {
    for (const k of [...almacen.keys()]) {
      if (k.startsWith(`${groupId}:${t}`)) { almacen.delete(k); n++; }
    }
  }
  return n;
}

/** Quita lo caducado */
function limpiar() {
  const t = ahora();
  let n = 0;
  for (const [k, v] of almacen) if (v.expira <= t) { almacen.delete(k); n++; }
  /* si sigue enorme, tira lo más viejo */
  if (almacen.size > 250) {
    const sobra = [...almacen.entries()].sort((a, b) => a[1].expira - b[1].expira).slice(0, 100);
    sobra.forEach(([k]) => { almacen.delete(k); n++; });
  }
  return n;
}

const estado = () => ({
  entradas: almacen.size, aciertos, fallos,
  ratio: aciertos + fallos ? Math.round((aciertos / (aciertos + fallos)) * 100) : 0
});

const reset = () => { almacen.clear(); aciertos = 0; fallos = 0; };

module.exports = { get, set, conCache, invalidarGrupo, invalidar, limpiar, estado, reset };
