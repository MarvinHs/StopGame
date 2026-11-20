'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Room, GameError } = require('../src/room');
const { normalizeAnswer, startsWithLetter } = require('../src/text');

const FAST = { countdownMs: 5, collectMs: 5, reconnectMs: 30 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeRoom(extra = {}) {
  return new Room('TEST', { timing: FAST, ...extra });
}

/** Lleva la sala hasta la fase de juego con una letra fija. */
async function playRound(room, hostId, letter) {
  room.pickLetter = () => letter;
  if (room.phase === 'lobby' || room.phase === 'final') room.start(hostId);
  await wait(15);
  assert.equal(room.phase, 'playing');
}

test('normaliza tildes, mayúsculas y signos pero conserva la ñ', () => {
  assert.equal(normalizeAnswer('  México!! '), 'mexico');
  assert.equal(normalizeAnswer('Ñame'), 'ñame');
  assert.equal(normalizeAnswer('San   Pedro de Macorís'), 'san pedro de macoris');
  assert.ok(startsWithLetter('ñame', 'Ñ'));
  assert.ok(!startsWithLetter('name', 'Ñ'));
  assert.ok(startsWithLetter('Ángel', 'A'));
});

test('no deja nombres repetidos ni vacíos', () => {
  const room = makeRoom();
  room.addPlayer('Marvin');
  assert.throws(() => room.addPlayer('marvin'), GameError);
  assert.throws(() => room.addPlayer('   '), GameError);
});

test('el primero es host y solo el host puede empezar', () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  const b = room.addPlayer('Beto');
  assert.equal(room.hostId, a.id);
  assert.throws(() => room.start(b.id), /Solo el host/);
});

test('STOP exige todas las casillas con la letra correcta', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  room.updateSettings(a.id, { categories: ['Nombre', 'Animal', 'Color'] });
  await playRound(room, a.id, 'P');
  assert.throws(() => room.stop(a.id, ['Pedro', '', 'Púrpura']), /Te falta: Animal/);
  assert.throws(() => room.stop(a.id, ['Pedro', 'Gato', 'Púrpura']), /Te falta: Animal/);
  room.stop(a.id, ['Pedro', 'Perro', 'Púrpura']);
  assert.equal(room.phase, 'collecting');
  assert.equal(room.stoppedBy, 'Ana');
});

test('puntúa 100 única, 50 repetida, 0 vacía o con otra letra (tildes no cuentan)', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  const b = room.addPlayer('Beto');
  const c = room.addPlayer('Carla');
  room.updateSettings(a.id, { categories: ['Nombre', 'País', 'Animal'] });
  await playRound(room, a.id, 'M');

  room.saveDraft(b.id, ['Miguel', 'méxico', 'Gato']);
  room.saveDraft(c.id, ['', 'MEXICO', 'Mono']);
  room.stop(a.id, ['María', 'México', 'Mapache']);
  await wait(15);
  assert.equal(room.phase, 'review');

  const { totals } = room.scoreReview();
  // Ana: María 100 + México 50 + Mapache 100
  assert.equal(totals[a.id], 250);
  // Beto: Miguel 100 + méxico 50 + Gato 0
  assert.equal(totals[b.id], 150);
  // Carla: vacía 0 + MEXICO 50 + Mono 100
  assert.equal(totals[c.id], 150);
});

test('la mayoría puede anular una respuesta y eso cambia las repetidas', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  const b = room.addPlayer('Beto');
  const c = room.addPlayer('Carla');
  room.updateSettings(a.id, { categories: ['Nombre', 'Animal', 'Cosa'] });
  await playRound(room, a.id, 'L');
  room.saveDraft(a.id, ['Luis', 'León', 'Lápiz']);
  room.saveDraft(b.id, ['Luis', 'Lagartija', 'Lata']);
  room.saveDraft(c.id, ['Lalala', 'Loro', 'Lupa']);
  room.endRound(null); // se acabó el tiempo
  await wait(15);

  assert.throws(() => room.vote(c.id, c.id, 0, true), /propia/);
  room.vote(a.id, c.id, 0, true); // "Lalala" no es un nombre
  assert.equal(room.scoreReview().totals[c.id], 300, 'un voto de dos no alcanza');
  room.vote(b.id, c.id, 0, true);
  assert.equal(room.scoreReview().totals[c.id], 200, 'dos de dos sí la anulan');

  // Si anulan uno de los "Luis", el otro pasa a ser único (100).
  room.vote(b.id, a.id, 0, true);
  room.vote(c.id, a.id, 0, true);
  const { totals } = room.scoreReview();
  assert.equal(totals[a.id], 200);
  assert.equal(totals[b.id], 300);

  room.confirmRound(a.id);
  assert.equal(room.players.get(b.id).score, 300);
});

