# 🍺 BirraMap v4 — estrellas, diseño nuevo y el arreglo de iPhone

## 🍎 Primero: por qué no iba el GPS en iPhone

No era el GPS. Era **la regla del gesto de Safari**.

En iOS, `navigator.geolocation` solo responde si la llamada sale **directamente** del toque del
usuario. Si antes hay un `await` —aunque sea de un milisegundo— iOS da el gesto por consumido y
**no llama ni al éxito ni al error: se queda mudo para siempre**. Sin mensaje, sin timeout, sin nada.
Por eso parecía que "no hacía nada": literalmente no hacía nada.

Tu `locate()` era `async function` con awaits por delante. En Android funciona igual, por eso
allí sí iba.

**El arreglo:** `GEO.pedirUbicacion()` **no es async** y la llamada al GPS es la primera línea que
se ejecuta. Además hay un perro guardián: si iOS no contesta en 4 segundos, lanza en paralelo un
segundo intento con precisión baja, que casi siempre responde al instante.

Hay un test que reproduce exactamente esto: simula iOS descartando las llamadas fuera del gesto
y comprueba que el método viejo falla y el nuevo funciona.

## ⭐ Puntuación de bares

De 0 a 5 estrellas, con comentario opcional. Un voto por persona y bar: si revotas, se sustituye.

El ranking usa el **límite inferior del intervalo de Wilson**, no la media pelada. Traducido: un
bar con un solo voto de 5 estrellas no adelanta a uno con veinte votos de 4,5, porque la confianza
estadística es distinta. La media real se sigue mostrando tal cual.

Se puede puntuar desde el modal de fichar (te lo ofrece al terminar), desde la pestaña Bares o
desde el botón morado del mapa.

## 🎨 Diseño

- **Tipografía real**: Outfit para títulos y números, Inter para el texto. Antes era la del sistema.
- **Chinchetas con forma de gota**, halo animado en quien está activo y contador integrado.
- **Mapa con tinte nocturno cálido** en vez del azul plano.
- Degradados, cristal esmerilado, micro-animaciones de entrada escalonadas.
- Estados vacíos con ilustración y texto que invita a hacer algo.
- Todo respeta `prefers-reduced-motion` y las zonas seguras del notch.

## 📖 Instrucciones

- **Tour de bienvenida** de 5 pasos la primera vez que entras.
- **Página `/ayuda.html`** con 11 apartados plegables, desde "cómo empiezo" hasta privacidad,
  incluyendo los pasos exactos de iPhone y Android para el GPS.
- Lleva un **comprobador de GPS** integrado que te dice tu precisión real.

## Míralo antes de integrar

- `/demo.html` — el diseño completo con datos de ejemplo
- `/ayuda.html` — las instrucciones

## Instalar

Lee `PARCHE.md`: son 5 cambios en `app.js` y unas líneas en `index.html`.

⚠️ **No subas `api/shared/logic.js` ni `api/shared/tables.js`** de este paquete: son versiones
reducidas solo para que corran los tests. Conserva las tuyas.

## Tests

```bash
node tests/test-todo.js     # 160 comprobaciones
```

Cubren la lógica de puntuaciones, la API completa, la simulación de iOS con la regla del gesto,
los componentes de interfaz y los ficheros del paquete.
