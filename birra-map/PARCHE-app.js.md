# Parche para `public/js/app.js` (2 minutos)

Esto es lo que causa **el bucle**: cuando `/api/me` devuelve 500, el código lo trata igual que "no has iniciado sesión" y te devuelve a la pantalla de login. Por eso entras, vuelve, entras, vuelve.

Abre `birra-map/public/js/app.js` y haz estos dos reemplazos.

---

## 1 · Que un error del servidor no te expulse

**BUSCA** esta línea (está dentro de `boot()`, cerca del principio):

```js
  try { me = await api('/me'); } catch { return screen('login'); }
```

**SUSTITÚYELA POR:**

```js
  try {
    me = await api('/me');
  } catch (e) {
    /* 401 = no hay sesión → al login. Cualquier otro error es del servidor:
       hay que enseñarlo, no dar vueltas en bucle. */
    if (e.status === 401) return screen('login');
    return fatal(e);
  }
```

---

## 2 · Guardar el código de estado y pintar el error

**BUSCA** la función `api` (arriba del todo):

```js
const api = async (path, opts = {}) => {
  const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401) { screen('login'); throw new Error('401'); }
  if (!r.ok) { let m = 'Error'; try { m = (await r.json()).error; } catch {} throw new Error(m); }
  return r.status === 204 ? null : r.json();
};
```

**SUSTITÚYELA POR:**

```js
const api = async (path, opts = {}) => {
  let r;
  try {
    r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  } catch (netErr) {
    const e = new Error('No hay conexión con el servidor.');
    e.status = 0;
    throw e;
  }
  if (!r.ok) {
    let msg = `Error ${r.status}`, extra = null;
    try { const j = await r.json(); msg = j.error || msg; extra = j; } catch {}
    const e = new Error(msg);
    e.status = r.status;
    e.detail = extra;
    throw e;
  }
  return r.status === 204 ? null : r.json();
};

/* Pantalla de error legible en vez de volver al login en bucle */
function fatal(e) {
  const esConfig = e.status === 503 || e.status === 500;
  document.body.innerHTML = `
    <div style="min-height:100dvh;display:flex;align-items:center;justify-content:center;
                background:radial-gradient(1000px 600px at 50% 0%,#1b3a72,#0b1b3a 60%);
                font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#eaf0ff;padding:20px">
      <div style="max-width:460px;background:#132a55;border:1px solid #22407a;border-radius:20px;padding:26px;text-align:center">
        <div style="font-size:2.6rem;margin-bottom:6px">🍺💥</div>
        <h2 style="margin:0 0 8px">${esConfig ? 'El servidor no puede guardar los datos' : 'Algo ha fallado'}</h2>
        <p style="color:#93a7cf;font-size:.92rem;line-height:1.5;margin:0 0 16px">${String(e.message).replace(/[<>&]/g, '')}</p>
        <p style="color:#6f86b5;font-size:.78rem;margin:0 0 18px">Código ${e.status}</p>
        <a href="/diag.html" style="display:block;background:linear-gradient(180deg,#ffd24a,#f5b301);color:#26180a;
           padding:13px;border-radius:12px;font-weight:700;text-decoration:none;margin-bottom:10px">Ver diagnóstico</a>
        <a href="/" style="display:block;background:transparent;border:1px solid #22407a;color:#eaf0ff;
           padding:13px;border-radius:12px;font-weight:600;text-decoration:none">Reintentar</a>
      </div>
    </div>`;
}
```

---

## Por qué importa

Sin esto, **cualquier** problema del servidor se ve como "vuelve a iniciar sesión", que es la peor pista posible: te hace pensar que el fallo está en el login cuando en realidad está en el almacenamiento.

Con el parche verás el mensaje real, por ejemplo:

> *Error al acceder al almacenamiento: The table specified does not exist* — Código 500

Y un botón directo al diagnóstico.

---

## Si prefieres no tocar nada

Puedes ignorar este parche y usar solo **`/diag.html`**, que funciona por su cuenta y no depende de `app.js`. El bucle seguirá existiendo, pero ya sabrás qué arreglar.
