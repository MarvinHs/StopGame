'use strict';

const crypto = require('crypto');
const { normalizeAnswer, startsWithLetter, cleanText, areSimilar } = require('./text');
const { wordsFor } = require('./words');

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
  maxBots: 7,
  maxVoice: 8,
  chat: 200,
  chatHistory: 60,
  chatIntervalMs: 600,
};

/** Cómo juega cada nivel de bot. */
// secs: segundos que tarda en pensar cada respuesta (como una persona).
const BOT_LEVELS = {
  facil: { label: 'Fácil', know: 0.6, secs: [8, 14], stop: 0 },
  normal: { label: 'Normal', know: 0.82, secs: [5, 9], stop: 0.6 },
  dificil: { label: 'Difícil', know: 0.95, secs: [3, 6], stop: 1 },
};
const BOT_NAMES = ['Yeyo', 'Chichí', 'Fello', 'Tatica', 'Cuqui', 'Pochi', 'Bebo', 'Nena', 'Pupi', 'Chelo', 'Manolo', 'Lula'];

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

const pick = (list) => list[crypto.randomInt(list.length)];
const between = (min, max) => min + Math.random() * (max - min);

class Room {
  /**
   * @param {string} code Código de la sala (ej. "KJXT").
   * @param {object} [opts]
   * @param {function} [opts.onChange] Se llama cuando el estado cambia (para enviarlo a todos).
   * @param {function} [opts.onEvent]  Eventos puntuales (STOP, expulsión) para sonidos/avisos.
   * @param {function} [opts.onEmpty]  La sala quedó sin personas.
   * @param {object}   [opts.timing]   Tiempos en ms (se acortan en las pruebas).
   */
  constructor(code, opts = {}) {
    this.code = code;
    this.timing = { countdownMs: 3000, collectMs: 1500, reconnectMs: 60000, reviewMs: 120000, botStopDelayMs: 1500, ...(opts.timing || {}) };
    this.onChange = opts.onChange || (() => {});
    this.onEvent = opts.onEvent || (() => {});
    this.onEmpty = opts.onEmpty || (() => {});
    this.now = opts.now || Date.now;

    this.players = new Map(); // id -> jugador (personas y bots)
    this.hostId = null;
    this.locked = false;
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
    this.review = null; // { answers: Map(pid -> []), votes: Map("pid:cat" -> Set), ready: Set }
    this.history = []; // [{ round, letter, stoppedBy, points: {pid: n} }]
    this.chat = [];
    this.voice = new Map(); // playerId -> { muted }
    this.timer = null;
    this.botTimers = [];
    this.closed = false;
  }

  // ───────────────────────── Jugadores ─────────────────────────

  humans() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  bots() {
    return [...this.players.values()].filter((p) => p.isBot);
  }

