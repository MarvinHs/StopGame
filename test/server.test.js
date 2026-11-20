'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');
const { start } = require('../server');

/** Un jugador de mentira que se conecta por WebSocket como el navegador. */
class Bot {
  constructor(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.messages = [];
    this.waiters = [];
    this.state = null;
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'state') this.state = msg.state;
      if (msg.type === 'joined') this.joined = msg;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => !w(msg));
    });
    this.ready = new Promise((r) => this.ws.once('open', r));
  }

  send(data) {
    this.ws.send(JSON.stringify(data));
  }

  /** Espera un mensaje que cumpla la condición (revisa también los que ya llegaron). */
  waitFor(check, label = 'mensaje', ms = 4000) {
    const found = this.messages.find(check);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Tiempo agotado esperando ${label}`)), ms);
      this.waiters.push((msg) => {
        if (!check(msg)) return false;
        clearTimeout(timer);
        resolve(msg);
        return true;
      });
    });
  }

  waitPhase(phase) {
    this.messages = this.messages.filter((m) => !(m.type === 'state' && m.state.phase !== phase));
    return this.waitFor((m) => m.type === 'state' && m.state.phase === phase, `fase ${phase}`);
  }

  close() {
    this.ws.close();
  }
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

test('servidor completo: página, sala, ronda con STOP, votos y final', async (t) => {
  const { server, wss, port } = await start(0, { timing: { countdownMs: 50, collectMs: 50, reconnectMs: 200 } });
  t.after(() => { for (const c of wss.clients) c.terminate(); wss.close(); server.close(); });

  // Sirve la página y bloquea rutas fuera de public/
  const page = await get(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /STOP/);
  assert.equal((await get(port, '/..%2fserver.js')).status, 403);
  assert.equal((await get(port, '/healthz')).status, 200);

  const ana = new Bot(port);
  const beto = new Bot(port);
  await Promise.all([ana.ready, beto.ready]);

  ana.send({ type: 'create', name: 'Ana' });
  const { code } = await ana.waitFor((m) => m.type === 'joined', 'joined');
  assert.match(code, /^[A-Z]{4}$/);

  beto.send({ type: 'join', name: 'Ana', code });
  const dup = await beto.waitFor((m) => m.type === 'error', 'error de nombre');
  assert.match(dup.message, /Ya hay alguien/);

  beto.send({ type: 'join', name: '<b onclick=x>B</b>', code });
  await beto.waitFor((m) => m.type === 'joined', 'joined beto');

  // Beto no es host: no puede empezar
  beto.send({ type: 'start' });
  assert.match((await beto.waitFor((m) => m.type === 'error' && /host/.test(m.message))).message, /Solo el host/);

  ana.send({ type: 'settings', settings: { categories: ['Nombre', 'Animal', 'Cosa'], rounds: 1, letters: ['M', 'P', 'S'] } });
  await ana.waitFor((m) => m.type === 'state' && m.state.settings.rounds === 1, 'settings');

  ana.send({ type: 'start' });
  const playing = await ana.waitPhase('playing');
  const L = playing.state.letter;
  assert.ok(['M', 'P', 'S'].includes(L));
  await beto.waitPhase('playing');

  const words = { M: ['María', 'Mono', 'Mesa'], P: ['Pedro', 'Perro', 'Pala'], S: ['Sofía', 'Sapo', 'Silla'] }[L];

  // Beto escribe dos respuestas (una repetida con Ana) y deja una vacía
  beto.send({ type: 'draft', answers: [words[0], words[1], ''] });
  // STOP con casillas vacías se rechaza
  ana.send({ type: 'stop', answers: [words[0], '', ''] });
  await ana.waitFor((m) => m.type === 'error' && /STOP/.test(m.message), 'error de STOP');

  ana.send({ type: 'stop', answers: [words[0], `${words[1]}s`, words[2]] });
  const stopEvent = await beto.waitFor((m) => m.type === 'event' && m.event.kind === 'stop', 'evento STOP');
  assert.equal(stopEvent.event.by, 'Ana');

  const review = await beto.waitPhase('review');
  const rows = review.state.review.rows;
  const anaId = ana.joined.playerId;
  const betoId = beto.joined.playerId;
  const anaRow = rows.find((r) => r.playerId === anaId);
  const betoRow = rows.find((r) => r.playerId === betoId);
  assert.deepEqual(anaRow.cells.map((c) => c.points), [50, 100, 100]);
  assert.deepEqual(betoRow.cells.map((c) => c.points), [50, 100, 0]);

  // Beto vota que la "cosa" de Ana no vale (con 2 jugadores, 1 voto basta)
  beto.send({ type: 'vote', playerId: anaId, category: 2, reject: true });
  const voted = await ana.waitFor((m) => m.type === 'state' && m.state.review
    && m.state.review.rows.find((r) => r.playerId === anaId).total === 150, 'voto aplicado');
  assert.ok(voted);

  ana.send({ type: 'confirm' });
  const final = await beto.waitPhase('final');
  const scores = Object.fromEntries(final.state.players.map((p) => [p.name, p.score]));
  assert.equal(scores.Ana, 150);
  assert.equal(scores['<b onclick=x>B</b>'], 150);

  // Reconexión: Beto se cae y vuelve con su token
  const { playerId, token } = beto.joined;
  beto.close();
  await ana.waitFor((m) => m.type === 'state' && m.state.players.some((p) => p.id === playerId && !p.connected), 'beto desconectado');
  const beto2 = new Bot(port);
  await beto2.ready;
  beto2.send({ type: 'resume', code, playerId, token });
  const back = await beto2.waitFor((m) => m.type === 'state', 'estado al volver');
  assert.ok(back.state.players.find((p) => p.id === playerId).connected);
  assert.equal(back.state.you, playerId);

  // Token falso no entra
  const intruso = new Bot(port);
  await intruso.ready;
  intruso.send({ type: 'resume', code, playerId, token: 'x' });
  await intruso.waitFor((m) => m.type === 'resumeFailed', 'resumeFailed');

  // Expulsar
  ana.send({ type: 'kick', playerId });
  await beto2.waitFor((m) => m.type === 'kicked', 'kicked');

  ana.close();
  beto2.close();
  intruso.close();
});