test('si se acaba el tiempo la ronda termina sola y la siguiente vuelve a tener el tiempo completo', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  room.updateSettings(a.id, { roundTime: 20, rounds: 3 });
  room.settings.roundTime = 0.03; // 30 ms solo para la prueba
  await playRound(room, a.id, 'A');
  await wait(60);
  assert.equal(room.phase, 'review');
  room.confirmRound(a.id);
  assert.equal(room.phase, 'countdown');
  assert.equal(room.round, 2);
  await wait(10);
  assert.equal(room.phase, 'playing');
  assert.ok(room.endsAt - Date.now() > 10, 'la ronda 2 arranca con su tiempo completo');
});

test('no repite letras dentro de la misma partida', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  room.updateSettings(a.id, { letters: ['A', 'B', 'C'], rounds: 3 });
  room.start(a.id);
  const seen = [room.letter];
  for (let i = 0; i < 2; i++) {
    await wait(10);
    room.endRound(null);
    await wait(10);
    room.confirmRound(a.id);
    seen.push(room.letter);
  }
  assert.deepEqual([...seen].sort(), ['A', 'B', 'C']);
});

test('termina en la fase final después de la última ronda y se puede jugar otra vez', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  room.updateSettings(a.id, { rounds: 1, categories: ['Nombre', 'Animal', 'Cosa'] });
  await playRound(room, a.id, 'G');
  room.stop(a.id, ['Gabriel', 'Gato', 'Guitarra']);
  await wait(15);
  room.confirmRound(a.id);
  assert.equal(room.phase, 'final');
  assert.equal(room.players.get(a.id).score, 300);
  room.start(a.id);
  assert.equal(room.players.get(a.id).score, 0);
});

test('el host pasa a otro si se desconecta, y el jugador puede volver con su token', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  const b = room.addPlayer('Beto');
  room.setConnected(a.id, false);
  assert.equal(room.hostId, b.id);
  assert.equal(room.resume(a.id, 'token-falso'), null);
  assert.ok(room.resume(a.id, a.token));
  assert.ok(room.players.get(a.id).connected);
});

test('si no vuelve a tiempo se elimina, y la sala vacía se cierra', async () => {
  let emptied = false;
  const room = makeRoom({ onEmpty: () => { emptied = true; } });
  const a = room.addPlayer('Ana');
  room.setConnected(a.id, false);
  await wait(50);
  assert.equal(room.players.size, 0);
  assert.ok(emptied);
});

test('nadie ve las respuestas de los demás mientras se juega', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  const b = room.addPlayer('Beto');
  await playRound(room, a.id, 'S');
  room.saveDraft(a.id, ['Sofía']);
  const view = room.snapshot(b.id);
  assert.equal(view.review, null);
  assert.equal(view.yourDraft, null);
  assert.equal(view.players.find((p) => p.id === a.id).filled, 1);
  assert.ok(!JSON.stringify(view).includes('Sofía'));
  assert.ok(!JSON.stringify(view).includes(a.token), 'no se filtran los tokens');
});

test('la letra no se revela durante la cuenta regresiva', () => {
  const room = makeRoom({ timing: { ...FAST, countdownMs: 1000 } });
  const a = room.addPlayer('Ana');
  room.start(a.id);
  assert.equal(room.phase, 'countdown');
  assert.equal(room.snapshot(a.id).letter, null);
  room.close();
});

test('valida la configuración', () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  assert.throws(() => room.updateSettings(a.id, { categories: ['Uno', 'uno'] }), /por lo menos 3/);
  assert.throws(() => room.updateSettings(a.id, { letters: ['A'] }), /por lo menos 3/);
  room.updateSettings(a.id, { roundTime: 9999, rounds: -5 });
  assert.equal(room.settings.roundTime, 300);
  assert.equal(room.settings.rounds, 1);
});

test('quien entra a mitad de ronda no vota, y los desconectados no cuentan para la mayoría', async () => {
  const room = makeRoom({ timing: { ...FAST, reconnectMs: 10000 } });
  const a = room.addPlayer('Ana');
  const b = room.addPlayer('Beto');
  const c = room.addPlayer('Carla');
  room.updateSettings(a.id, { categories: ['Nombre', 'Animal', 'Cosa'] });
  await playRound(room, a.id, 'T');
  room.saveDraft(a.id, ['Tito', 'Toro', 'Taza']);
  room.endRound(null);
  await wait(15);
  const d = room.addPlayer('Dani');
  assert.throws(() => room.vote(d.id, a.id, 0, true), /mitad de ronda/);
  // Carla se desconecta: con Beto solo ya es mayoría de los conectados
  room.setConnected(c.id, false);
  room.vote(b.id, a.id, 0, true);
  assert.equal(room.scoreReview().totals[a.id], 200);
  room.close();
});

