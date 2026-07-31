# BirraMap v5 — tema claro/oscuro y carga rápida

Sustituyes la carpeta `birra-map` entera y listo. No hay nada que editar a mano.

---

## Tema claro, oscuro o automático

Tenías razón: el oscuro anterior era demasiado oscuro y el texto secundario
se perdía. Ahora hay tres opciones y además he subido el contraste del oscuro.

**Dónde se cambia:**
- **Botón rápido** en la barra de arriba (sol / luna): alterna al instante.
- **Perfil → Aspecto**: los tres modos, con Automático incluido.

**Automático** sigue la preferencia del sistema y reacciona en caliente: si tienes
el modo noche programado en el móvil, la app cambia sola a la hora que toque.

Cambia todo, no solo el fondo: **las teselas del mapa** también (dark_all ↔ light_all
de CartoDB) y la barra del navegador en el móvil.

**Contraste medido**, no a ojo. Los tests calculan el ratio WCAG de cada color de
texto sobre su fondo y fallan si baja de 4.5:1. Antes el texto secundario del oscuro
estaba en el límite; ahora los seis combinados pasan AA:

| | principal | secundario | terciario |
|---|---|---|---|
| Oscuro | 13.2:1 | 9.4:1 | 5.7:1 |
| Claro | 17.0:1 | 7.2:1 | 4.7:1 |

También hay un script que se ejecuta **antes** del CSS para que no haya destello
blanco al abrir en oscuro (ni negro al abrir en claro).

---

## Por qué iban lentas Bares y Deudas

Dos motivos, los dos arreglados:

**1. Escaneaban demasiado.** `/api/ratings` leía **2 años** de puntuaciones y
recalculaba el ranking entero en cada carga. Ahora la ventana es de 1 año y el
ranking ya calculado va en caché.

**2. Consultas encadenadas.** `membersOf()` pedía los miembros de uno en uno: con
8 personas eran 8 idas y vueltas seguidas. Ahora van en paralelo.

### Lo que se ha añadido

- **Caché en la API** (`api/shared/cache.js`) con TTL de 20-90 s según el dato.
  Las Azure Functions reutilizan la instancia, así que se aprovecha entre llamadas.
- **Invalidación al escribir**: votas o pagas una ronda y se tira el caché de tu
  grupo al momento. Nada de datos rancios.
- **Caché en el navegador** con deduplicación: dos peticiones iguales a la vez
  comparten una sola llamada.
- **Pintar y refrescar**: al volver a una pestaña se muestra lo que ya había
  mientras se busca lo nuevo por detrás. Se siente instantáneo.
- **Precarga**: al arrancar, Bares y Deudas se cargan en silencio a los 1,2 s.
- **Esqueletos** en vez de spinner: se ve la forma de la lista mientras carga.

### Medido

```bash
node tests/benchmark.js
```

Con un año de datos reales (1200 consumiciones, 300 rondas, 400 puntuaciones,
8 personas) y simulando los 25 ms por consulta que tarda Table Storage de verdad:

```
              antes    después
  Bares       53 ms  →   0 ms
  Deudas      54 ms  →   0 ms
  Calor       56 ms  →   0 ms
```

Y comprueba que el caché no miente: tras votar, el bar nuevo aparece al momento.

---

## Tests

```bash
node tests/test.js        # 315 comprobaciones
node tests/benchmark.js   # rendimiento con datos reales
```

Los nuevos cubren el módulo de temas (guardado, automático, teselas, avisos),
el contraste WCAG calculado sobre el CSS real, y el caché (aciertos,
invalidación por grupo, que no sirva datos viejos).

**Un bug que cazaron:** el caché con TTL 0 no caducaba si se leía en el mismo
milisegundo, porque comparaba `expira < ahora` en vez de `<=`.

---

## Subir

1. Borra el contenido de `birra-map/` en tu repo.
2. Copia todo esto dentro.
3. `git add -A && git commit -m "BirraMap v5" && git push`

En el móvil, la primera vez cierra la app del todo y ábrela: el service worker
sube a `v5-0-0` y tira la caché anterior.
