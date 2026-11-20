# 🛑 STOP Dominicano

El clásico juego de **STOP** de toda la vida, para jugar en línea con los panas y la familia desde la computadora o el celular, o solo contra bots.

**Juega ahora:** https://stop-dominicano.onrender.com

Sale una letra, todos llenan **Nombre, Apellido, Ciudad o País, Animal, Fruta o Comida, Color y Cosa**, y el primero que termine dice **¡STOP!** Al final se revisan las respuestas entre todos.

## Cómo se juega

1. Uno **crea una sala** y le pasa el enlace o el código de 4 letras a los demás.
2. El host escoge el tiempo, la cantidad de rondas, las categorías y las letras que pueden salir.
3. Cada ronda empieza con una cuenta regresiva y una **letra al azar** que no se repite en la partida.
4. Solo puede decir **STOP** quien haya llenado **todas** las casillas con la letra. Si nadie lo dice, la ronda termina cuando se acaba el tiempo.
5. **Revisión:** todos ven las respuestas y pueden votar 👎 **No vale**. Si la mayoría vota en contra, esa respuesta vale 0. Cuando todos marcan **✅ Listo** (o pasan 2 minutos) sigue la próxima ronda.
6. **Puntos:** 100 si nadie más la tiene, 50 si se repite y 0 si está vacía o no empieza con la letra. Las tildes y mayúsculas no cuentan, y las respuestas casi iguales (“Gato” y “Gatos”, “Guayaba” y “Guayava”) cuentan como repetidas.
7. Después de la última ronda sale el podio con el ganador 🏆.

## Qué trae

- **Modo solo contra bots** (Fácil, Normal o Difícil) y bots que se pueden agregar a cualquier sala. Escriben como una persona, poco a poco, con palabras dominicanas.
- **Chat de voz** (WebRTC) para hasta 8 personas, con silenciar y un indicador de quién está hablando.
- **Sala cerrada** 🔒 y límite de intentos para que nadie adivine códigos de salas ajenas.
- **Instalable como app** (PWA) y lista para Google Play (ver `play-store/GUIA.md`).

- Salas con código e **enlace para invitar** (en el celular se abre el menú de compartir).
- **El servidor manda:** tiempo, letra, quién dijo STOP y los puntos. Nadie puede hacer trampa desde el navegador.
- Las respuestas se guardan mientras escribes. Si se te cae el internet o recargas la página, **vuelves a tu puesto** con tus puntos (tienes 60 segundos).
- Si el host se va, otro jugador pasa a ser host automáticamente. El host puede **pasar el mando** 👑 o **sacar** a alguien ✕.
- Muestra cuántas casillas lleva llenas cada jugador, pero no lo que escribió.
- Categorías personalizables (con sugerencias como Artista, Pelotero, Marca, Carro…) y letras activables. Por defecto vienen apagadas K, Ñ, Q, W, X, Y y Z.
- Chat, sonidos (se pueden silenciar), vibración en el celular y diseño adaptado al celular con los colores de la bandera 🇩🇴.
- Seguro contra inyección de código: los nombres y las respuestas nunca se insertan como HTML.

## Correrlo en tu PC

Necesitas [Node.js](https://nodejs.org) 18 o más nuevo.

```bash
npm install
npm start
```

Abre <http://localhost:3000>. Para jugar con gente en la misma red Wi-Fi, que entren a `http://IP-DE-TU-PC:3000`.

Para usar otro puerto: `PORT=8080 npm start` (en Windows PowerShell: `$env:PORT=8080; npm start`).

## Variables de entorno (opcionales)

| Variable | Para qué |
|---|---|
| `PORT` | Puerto (Render lo pone solo). |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | TURN de Cloudflare para que la voz conecte en redes de celular con CGNAT. |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | Otro servidor TURN (URLs separadas por coma). |
| `ANDROID_PACKAGE`, `ANDROID_CERT_SHA256` | Datos de la app de Android para `/.well-known/assetlinks.json`. |

## Publicarlo en internet

Funciona en cualquier hosting que corra Node.js con WebSockets (Render, Railway, Fly.io, un VPS…). La página y el WebSocket van por el **mismo puerto**, y con HTTPS usa `wss://` solo.

Ejemplo en **Render** (Web Service):

- Build command: `npm install`
- Start command: `npm start`
- Health check: `/healthz`

> Las salas se guardan en memoria: si el servidor se reinicia, se borran las partidas en curso.

## Pruebas

```bash
npm test
```

Prueban la puntuación, las respuestas parecidas, los votos, el botón Listo, los bots, la voz, el STOP, el tiempo, la reconexión, la seguridad y partidas completas con jugadores simulados por WebSocket.

## Estructura

```
server.js          Servidor HTTP + WebSocket (+ señalización de voz)
src/room.js        Reglas del juego (salas, rondas, puntos, votos, bots, voz)
src/text.js        Comparación de respuestas (tildes, ñ, plurales, parecidas)
src/words.js       Palabras que usan los bots
public/            Página del juego (HTML, CSS, JS, service worker, íconos)
play-store/        Guía, textos, íconos y capturas para Google Play
test/              Pruebas automáticas
```