test('respuestas parecidas (plural, letra doble, error de una letra) cuentan como repetidas', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  const b = room.addPlayer('Beto');
  const c = room.addPlayer('Carla');
  room.updateSettings(a.id, { categories: ['Animal', 'Fruta', 'Nombre'] });
  await playRound(room, a.id, 'G');
  room.saveDraft(a.id, ['Gato', 'Guayaba', 'Gabriel']);
  room.saveDraft(b.id, ['Gatos', 'Guayava', 'Gabriela']);
  room.saveDraft(c.id, ['Gallo', 'Granada', 'Gustavo']);
  room.endRound(null);
  await wait(15);
  const { cells } = room.scoreReview();
  assert.deepEqual(cells.get(a.id).map((x) => x.points), [50, 50, 50]);
  assert.deepEqual(cells.get(b.id).map((x) => x.points), [50, 50, 50]);
  assert.deepEqual(cells.get(c.id).map((x) => x.points), [100, 100, 100]);
  assert.match(cells.get(b.id)[0].reason, /parecida a "Gato"/);
  room.close();
});

test('botón Listo: cuando todos están listos la ronda sigue sola', async () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  const b = room.addPlayer('Beto');
  room.updateSettings(a.id, { rounds: 2 });
  await playRound(room, a.id, 'R');
  room.endRound(null);
  await wait(15);
  room.setReady(a.id, true);
  assert.equal(room.phase, 'review');
  room.setReady(b.id, true);
  assert.equal(room.phase, 'countdown');
  assert.equal(room.round, 2);
  room.close();
});

test('la revisión avanza sola si nadie confirma (host dormido)', async () => {
  const room = makeRoom({ timing: { ...FAST, reviewMs: 30 } });
  const a = room.addPlayer('Ana');
  room.addPlayer('Beto');
  room.updateSettings(a.id, { rounds: 1 });
  await playRound(room, a.id, 'R');
  room.endRound(null);
  await wait(15);
  assert.equal(room.phase, 'review');
  await wait(50);
  assert.equal(room.phase, 'final');
  room.close();
});

test('sala cerrada: nadie nuevo entra, pero sí bots', () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  room.setLocked(a.id, true);
  assert.throws(() => room.addPlayer('Beto'), /cerrada/);
  room.addBot(a.id, 'facil');
  assert.equal(room.bots().length, 1);
  room.setLocked(a.id, false);
  room.addPlayer('Beto');
  room.close();
});

test('bots: escriben con la letra, dicen STOP en difícil y nunca son host', async () => {
  const room = makeRoom({ timing: { ...FAST, botStopDelayMs: 5, botSpeed: 0.005 } });
  const a = room.addPlayer('Ana');
  const bot = room.addBot(a.id, 'dificil');
  assert.ok(bot.isBot);
  assert.throws(() => room.makeHost(a.id, bot.id), /bot no puede/);
  room.updateSettings(a.id, { categories: ['Nombre', 'Animal', 'Color'], rounds: 1 });
  room.settings.roundTime = 0.5; // 500 ms
  // Forzamos que el bot sepa todo para que la prueba sea estable
  const original = Math.random;
  Math.random = () => 0.01;
  try {
    await playRound(room, a.id, 'M');
    for (let i = 0; i < 100 && room.phase === 'playing'; i++) await wait(10);
  } finally {
    Math.random = original;
  }
  assert.ok(['collecting', 'review'].includes(room.phase), `fase ${room.phase}`);
  assert.equal(room.stoppedBy, bot.name);
  await wait(15);
  const answers = room.review.answers.get(bot.id);
  assert.ok(answers.every((w) => startsWithLetter(w, 'M')), answers.join(','));
  // Ana sola revisa: al marcar Listo se termina (el bot ya está listo)
  room.setReady(a.id, true);
  assert.equal(room.phase, 'final');
  room.close();
});

test('si solo quedan bots la sala se cierra', () => {
  let emptied = false;
  const room = makeRoom({ onEmpty: () => { emptied = true; } });
  const a = room.addPlayer('Ana');
  room.addBot(a.id, 'normal');
  room.removePlayer(a.id);
  assert.ok(emptied);
});

test('chat de voz: máximo de personas y sin bots', () => {
  const room = makeRoom();
  const a = room.addPlayer('Ana');
  const bot = room.addBot(a.id, 'normal');
  room.voiceJoin(bot.id);
  assert.equal(room.voice.size, 0);
  room.voiceJoin(a.id);
  room.voiceMute(a.id, true);
  assert.deepEqual(room.snapshot(a.id).players.find((p) => p.id === a.id).voice, { muted: true });
  for (let i = 0; i < 7; i++) room.voiceJoin(room.addPlayer(`P${i}`).id);
  assert.throws(() => room.voiceJoin(room.addPlayer('Extra').id), /lleno/);
  room.setConnected(a.id, false);
  assert.ok(!room.inVoice(a.id));
  room.close();
});