  addPlayer(rawName, { isBot = false, level = null, silent = false } = {}) {
    const name = cleanText(rawName, LIMITS.name);
    if (!name) throw new GameError('Escribe tu nombre.');
    if (!isBot && this.locked) throw new GameError('Esta sala está cerrada. Pídele al host que la abra.');
    if (this.players.size >= LIMITS.maxPlayers) throw new GameError(`La sala está llena (máximo ${LIMITS.maxPlayers}).`);
    const taken = [...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new GameError(`Ya hay alguien llamado "${name}" en la sala. Usa otro nombre.`);

    const player = {
      id: newId(),
      token: isBot ? null : crypto.randomBytes(16).toString('hex'),
      name,
      isBot,
      level,
      connected: true,
      score: 0,
      joinedAt: this.now(),
      lastChatAt: 0,
      removeTimer: null,
    };
    this.players.set(player.id, player);
    if (!isBot && (!this.hostId || !this.hostConnected())) this.hostId = player.id;
    if (!silent) this.addSystemChat(isBot ? `${name} (${BOT_LEVELS[level].label}) se unió.` : `${name} entró a la sala.`);
    this.changed();
    return player;
  }

  addBot(byId, level = 'normal') {
    this.requireHost(byId);
    if (this.phase !== 'lobby' && this.phase !== 'final') throw new GameError('Los bots se agregan antes de empezar.');
    if (!BOT_LEVELS[level]) throw new GameError('Nivel de bot inválido.');
    if (this.bots().length >= LIMITS.maxBots) throw new GameError(`Máximo ${LIMITS.maxBots} bots por sala.`);
    const used = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    const free = BOT_NAMES.map((n) => `🤖 ${n}`).filter((n) => !used.has(n.toLowerCase()));
    if (!free.length) throw new GameError('No quedan nombres de bots.');
    return this.addPlayer(pick(free), { isBot: true, level });
  }

  /** Reconectar con el id y el token que se le dieron al jugador al entrar. */
  resume(playerId, token) {
    const player = this.players.get(String(playerId));
    if (!player || player.isBot || !token || player.token !== String(token)) return null;
    this.setConnected(player.id, true);
    return player;
  }

  setConnected(playerId, connected) {
    const player = this.players.get(playerId);
    if (!player || player.isBot) return;
    player.connected = connected;
    clearTimeout(player.removeTimer);
    player.removeTimer = null;

    if (!connected) {
      this.voice.delete(playerId);
      // Le damos un rato para volver (recargar la página, perder la señal...).
      player.removeTimer = later(() => this.removePlayer(playerId, 'se desconectó'), this.timing.reconnectMs);
      if (this.hostId === playerId) this.passHost();
    } else if (!this.hostConnected()) {
      this.hostId = playerId;
    }
    this.changed();
    this.checkAllReady();
  }

  hostConnected() {
    const host = this.players.get(this.hostId);
    return Boolean(host && host.connected && !host.isBot);
  }

  passHost() {
    const next = this.humans().find((p) => p.connected && p.id !== this.hostId);
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
    this.voice.delete(playerId);
    this.addSystemChat(`${player.name} ${reason}.`);

    if (this.hostId === playerId) {
      const humans = this.humans();
      const next = humans.find((p) => p.connected) || humans[0];
      this.hostId = next ? next.id : null;
      if (next) this.addSystemChat(`${next.name} ahora es el host.`);
    }

    // Sin personas no hay partida (los bots solos no juegan).
    if (this.humans().length === 0) {
      this.close();
      this.onEmpty(this);
      return;
    }
    this.changed();
    this.checkAllReady();
  }

  kick(byId, targetId) {
    this.requireHost(byId);
    if (byId === targetId) throw new GameError('No te puedes sacar a ti mismo.');
    const target = this.players.get(targetId);
    if (!target) throw new GameError('Ese jugador ya no está.');
    if (!target.isBot) this.onEvent({ kind: 'kicked', playerId: targetId });
    this.removePlayer(targetId, target.isBot ? 'salió de la sala' : 'fue sacado por el host');
  }

  makeHost(byId, targetId) {
    this.requireHost(byId);
    const target = this.players.get(targetId);
    if (!target) throw new GameError('Ese jugador ya no está.');
    if (target.isBot) throw new GameError('Un bot no puede ser host.');
    this.hostId = targetId;
    this.addSystemChat(`${target.name} ahora es el host.`);
    this.changed();
  }

  setLocked(byId, locked) {
    this.requireHost(byId);
    this.locked = Boolean(locked);
    this.addSystemChat(this.locked ? '🔒 El host cerró la sala: nadie más puede entrar.' : '🔓 La sala está abierta otra vez.');
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
    const letter = pick(pool);
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
    for (const bot of this.bots()) this.scheduleBot(bot, ms);
    this.changed();
  }

  /** El bot "escribe" sus respuestas poco a poco y, según su nivel, puede decir STOP. */
  scheduleBot(bot, roundMs) {
    const level = BOT_LEVELS[bot.level] || BOT_LEVELS.normal;
    const cats = this.settings.categories;
    const answers = cats.map(() => '');
    this.drafts.set(bot.id, [...answers]);

    // Va llenando en orden aleatorio, una casilla tras otra.
    const order = cats.map((_, i) => i).sort(() => Math.random() - 0.5);
    const speed = this.timing.botSpeed ?? 1; // en las pruebas se acelera
    let at = 0;
    for (const i of order) {
      const options = wordsFor(cats[i], this.letter);
      const knows = options.length && Math.random() <= level.know;
      // Si no se la sabe, igual pierde un ratico pensando.
      at += between(level.secs[0], level.secs[1]) * 1000 * speed * (knows ? 1 : 0.5);
      if (!knows || at >= roundMs) continue;
      this.botTimers.push(later(() => {
        if (this.phase !== 'playing') return;
        // Evita poner lo mismo que otro bot si hay otra opción.
        const taken = new Set(this.bots().filter((b) => b.id !== bot.id).map((b) => normalizeAnswer((this.drafts.get(b.id) || [])[i])));
        const fresh = options.filter((o) => !taken.has(normalizeAnswer(o)));
        answers[i] = pick(fresh.length ? fresh : options);
        this.saveDraft(bot.id, [...answers]);
      }, at));
    }
    const lastAt = at;

    const wantsStop = Math.random() < level.stop;
    this.botTimers.push(later(() => {
      if (this.phase !== 'playing' || !wantsStop || !this.players.has(bot.id)) return;
      const full = answers.every((a) => startsWithLetter(a, this.letter));
      if (full) this.endRound(bot.id);
    }, lastAt + this.timing.botStopDelayMs));
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
    return answers.filter((a) => startsWithLetter(a, this.letter)).length;
  }

  stop(playerId, answers) {
    if (this.phase !== 'playing') throw new GameError('No hay una ronda en juego.');
    if (!this.players.has(playerId)) return;
    const clean = this.sanitizeAnswers(answers);
    this.drafts.set(playerId, clean);
    const missing = this.settings.categories.filter((_, i) => !startsWithLetter(clean[i], this.letter));
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
    // Los bots no revisan: siempre están "listos".
    this.review = { answers, votes: new Map(), ready: new Set(this.bots().map((b) => b.id)) };
    this.phase = 'review';
    this.endsAt = this.now() + this.timing.reviewMs;
    // Si nadie confirma, la ronda sigue sola para que el juego nunca se trabe.
    this.timer = later(() => {
      this.addSystemChat('⏱️ Se acabó el tiempo de revisión.');
      this.finishReview();
    }, this.timing.reviewMs);
    this.changed();
  }

  /** Personas que jugaron la ronda en revisión y siguen en la sala. */
  reviewParticipants() {
    if (!this.review) return [];
    return [...this.review.answers.keys()].filter((id) => this.players.has(id));
  }

  /** Votar que una respuesta "no vale" (o quitar el voto). */
  vote(voterId, targetId, catIndex, reject) {
    if (this.phase !== 'review' || !this.review) throw new GameError('Ahora no se está revisando.');
    if (!this.players.has(voterId)) return;
    if (!this.review.answers.has(voterId)) throw new GameError('Entraste a mitad de ronda: podrás votar desde la próxima.');
    if (voterId === targetId) throw new GameError('No puedes votar tu propia respuesta.');
    const answers = this.review.answers.get(targetId);
    const i = Number(catIndex);
    if (!answers || !Number.isInteger(i) || i < 0 || i >= answers.length) throw new GameError('Respuesta inválida.');
    if (!startsWithLetter(answers[i], this.letter)) return; // ya vale 0 sola

    const key = `${targetId}:${i}`;
    if (!this.review.votes.has(key)) this.review.votes.set(key, new Set());
    const set = this.review.votes.get(key);
    if (reject) set.add(voterId);
    else set.delete(voterId);
    this.changed();
  }

  /** Marcar "Listo" en la revisión. Cuando todas las personas están listas, se sigue. */
  setReady(playerId, ready) {
    if (this.phase !== 'review' || !this.review) return;
    if (!this.review.answers.has(playerId)) throw new GameError('Entraste a mitad de ronda: espera la próxima.');
    if (ready) this.review.ready.add(playerId);
    else this.review.ready.delete(playerId);
    this.changed();
    this.checkAllReady();
  }

  checkAllReady() {
    if (this.phase !== 'review' || !this.review) return;
    const waiting = this.reviewParticipants().filter((id) => {
      const p = this.players.get(id);
      return p.connected && !p.isBot && !this.review.ready.has(id);
    });
    const humansInRound = this.reviewParticipants().filter((id) => !this.players.get(id).isBot);
    if (humansInRound.length && waiting.length === 0) this.finishReview();
  }

  /** Calcula los puntos de la ronda en revisión. */
  scoreReview() {
    if (!this.review) return null;
    const { answers, votes } = this.review;
    const ids = this.reviewParticipants();
    const cats = this.settings.categories;
    const cells = new Map(ids.map((id) => [id, []]));

    cats.forEach((_, c) => {
      const info = ids.map((id) => {
        const text = answers.get(id)[c] || '';
        const norm = normalizeAnswer(text);
        const autoValid = startsWithLetter(norm, this.letter);
        // Solo cuentan los votos de quienes jugaron la ronda y siguen en la sala.
        const voters = [...(votes.get(`${id}:${c}`) || [])].filter((v) => ids.includes(v));
        // Votantes posibles: personas que jugaron, están conectadas y no son el dueño de la respuesta.
        const eligible = ids.filter((v) => {
          const p = this.players.get(v);
          return v !== id && p.connected && !p.isBot;
        }).length;
        const rejected = autoValid && eligible > 0 && voters.length * 2 > eligible;
        return { id, text, norm, autoValid, valid: autoValid && !rejected, voters, rejected };
      });

      for (const a of info) {
        let points = 0;
        let reason = '';
        if (a.valid) {
          const same = info.filter((o) => o !== a && o.valid && o.norm === a.norm);
          const similar = info.filter((o) => o !== a && o.valid && o.norm !== a.norm && areSimilar(o.norm, a.norm));
          points = same.length || similar.length ? POINTS_REPEATED : POINTS_UNIQUE;
          if (same.length) reason = 'repetida';
          else if (similar.length) reason = `parecida a "${similar[0].text}"`;
        } else if (!a.text) reason = 'vacía';
        else if (!a.autoValid) reason = `no empieza con ${this.letter}`;
        else reason = 'no vale (votación)';
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
    this.finishReview();
  }

  finishReview() {
    if (this.phase !== 'review') return;
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

  // ───────────────────────── Chat de voz ─────────────────────────

  voiceJoin(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.isBot) return;
    if (!this.voice.has(playerId) && this.voice.size >= LIMITS.maxVoice) {
      throw new GameError(`El chat de voz está lleno (máximo ${LIMITS.maxVoice} personas).`);
    }
    this.voice.set(playerId, { muted: false });
    this.changed();
  }

  voiceLeave(playerId) {
    if (this.voice.delete(playerId)) this.changed();
  }

  voiceMute(playerId, muted) {
    const v = this.voice.get(playerId);
    if (!v) return;
    v.muted = Boolean(muted);
    this.changed();
  }

  inVoice(playerId) {
    return this.voice.has(playerId);
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
      locked: this.locked,
      round: this.round,
      letter: showLetter ? this.letter : null,
      endsAt: this.endsAt,
      serverNow: this.now(),
      stoppedBy: this.stoppedBy,
      settings: this.settings,
      allLetters: ALL_LETTERS,
      limits: LIMITS,
      botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([k, v]) => [k, v.label])),
      players: this.ranking().map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        level: p.isBot ? BOT_LEVELS[p.level].label : null,
        connected: p.connected,
        score: p.score,
        filled: this.phase === 'playing' ? this.filledCount(this.drafts.get(p.id)) : null,
        ready: this.review ? this.review.ready.has(p.id) : null,
        voice: this.voice.has(p.id) ? { muted: this.voice.get(p.id).muted } : null,
      })),
      yourDraft: this.phase === 'playing' || this.phase === 'collecting' ? this.drafts.get(forId) || null : null,
      review: scored
        ? {
            inRound: this.review.answers.has(forId),
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
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers = [];
  }

  close() {
    this.closed = true;
    this.clearTimer();
    for (const p of this.players.values()) clearTimeout(p.removeTimer);
  }
}

module.exports = {
  Room, GameError, DEFAULT_CATEGORIES, ALL_LETTERS, LIMITS, PHASES, POINTS_UNIQUE, POINTS_REPEATED, BOT_LEVELS,
};
