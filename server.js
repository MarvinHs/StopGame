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
const { Room, GameError, LIMITS } = require('./src/room');
const { Lobby, LOBBY_LIMITS } = require('./src/lobby');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O para no confundir
const MAX_ROOMS = 500;
const MSG_PER_SECOND = 60; // alto porque el chat de voz manda ráfagas al conectar
// Para que nadie adivine códigos de sala ajenas. El límite por IP es más alto porque
// en RD muchas personas de la misma compañía de celular comparten IP (CGNAT).
const JOIN_FAILS_PER_CONN = 8;
const JOIN_FAILS_PER_IP = 40;

// Android (Play Store): datos para /.well-known/assetlinks.json
const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE || 'com.soportesrd.stopdominicano';
const ANDROID_SHA256 = (process.env.ANDROID_CERT_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean);

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
  if (url.pathname === '/ice') {
    getIceServers().then((iceServers) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ iceServers }));
    });
    return;
  }
  if (url.pathname === '/.well-known/assetlinks.json') {
    const body = ANDROID_SHA256.length
      ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_SHA256 } }]
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const PAGES = { '/privacidad': '/privacidad.html', '/offline': '/offline.html' };
  if (PAGES[pathname]) pathname = PAGES[pathname];
  else if (pathname === '/' || !path.extname(pathname)) pathname = '/index.html';
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
      'Cache-Control': /\.(html|webmanifest)$|sw\.js$/.test(filePath) ? 'no-cache' : 'public, max-age=300',
      'Permissions-Policy': 'microphone=(self), camera=()',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; media-src 'self' blob: mediastream:; worker-src 'self'; manifest-src 'self'",
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// ───────────────────────── Chat de voz: servidores ICE ─────────────────────────
// STUN (gratis) basta en la mayoría de las redes. Para redes de celular con CGNAT
// hace falta un TURN: configura TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL, o bien
// CF_TURN_KEY_ID/CF_TURN_API_TOKEN para usar el TURN de Cloudflare.

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
let cfCache = { at: 0, servers: null };

