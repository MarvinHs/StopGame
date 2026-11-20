'use strict';

const crypto = require('crypto');
const { normalizeAnswer, startsWithLetter, cleanText } = require('./text');

const DEFAULT_CATEGORIES = ['Nombre', 'Apellido', 'Ciudad o País', 'Animal', 'Fruta o Comida', 'Color', 'Cosa'];
const ALL_LETTERS = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('');
const DEFAULT_EXCLUDED = ['K', 'Ñ', 'Q', 'W', 'X', 'Y', 'Z'];

const POINTS_UNIQUE = 100;
const POINTS_REPEATED = 50;

const LIMITS = {
  name: 20,
  answer: 40,
  category: 24,
  minCategories: 3,
  maxCategories: 12,
  minRoundTime: 20,
  maxRoundTime: 300,
  minRounds: 1,
  maxRounds: 20,
  minLetters: 3,
  maxPlayers: 15,
  chat: 200,
  chatHistory: 60,
  chatIntervalMs: 600,
};

const PHASES = ['lobby', 'countdown', 'playing', 'collecting', 'review', 'final'];

/** Error que se le muestra tal cual al jugador. */
class GameError extends Error {}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

/** Temporizador que no impide que Node se cierre (útil en pruebas). */
function later(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t.unref) t.unref();
  return t;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

class Room {
  /**
   * @param {string} code Código de la sala (ej. "KJXT").
   * @param {object} [opts]
   * @param {function} [opts.onChange] Se llama cuando el estado cambia (para enviarlo a todos).
   * @param {function} [opts.onEvent]  Eventos puntuales (STOP, expulsión) para sonidos/avisos.
   * @param {function} [opts.onEmpty]  La sala quedó sin jugadores.
   * @param {object}   [opts.timing]   Tiempos en ms (se acortan en las pruebas).
   */
  constructor(code, opts = {}) {
    this.code = code;
    this.timing = { countdownMs: 3000, collectMs: 1500, reconnectMs: 60000, ...(opts.timing || {}) };
    this.onChange = opts.onChange || (() => {});
    this.onEvent = opts.onEvent || (() => {});
    this.onEmpty = opts.onEmpty || (() => {});
    this.now = opts.now || Date.now;

    this.players = new Map(); // id -> jugador
    this.hostId = null;
    this.settings = {
      categories: [...DEFAULT_CATEGORIES],
      roundTime: 90,
      rounds: 5,
      letters: ALL_LETTERS.filter((l) => !DEFAULT_EXCLUDED.includes(l)),
    };

    this.phase = 'lobby';
    this.round = 0;
    this.letter = null;
    this.usedLetters = [];
    this.endsAt = null;
    this.stoppedBy = null;
    this.drafts = new Map(); // playerId -> [respuestas]
    this.review = null; // { answers: Map(pid -> []), votes: Map("pid:cat" -> Set(voterId)), participants: [pid] }
    this.history = []; // [{ round, letter, stoppedBy, points: {pid: n} }]
    this.chat = [];
    this.timer = null;
    this.closed = false;
  }

  // ───────────────────────── Jugadores ─────────────────────────

  addPlayer(rawName) {
    const name = cleanText(rawName, LIMITS.name);
    if (!name) throw new GameError('Escribe tu nombre.');
    if (this.players.size >= LIMITS.maxPlayers) throw new GameError(`La sala está llena (máximo ${LIMITS.maxPlayers}).`);
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new GameError(`Ya hay alguien llamado "${name}" en la sala. Usa otro nombre.`);

    const player = {
      id: newId(),
      token: crypto.randomBytes(16).toString('hex'),
      name,
      connected: true,
      score: 0,
      joinedAt: this.now(),
      lastChatAt: 0,
      removeTimer: null,
    };
    this.players.set(player.id, player);
    if (!this.hostId || !this.hostConnected()) this.hostId = player.id;
    this.addSystemChat(`${name} entró a la sala.`);
    this.changed();
    return player;
  }

  /** Reconectar con el id y el token que se le dieron al jugador al entrar. */
  resume(playerId, token) {
    const player = this.players.get(String(playerId));
    if (!player || !token || player.token !== String(token)) return null;
    this.setConnected(player.id, true);
    return player;
  }

  setConnected(playerId, connected) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = connected;
    clearTimeout(player.removeTimer);
    player.removeTimer = null;

