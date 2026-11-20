'use strict';

/**
 * Chat principal: la pantalla de inicio, donde la gente habla antes de entrar
 * a una sala y se comparten salas abiertas.
 *
 * Moderación básica (Google Play la exige en chats públicos):
 *  - límite de mensajes por persona, filtro de malas palabras y sin enlaces;
 *  - reportes: si 3 personas distintas reportan un mensaje, se borra y su autor
 *    queda sin poder escribir 15 minutos;
 *  - cada quien puede ocultar a otra persona en su pantalla (eso es del navegador).
 */

const crypto = require('crypto');
const { normalizeAnswer, cleanText } = require('./text');
const { GameError, LIMITS } = require('./room');

const LOBBY_LIMITS = {
  name: 20,
  text: 200,
  history: 80,
  minIntervalMs: 1500,
  burst: 5, // mensajes seguidos permitidos en 15 s
  burstWindowMs: 15000,
  reportsToHide: 3,
  muteMs: 15 * 60 * 1000,
  shareCooldownMs: 60 * 1000,
  publicRoomMs: 30 * 60 * 1000,
};

// Palabras fuertes que se tapan con asteriscos (se comparan sin tildes ni mayúsculas).
const BAD_WORDS = new Set([
  'mierda', 'puta', 'puto', 'putas', 'putos', 'hijueputa', 'hdp', 'pendejo', 'pendeja', 'pendejos',
  'cabron', 'cabrona', 'cabrones', 'maricon', 'maricones', 'mamaguevo', 'mamaguebo', 'mmg', 'singar',
  'singa', 'singando', 'singao', 'ripio', 'bimbin', 'culo', 'verga', 'chupamela', 'malparido',
  'gonorrea', 'zorra', 'idiota', 'estupido', 'estupida', 'imbecil',
]);
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|me|do|co|xyz|app|gg|ly|tk|ru)(?:\/\S*)?/gi;

/** Tapa malas palabras ("p***") y quita enlaces. Compara sin tildes: "estúpido" también cae. */
function moderate(text) {
  return String(text)
    .replace(LINK_RE, '[enlace quitado]')
    .replace(/[\p{L}\p{N}]+/gu, (word) => (BAD_WORDS.has(normalizeAnswer(word))
      ? word[0] + '*'.repeat(Math.max(2, word.length - 1))
      : word));
}

class Lobby {
  /**
   * @param {object} opts
   * @param {function} opts.send       (ws, data) => void
   * @param {function} opts.listRooms  () => [{ code, host, players, max, phase }]
   */
  constructor({ send, listRooms, now = Date.now }) {
    this.send = send;
    this.listRooms = listRooms;
    this.now = now;
    this.watchers = new Set(); // ws mirando el chat
    this.messages = []; // { id, at, name, text, kind, code?, ip }
    this.reports = new Map(); // msgId -> Set(ip)
    this.muted = new Map(); // ip -> hasta cuándo
    this.lastRoomsJson = '';
  }

  watch(ws) {
    this.watchers.add(ws);
    this.send(ws, { type: 'lobby', messages: this.messages.map(publicMsg), rooms: this.listRooms(), online: this.online() });
    this.broadcastOnline();
  }

  unwatch(ws) {
    if (this.watchers.delete(ws)) this.broadcastOnline();
  }

  online() {
    return this.watchers.size;
  }

  setName(ws, rawName) {
    const name = cleanText(rawName, LOBBY_LIMITS.name);
    if (!name) throw new GameError('Escribe tu nombre para hablar en el chat.');
    ws.lobbyName = moderate(name);
    return ws.lobbyName;
  }

  isMuted(ip) {
    const until = this.muted.get(ip);
    if (until && until > this.now()) return true;
    if (until) this.muted.delete(ip);
    return false;
  }