async function getIceServers() {
  const servers = [...STUN];
  if (process.env.TURN_URLS) {
    servers.push({
      urls: process.env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  const keyId = process.env.CF_TURN_KEY_ID;
  const token = process.env.CF_TURN_API_TOKEN;
  if (keyId && token) {
    try {
      if (!cfCache.servers || Date.now() - cfCache.at > 3600 * 1000) {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 6 * 3600 }),
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        // Los navegadores bloquean el puerto 53: lo quitamos para no esperar en vano.
        const list = [].concat(data.iceServers || []).map((srv) => ({
          ...srv,
          urls: [].concat(srv.urls || []).filter((u) => !/:53(\?|$)/.test(u)),
        }));
        cfCache = { at: Date.now(), servers: list };
      }
      servers.push(...cfCache.servers);
    } catch (err) {
      console.error('No se pudieron obtener credenciales TURN de Cloudflare:', err.message);
    }
  }
  return servers;
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

// Chat principal (pantalla de inicio) y lista de salas abiertas.
function listPublicRooms() {
  const now = Date.now();
  const list = [];
  for (const room of rooms.values()) {
    if (!room.public || room.locked || room.closed) continue;
    if (now - room.sharedAt > LOBBY_LIMITS.publicRoomMs) continue;
    const humans = room.humans().filter((p) => p.connected);
    if (!humans.length || room.players.size >= LIMITS.maxPlayers) continue;
    const host = room.players.get(room.hostId);
    list.push({
      code: room.code,
      host: host ? host.name : '',
      players: room.players.size,
      max: LIMITS.maxPlayers,
      phase: room.phase,
      round: room.round,
      rounds: room.settings.rounds,
    });
  }
  return list.slice(0, 20);
}

const lobby = new Lobby({ send: (ws, data) => send(ws, data), listRooms: listPublicRooms });

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

const joinFails = new Map(); // ip -> { count, since }

function checkJoinLimit(ws) {
  const entry = joinFails.get(ws.ip);
  const ipBlocked = entry && Date.now() - entry.since < 60000 && entry.count >= JOIN_FAILS_PER_IP;
  if (ws.joinFails >= JOIN_FAILS_PER_CONN || ipBlocked) {
    throw new GameError('Demasiados códigos equivocados. Espera un minuto e intenta otra vez.');
  }
}

function countJoinFail(ws) {
  ws.joinFails = (ws.joinFails || 0) + 1;
  if (ws.joinFails === JOIN_FAILS_PER_CONN) setTimeout(() => { ws.joinFails = 0; }, 60000).unref();
  const ip = ws.ip;
  const now = Date.now();
  const entry = joinFails.get(ip);
  if (!entry || now - entry.since >= 60000) joinFails.set(ip, { count: 1, since: now });
  else entry.count += 1;
  if (joinFails.size > 5000) {
    for (const [key, e] of joinFails) if (now - e.since >= 60000) joinFails.delete(key);
  }
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
  lobby.unwatch(ws);
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
        if (data.solo) {
          // Modo solo: sala cerrada con bots listos para jugar.
          room.locked = true;
          const count = Math.min(Math.max(Number.parseInt(data.bots, 10) || 3, 1), 5);
          for (let i = 0; i < count; i++) room.addBot(player.id, data.level || 'normal');
        }
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
      checkJoinLimit(ws);
      let room;
      try {
        room = getRoom(data.code);
      } catch (err) {
        countJoinFail(ws);
        throw err;
      }
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
    case 'lobbyWatch':
      if (!session) lobby.watch(ws);
      return;
    case 'lobbyUnwatch':
      lobby.unwatch(ws);
      return;
    case 'lobbySay':
      if (session) throw new GameError('El chat principal es desde la pantalla de inicio.');
      lobby.say(ws, data.name, data.text);
      return;
    case 'lobbyReport':
      lobby.report(ws, String(data.id || ''));
      send(ws, { type: 'notice', message: 'Gracias, recibimos tu reporte.' });
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
    case 'shareRoom': {
      const player = room.players.get(me);
      lobby.shareRoom(ws, room, player ? player.name : '');
      send(ws, { type: 'notice', message: '📣 Compartiste la sala en el chat principal.' });
      room.addSystemChat(`📣 ${player ? player.name : 'Alguien'} compartió la sala en el chat principal.`);
      return undefined;
    }
    case 'addBot':
      room.addBot(me, String(data.level || 'normal'));
      return undefined;
    case 'lock':
      return room.setLocked(me, data.locked);
    case 'ready':
      return room.setReady(me, Boolean(data.ready));
    case 'voiceJoin':
      return room.voiceJoin(me);
    case 'voiceLeave':
      return room.voiceLeave(me);
    case 'voiceMute':
      return room.voiceMute(me, data.muted);
    case 'rtc': {
      // Señalización WebRTC: solo pasamos el mensaje entre dos personas del chat de voz.
      const to = String(data.to || '');
      if (!room.inVoice(me) || !room.inVoice(to)) return undefined;
      const target = sockets.get(room.code)?.get(to);
      if (target) send(target, { type: 'rtc', from: me, signal: data.signal });
      return undefined;
    }
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

  wss.on('connection', (ws, req) => {
    // Detrás de Render/proxy la IP real viene en X-Forwarded-For.
    ws.ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
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

    ws.on('close', () => { lobby.unwatch(ws); onDisconnect(ws); });
    ws.on('error', () => { lobby.unwatch(ws); onDisconnect(ws); });
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
  // La lista de salas abiertas se refresca sola (cambian jugadores, rondas...).
  const roomsTicker = setInterval(() => lobby.refreshRooms(), 4000);
  wss.on('close', () => { clearInterval(heartbeat); clearInterval(roomsTicker); });

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