    if (!connected) {
      // Le damos un rato para volver (recargar la página, perder la señal...).
      player.removeTimer = later(() => this.removePlayer(playerId, 'se desconectó'), this.timing.reconnectMs);
      if (this.hostId === playerId) this.passHost();
    } else if (!this.hostConnected()) {
      this.hostId = playerId;
    }
    this.changed();
  }

  hostConnected() {
    const host = this.players.get(this.hostId);
    return Boolean(host && host.connected);
  }

  passHost() {
    const next = [...this.players.values()].find((p) => p.connected && p.id !== this.hostId);
    if (next) {
      this.hostId = next.id;
      this.addSystemChat(`${next.name} ahora es el host.`);
    }
  }

  removePlayer(playerId, reason = 'salió') {
    const player = this.players.get(playerId);
    if (!player) return;
    clearTimeout(player.removeTimer);
    this.players.delete(playerId);
    this.drafts.delete(playerId);
    this.addSystemChat(`${player.name} ${reason}.`);

    if (this.hostId === playerId) {
      const next = [...this.players.values()].find((p) => p.connected) || [...this.players.values()][0];
      this.hostId = next ? next.id : null;
      if (next) this.addSystemChat(`${next.name} ahora es el host.`);
    }

    if (this.players.size === 0) {
      this.close();
      this.onEmpty(this);
      return;
    }
    this.changed();
  }

  kick(byId, targetId) {
    this.requireHost(byId);
    if (byId === targetId) throw new GameError('No te puedes sacar a ti mismo.');
    if (!this.players.has(targetId)) throw new GameError('Ese jugador ya no está.');
    this.onEvent({ kind: 'kicked', playerId: targetId });
    this.removePlayer(targetId, 'fue sacado por el host');
  }

  makeHost(byId, targetId) {
    this.requireHost(byId);
    const target = this.players.get(targetId);
    if (!target) throw new GameError('Ese jugador ya no está.');
    this.hostId = targetId;
    this.addSystemChat(`${target.name} ahora es el host.`);
    this.changed();
  }

  requireHost(playerId) {
    if (playerId !== this.hostId) throw new GameError('Solo el host puede hacer eso.');
  }

  // ───────────────────────── Configuración ─────────────────────────

  updateSettings(byId, input = {}) {
    this.requireHost(byId);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('La configuración solo se cambia antes de empezar.');

    const s = { ...this.settings };
    if (input.roundTime !== undefined) s.roundTime = clampInt(input.roundTime, LIMITS.minRoundTime, LIMITS.maxRoundTime, s.roundTime);
    if (input.rounds !== undefined) s.rounds = clampInt(input.rounds, LIMITS.minRounds, LIMITS.maxRounds, s.rounds);

    if (input.categories !== undefined) {
      if (!Array.isArray(input.categories)) throw new GameError('Categorías inválidas.');
      const seen = new Set();
      const cats = [];
      for (const raw of input.categories) {
        const c = cleanText(raw, LIMITS.category);
        const key = normalizeAnswer(c);
        if (c && key && !seen.has(key)) {
          seen.add(key);
          cats.push(c);
        }
      }
      if (cats.length < LIMITS.minCategories) throw new GameError(`Pon por lo menos ${LIMITS.minCategories} categorías.`);
      s.categories = cats.slice(0, LIMITS.maxCategories);
    }

    if (input.letters !== undefined) {
      if (!Array.isArray(input.letters)) throw new GameError('Letras inválidas.');
      const letters = ALL_LETTERS.filter((l) => input.letters.includes(l));
      if (letters.length < LIMITS.minLetters) throw new GameError(`Deja por lo menos ${LIMITS.minLetters} letras activas.`);
      s.letters = letters;
    }

    this.settings = s;
    this.changed();
  }

  // ───────────────────────── Flujo de la partida ─────────────────────────

  start(byId) {
    this.requireHost(byId);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('La partida ya empezó.');
    for (const p of this.players.values()) p.score = 0;
    this.history = [];
    this.usedLetters = [];
    this.round = 0;
    this.addSystemChat('¡Empezó la partida!');
    this.beginCountdown();
  }

  backToLobby(byId) {
    this.requireHost(byId);
    this.clearTimer();
    this.phase = 'lobby';
    this.round = 0;
    this.letter = null;
    this.endsAt = null;
    this.review = null;
    this.stoppedBy = null;
    this.changed();
  }

  pickLetter() {
    let pool = this.settings.letters.filter((l) => !this.usedLetters.includes(l));
    if (pool.length === 0) {
      this.usedLetters = [];
      pool = [...this.settings.letters];
    }
    const letter = pool[crypto.randomInt(pool.length)];
    this.usedLetters.push(letter);
    return letter;
  }

  beginCountdown() {
    this.clearTimer();
    this.round += 1;
    this.letter = this.pickLetter();
    this.phase = 'countdown';
    this.review = null;
    this.stoppedBy = null;
    this.drafts = new Map();
    this.endsAt = this.now() + this.timing.countdownMs;
    this.timer = later(() => this.startPlaying(), this.timing.countdownMs);
    this.changed();
  }

  startPlaying() {
    this.clearTimer();
    this.phase = 'playing';
    const ms = this.settings.roundTime * 1000;
    this.endsAt = this.now() + ms;
    this.timer = later(() => this.endRound(null), ms);
    this.changed();
  }

  sanitizeAnswers(answers) {
    const list = Array.isArray(answers) ? answers : [];
    return this.settings.categories.map((_, i) => cleanText(list[i], LIMITS.answer));
  }

  /** El navegador manda lo que va escribiendo; así nunca se pierde una respuesta. */
  saveDraft(playerId, answers) {
    if (!this.players.has(playerId)) return;
    if (this.phase !== 'playing' && this.phase !== 'collecting') return;
    const clean = this.sanitizeAnswers(answers);
    const before = this.drafts.get(playerId);
    this.drafts.set(playerId, clean);
    // Solo avisamos a todos si cambió cuántas casillas tiene llenas (barra de progreso).
    if (this.phase === 'playing' && this.filledCount(before) !== this.filledCount(clean)) this.changed();
  }

  filledCount(answers) {
    if (!answers) return 0;
    return answers.filter((a) => startsWithLetter(normalizeAnswer(a), this.letter)).length;
  }

  stop(playerId, answers) {
    if (this.phase !== 'playing') throw new GameError('No hay una ronda en juego.');
    const player = this.players.get(playerId);
    if (!player) return;
    const clean = this.sanitizeAnswers(answers);
    this.drafts.set(playerId, clean);
    const missing = this.settings.categories.filter((_, i) => !startsWithLetter(normalizeAnswer(clean[i]), this.letter));
    if (missing.length) {
      throw new GameError(`Para decir STOP tienes que llenar todo con la ${this.letter}. Te falta: ${missing.join(', ')}.`);
    }
    this.endRound(playerId);
  }

  endRound(stoppedById) {
    if (this.phase !== 'playing') return;
    this.clearTimer();
    const by = stoppedById ? this.players.get(stoppedById) : null;
    this.stoppedBy = by ? by.name : null;
    this.phase = 'collecting';
    this.endsAt = this.now() + this.timing.collectMs;
    this.onEvent({ kind: 'stop', by: this.stoppedBy });
    this.addSystemChat(by ? `🛑 ¡STOP! Lo dijo ${by.name}.` : '⏰ Se acabó el tiempo.');
    // Damos un momento para recibir lo último que cada quien escribió.
    this.timer = later(() => this.startReview(), this.timing.collectMs);
    this.changed();
  }

  startReview() {
    this.clearTimer();
    const answers = new Map();
    for (const p of this.players.values()) {
      answers.set(p.id, this.drafts.get(p.id) || this.sanitizeAnswers([]));
    }
    this.review = { answers, votes: new Map() };
    this.phase = 'review';
    this.endsAt = null;
    this.changed();
  }

  /** Votar que una respuesta "no vale" (o quitar el voto). */
  vote(voterId, targetId, catIndex, reject) {
    if (this.phase !== 'review' || !this.review) throw new GameError('Ahora no se está revisando.');
    if (!this.players.has(voterId)) return;
    if (voterId === targetId) throw new GameError('No puedes votar tu propia respuesta.');
    const answers = this.review.answers.get(targetId);
    const i = Number(catIndex);
    if (!answers || !Number.isInteger(i) || i < 0 || i >= answers.length) throw new GameError('Respuesta inválida.');
    if (!startsWithLetter(normalizeAnswer(answers[i]), this.letter)) return; // ya vale 0 sola

    const key = `${targetId}:${i}`;
    if (!this.review.votes.has(key)) this.review.votes.set(key, new Set());
    const set = this.review.votes.get(key);
    if (reject) set.add(voterId);
    else set.delete(voterId);
    this.changed();
  }

  /** Calcula los puntos de la ronda en revisión. */
  scoreReview() {
    if (!this.review) return null;
    const { answers, votes } = this.review;
    const ids = [...answers.keys()].filter((id) => this.players.has(id));
    const cats = this.settings.categories;
    const cells = new Map(ids.map((id) => [id, []]));

    cats.forEach((_, c) => {
      const info = ids.map((id) => {
        const text = answers.get(id)[c] || '';
        const norm = normalizeAnswer(text);
        const autoValid = startsWithLetter(norm, this.letter);
        const voters = [...(votes.get(`${id}:${c}`) || [])].filter((v) => this.players.has(v));
        const eligible = ids.length - 1; // todos menos el dueño de la respuesta
        const rejected = autoValid && eligible > 0 && voters.length * 2 > eligible;
        return { id, text, norm, autoValid, valid: autoValid && !rejected, voters, rejected };
      });

      const counts = new Map();
      for (const a of info) if (a.valid) counts.set(a.norm, (counts.get(a.norm) || 0) + 1);

      for (const a of info) {
        let points = 0;
        if (a.valid) points = counts.get(a.norm) === 1 ? POINTS_UNIQUE : POINTS_REPEATED;
        let reason = '';
        if (!a.text) reason = 'vacía';
        else if (!a.autoValid) reason = `no empieza con ${this.letter}`;
        else if (a.rejected) reason = 'no vale (votación)';
        else if (points === POINTS_REPEATED) reason = 'repetida';
        cells.get(a.id).push({ text: a.text, points, valid: a.valid, votable: a.autoValid, reason, voters: a.voters });
      }
    });

    const totals = {};
    for (const [id, list] of cells) totals[id] = list.reduce((sum, x) => sum + x.points, 0);
    return { cells, totals };
  }

  confirmRound(byId) {
    this.requireHost(byId);
    if (this.phase !== 'review') throw new GameError('No hay ronda para confirmar.');
    const result = this.scoreReview();
    for (const [id, pts] of Object.entries(result.totals)) {
      const p = this.players.get(id);
      if (p) p.score += pts;
    }
    this.history.push({ round: this.round, letter: this.letter, stoppedBy: this.stoppedBy, points: result.totals });

    if (this.round >= this.settings.rounds) {
      this.clearTimer();
      this.phase = 'final';
      this.review = null;
      this.endsAt = null;
      const winner = this.ranking()[0];
      if (winner) this.addSystemChat(`🏆 ¡${winner.name} ganó con ${winner.score} puntos!`);
      this.changed();
    } else {
      this.beginCountdown();
    }
  }

  ranking() {
    return [...this.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  }

  // ───────────────────────── Chat ─────────────────────────

  sendChat(playerId, rawText) {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = cleanText(rawText, LIMITS.chat);
    if (!text) return;
    const now = this.now();
    if (now - player.lastChatAt < LIMITS.chatIntervalMs) throw new GameError('Más despacio con el chat 😅');
    player.lastChatAt = now;
    this.pushChat({ from: player.name, text });
  }

  addSystemChat(text) {
    this.pushChat({ from: null, text });
  }

  pushChat(msg) {
    this.chat.push({ id: newId(), at: this.now(), ...msg });
    if (this.chat.length > LIMITS.chatHistory) this.chat.splice(0, this.chat.length - LIMITS.chatHistory);
    this.changed();
  }

  // ───────────────────────── Estado para el navegador ─────────────────────────

  /** Lo que ve cada jugador. Durante la ronda nadie ve las respuestas de los demás. */
  snapshot(forId) {
    const scored = this.phase === 'review' ? this.scoreReview() : null;
    const showLetter = this.phase !== 'lobby' && this.phase !== 'countdown';

    return {
      code: this.code,
      phase: this.phase,
      you: forId,
      hostId: this.hostId,
      round: this.round,
      letter: showLetter ? this.letter : null,
      endsAt: this.endsAt,
      serverNow: this.now(),
      stoppedBy: this.stoppedBy,
      settings: this.settings,
      allLetters: ALL_LETTERS,
      limits: LIMITS,
      players: this.ranking().map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        score: p.score,
        filled: this.phase === 'playing' ? this.filledCount(this.drafts.get(p.id)) : null,
      })),
      yourDraft: this.phase === 'playing' || this.phase === 'collecting' ? this.drafts.get(forId) || null : null,
      review: scored
        ? {
            rows: [...scored.cells.entries()].map(([playerId, cells]) => ({
              playerId,
              total: scored.totals[playerId],
              cells: cells.map((cell) => ({
                text: cell.text,
                points: cell.points,
                valid: cell.valid,
                votable: cell.votable,
                reason: cell.reason,
                rejectVotes: cell.voters.length,
                youRejected: cell.voters.includes(forId),
              })),
            })),
          }
        : null,
      history: this.history,
      chat: this.chat,
    };
  }

  // ───────────────────────── Utilidades ─────────────────────────

  changed() {
    if (!this.closed) this.onChange(this);
  }

  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  close() {
    this.closed = true;
    this.clearTimer();
    for (const p of this.players.values()) clearTimeout(p.removeTimer);
  }
}

module.exports = { Room, GameError, DEFAULT_CATEGORIES, ALL_LETTERS, LIMITS, PHASES, POINTS_UNIQUE, POINTS_REPEATED };