  /** Revisa que la persona pueda escribir ahora (límite de velocidad y silencio). */
  checkRate(ws) {
    if (this.isMuted(ws.ip)) throw new GameError('Te reportaron varias personas: no puedes escribir en el chat por un rato.');
    const now = this.now();
    ws.lobbyTimes = (ws.lobbyTimes || []).filter((t) => now - t < LOBBY_LIMITS.burstWindowMs);
    const last = ws.lobbyTimes[ws.lobbyTimes.length - 1] || 0;
    if (now - last < LOBBY_LIMITS.minIntervalMs || ws.lobbyTimes.length >= LOBBY_LIMITS.burst) {
      throw new GameError('Más despacio con el chat 😅');
    }
    ws.lobbyTimes.push(now);
  }

  say(ws, rawName, rawText) {
    const name = this.setName(ws, rawName);
    const text = moderate(cleanText(rawText, LOBBY_LIMITS.text));
    if (!text) return;
    this.checkRate(ws);
    this.push({ name, text, kind: 'msg', ip: ws.ip });
  }

  /** Publica una invitación a una sala (desde dentro de la sala). */
  shareRoom(ws, room, playerName) {
    if (room.locked) throw new GameError('La sala está cerrada 🔒. Ábrela para poder compartirla.');
    const now = this.now();
    if (room.sharedAt && now - room.sharedAt < LOBBY_LIMITS.shareCooldownMs) {
      throw new GameError('Esta sala ya se compartió hace poco. Espera un minuto.');
    }
    if (this.isMuted(ws.ip)) throw new GameError('No puedes compartir en el chat por un rato.');
    room.sharedAt = now;
    room.public = true;
    const humans = room.humans().length;
    this.push({
      name: moderate(cleanText(playerName, LOBBY_LIMITS.name)),
      text: `invita a jugar en la sala ${room.code} (${humans} ${humans === 1 ? 'persona' : 'personas'})`,
      kind: 'invite',
      code: room.code,
      ip: ws.ip,
    });
    this.refreshRooms(true);
  }

  report(ws, msgId) {
    const msg = this.messages.find((m) => m.id === msgId);
    if (!msg || msg.kind === 'system') return;
    if (msg.ip === ws.ip) throw new GameError('No puedes reportar tus propios mensajes.');
    if (!this.reports.has(msgId)) this.reports.set(msgId, new Set());
    const set = this.reports.get(msgId);
    set.add(ws.ip);
    console.warn(`[chat principal] reporte de ${ws.ip} a "${msg.name}": ${msg.text}`);
    if (set.size >= LOBBY_LIMITS.reportsToHide) {
      this.messages = this.messages.filter((m) => m.id !== msgId);
      this.reports.delete(msgId);
      this.muted.set(msg.ip, this.now() + LOBBY_LIMITS.muteMs);
      this.broadcast({ type: 'lobbyRemove', id: msgId });
    }
  }

  push(msg) {
    const full = { id: crypto.randomBytes(6).toString('hex'), at: this.now(), ...msg };
    this.messages.push(full);
    if (this.messages.length > LOBBY_LIMITS.history) {
      const gone = this.messages.splice(0, this.messages.length - LOBBY_LIMITS.history);
      for (const g of gone) this.reports.delete(g.id);
    }
    this.broadcast({ type: 'lobbyMessage', message: publicMsg(full) });
  }

  broadcast(data) {
    for (const ws of this.watchers) this.send(ws, data);
  }

  broadcastOnline() {
    this.broadcast({ type: 'lobbyOnline', online: this.online() });
  }

  /** Manda la lista de salas abiertas si cambió (se llama cada pocos segundos). */
  refreshRooms(force = false) {
    if (!this.watchers.size && !force) return;
    const rooms = this.listRooms();
    const json = JSON.stringify(rooms);
    if (!force && json === this.lastRoomsJson) return;
    this.lastRoomsJson = json;
    this.broadcast({ type: 'lobbyRooms', rooms });
  }
}

/** Lo que ve el navegador (sin la IP de nadie). */
function publicMsg(m) {
  return { id: m.id, at: m.at, name: m.name, text: m.text, kind: m.kind, code: m.code || null };
}

module.exports = { Lobby, moderate, LOBBY_LIMITS };
