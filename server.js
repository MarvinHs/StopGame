'use strict';

/**
 * STOP Dominicano — servidor.
 * Sirve la página (carpeta public/) y el WebSocket en el MISMO puerto,
 * así funciona igual en tu PC, en la red de la casa o en un hosting.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Room, GameError } = require('./src/room');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O para no confundir
const MAX_ROOMS = 500;
const MSG_PER_SECOND = 25;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// ───────────────────────── HTTP (archivos estáticos) ─────────────────────────

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || !path.extname(pathname)) pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'",
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// ───────────────────────── Salas ─────────────────────────

let roomTiming = {}; // se puede acortar en las pruebas
const rooms = new Map(); // código -> Room
const sockets = new Map(); // código -> Map(playerId -> ws)

function newRoomCode() {
  for (let tries = 0; tries < 1000; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  throw new GameError('No se pudo crear la sala, intenta otra vez.');
}

const pendingBroadcast = new Set();

function broadcast(room) {
  // Juntamos varios cambios seguidos en un solo envío.
  if (pendingBroadcast.has(room.code)) return;
  pendingBroadcast.add(room.code);
  setImmediate(() => {
    pendingBroadcast.delete(room.code);
    const conns = sockets.get(room.code);
    if (!conns || room.closed) return;
    for (const [playerId, ws] of conns) {
      send(ws, { type: 'state', state: room.snapshot(playerId) });
    }
  });
}

function createRoom() {
  if (rooms.size >= MAX_ROOMS) throw new GameError('El servidor está lleno ahora mismo. Intenta en un rato.');
  const code = newRoomCode();
  const room = new Room(code, {
    timing: roomTiming,
    onChange: broadcast,
    onEvent: (event) => {
      const conns = sockets.get(code);
      if (!conns) return;
      if (event.kind === 'kicked') {
        const ws = conns.get(event.playerId);
        if (ws) {
          send(ws, { type: 'kicked' });
          conns.delete(event.playerId);
          ws.session = null;
          ws.close(4001, 'kicked');
        }
        return;
      }
      for (const ws of conns.values()) send(ws, { type: 'event', event });
    },
    onEmpty: (r) => {
      rooms.delete(r.code);
      sockets.delete(r.code);
    },
  });
  rooms.set(code, room);
  sockets.set(code, new Map());
  return room;
}

function getRoom(code) {
  const room = rooms.get(String(code || '').trim().toUpperCase());
  if (!room) throw new GameError('Esa sala no existe. Revisa el código.');
  return room;
}

function attach(ws, room, player) {
  const conns = sockets.get(room.code);
  const old = conns.get(player.id);
  if (old && old !== ws) {
    // El mismo jugador abrió otra pestaña o se reconectó: cerramos la vieja.
    old.session = null;
    send(old, { type: 'replaced' });
    old.close(4002, 'replaced');
  }
  conns.set(player.id, ws);
  ws.session = { code: room.code, playerId: player.id };
  send(ws, { type: 'joined', code: room.code, playerId: player.id, token: player.token });
  broadcast(room);
}

// ───────────────────────── WebSocket ─────────────────────────

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function handleMessage(ws, data) {
  const session = ws.session;

  // Mensajes que no necesitan estar en una sala.
  switch (data.type) {
    case 'create': {
      if (session) throw new GameError('Ya estás en una sala.');
      const room = createRoom();
      try {
        const player = room.addPlayer(data.name);
        attach(ws, room, player);
      } catch (err) {
        rooms.delete(room.code);
        sockets.delete(room.code);
        throw err;
      }
      return;
    }
    case 'join': {
      if (session) throw new GameError('Ya estás en una sala.');
      const room = getRoom(data.code);
      attach(ws, room, room.addPlayer(data.name));
      return;
    }
    case 'resume': {
      const room = rooms.get(String(data.code || '').toUpperCase());
      const player = room && room.resume(data.playerId, data.token);
      if (!player) {
        send(ws, { type: 'resumeFailed' });
        return;
      }
      attach(ws, room, player);
      return;
    }
    case 'ping':
      send(ws, { type: 'pong', t: data.t });
      return;
    default:
      break;
  }

  if (!session) throw new GameError('Primero entra a una sala.');
  const room = rooms.get(session.code);
  if (!room) throw new GameError('La sala ya no existe.');
  const me = session.playerId;

  switch (data.type) {
    case 'settings':
      return room.updateSettings(me, data.settings);
    case 'start':
      return room.start(me);
    case 'draft':
      return room.saveDraft(me, data.answers);
    case 'stop':
      return room.stop(me, data.answers);
    case 'vote':
      return room.vote(me, String(data.playerId), data.category, Boolean(data.reject));
    case 'confirm':
      return room.confirmRound(me);
    case 'lobby':
      return room.backToLobby(me);
    case 'kick':
      return room.kick(me, String(data.playerId));
    case 'makeHost':
      return room.makeHost(me, String(data.playerId));
    case 'chat':
      return room.sendChat(me, data.text);
    case 'leave': {
      sockets.get(room.code)?.delete(me);
      ws.session = null;
      room.removePlayer(me, 'salió');
      send(ws, { type: 'left' });
      return;
    }
    default:
      throw new GameError('Mensaje desconocido.');
  }
}

function onDisconnect(ws) {
  const session = ws.session;
  if (!session) return;
  ws.session = null;
  const conns = sockets.get(session.code);
  if (conns && conns.get(session.playerId) === ws) conns.delete(session.playerId);
  const room = rooms.get(session.code);
  if (room) room.setConnected(session.playerId, false);
}

function start(port = PORT, options = {}) {
  roomTiming = options.timing || {};
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.session = null;
    ws.budget = { count: 0, since: Date.now() };
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      // Límite simple de mensajes por segundo para que nadie tumbe la sala.
      const now = Date.now();
      if (now - ws.budget.since > 1000) ws.budget = { count: 0, since: now };
      if (++ws.budget.count > MSG_PER_SECOND) return;

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      if (!data || typeof data.type !== 'string') return;
      try {
        handleMessage(ws, data);
      } catch (err) {
        if (err instanceof GameError) send(ws, { type: 'error', message: err.message });
        else {
          console.error('Error procesando mensaje', data.type, err);
          send(ws, { type: 'error', message: 'Ocurrió un error en el servidor.' });
        }
      }
    });

    ws.on('close', () => onDisconnect(ws));
    ws.on('error', () => onDisconnect(ws));
  });

  // Detecta conexiones muertas (celular que perdió la señal, etc.).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 20000);
  wss.on('close', () => clearInterval(heartbeat));

  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = server.address().port;
      console.log(`🛑 STOP Dominicano listo en http://localhost:${actual}`);
      resolve({ server, wss, port: actual, rooms });
    });
  });
}

if (require.main === module) start();

module.exports = { start, rooms };
