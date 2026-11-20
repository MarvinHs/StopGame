'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Lobby, moderate } = require('../src/lobby');
const { Room } = require('../src/room');

function fakeWs(ip) {
  return { ip, inbox: [] };
}

function makeLobby(rooms = []) {
  let now = 1_000_000;
  const lobby = new Lobby({
    send: (ws, data) => ws.inbox.push(data),
    listRooms: () => rooms,
    now: () => now,
  });
  return { lobby, tick: (ms) => { now += ms; } };
}

test('filtra malas palabras y enlaces, sin tocar palabras normales', () => {
  assert.equal(moderate('Hola mmg, entra a www.spam.com'), 'Hola m**, entra a [enlace quitado]');
  assert.equal(moderate('Eres un ESTÚPIDO'), 'Eres un E*******');
  assert.equal(moderate('Me gusta el huevo, el coco y la sala ABCD'), 'Me gusta el huevo, el coco y la sala ABCD');
});

test('mensajes: todos los que miran reciben, y hay límite de velocidad', () => {
  const { lobby, tick } = makeLobby();
  const a = fakeWs('1.1.1.1');
  const b = fakeWs('2.2.2.2');
  lobby.watch(a);
  lobby.watch(b);
  assert.equal(lobby.online(), 2);
  lobby.say(a, 'Ana', '¿Quién juega?');
  const got = b.inbox.find((m) => m.type === 'lobbyMessage');
  assert.equal(got.message.name, 'Ana');
  assert.ok(!('ip' in got.message), 'no se filtra la IP');
  assert.throws(() => lobby.say(a, 'Ana', 'otra vez'), /despacio/);
  tick(2000);
  lobby.say(a, 'Ana', 'otra vez');
  assert.throws(() => lobby.say(a, '', 'sin nombre'), /nombre/);
});

test('3 reportes de personas distintas borran el mensaje y silencian al autor', () => {
  const { lobby } = makeLobby();
  const malo = fakeWs('6.6.6.6');
  lobby.watch(malo);
  lobby.say(malo, 'Troll', 'spam spam');
  const id = lobby.messages[0].id;
  assert.throws(() => lobby.report(malo, id), /propios/);
  lobby.report(fakeWs('1.1.1.1'), id);
  lobby.report(fakeWs('1.1.1.1'), id); // la misma persona no cuenta dos veces
  lobby.report(fakeWs('2.2.2.2'), id);
  assert.equal(lobby.messages.length, 1);
  lobby.report(fakeWs('3.3.3.3'), id);
  assert.equal(lobby.messages.length, 0);
  assert.ok(malo.inbox.some((m) => m.type === 'lobbyRemove' && m.id === id));
  assert.throws(() => lobby.say(malo, 'Troll', 'otra'), /reportaron/);
});

test('compartir sala: publica invitación, la marca pública y no deja repetir enseguida', () => {
  const { lobby, tick } = makeLobby();
  const ws = fakeWs('1.1.1.1');
  const room = new Room('ABCD');
  const ana = room.addPlayer('Ana');
  room.setLocked(ana.id, true);
  assert.throws(() => lobby.shareRoom(ws, room, 'Ana'), /cerrada/);
  room.setLocked(ana.id, false);
  lobby.shareRoom(ws, room, 'Ana');
  assert.ok(room.public);
  assert.equal(lobby.messages[0].kind, 'invite');
  assert.equal(lobby.messages[0].code, 'ABCD');
  assert.throws(() => lobby.shareRoom(ws, room, 'Ana'), /hace poco/);
  tick(61000);
  lobby.shareRoom(ws, room, 'Ana');
  room.close();
});
