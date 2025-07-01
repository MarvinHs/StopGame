const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
console.log('Servidor WebSocket iniciado en ws://localhost:8080');

const rooms = {}; // Estructura: { roomName: { players: [{username, ws}], host: username, roundActive: bool, letter: '', roundTime: int, scores: {} } }

function randomLetter() {
  const letters = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
  return letters.charAt(Math.floor(Math.random() * letters.length));
}

function broadcast(room, data) {
  if (!rooms[room]) return;
  rooms[room].players.forEach(({ ws }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  });
}

function sendPlayersUpdate(room) {
  if (!rooms[room]) return;
  const players = rooms[room].players.map(p => p.username);
  broadcast(room, {
    type: 'updatePlayers',
    players,
    host: rooms[room].host,
  });
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentUser = null;

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      switch (data.type) {
        case 'joinRoom':
          {
            currentRoom = data.room || 'Privada';
            currentUser = data.username || 'Jugador';

            if (!rooms[currentRoom]) {
              rooms[currentRoom] = {
                players: [],
                host: null,
                roundActive: false,
                letter: '',
                roundTime: 60,
                scores: {}
              };
            }

            // Añadir jugador si no está
            if (!rooms[currentRoom].players.find(p => p.username === currentUser)) {
              rooms[currentRoom].players.push({ username: currentUser, ws });
            }

            // Asignar host si no tiene
            if (!rooms[currentRoom].host) {
              rooms[currentRoom].host = currentUser;
            }

            // Enviar confirmación con info de host
            ws.send(JSON.stringify({
              type: 'joined',
              room: currentRoom,
              isHost: rooms[currentRoom].host === currentUser
            }));

            // Actualizar lista jugadores a todos
            sendPlayersUpdate(currentRoom);
          }
          break;

        case 'startRound':
          {
            if (!rooms[currentRoom]) break;
            if (rooms[currentRoom].host !== currentUser) break; // Solo host puede iniciar

            if (rooms[currentRoom].roundActive) break; // Ronda ya activa

            rooms[currentRoom].roundActive = true;
            rooms[currentRoom].letter = randomLetter();
            rooms[currentRoom].roundTime = parseInt(data.roundTime) || 60;
            rooms[currentRoom].scores = rooms[currentRoom].scores || {};

            broadcast(currentRoom, {
              type: 'roundStarted',
              letter: rooms[currentRoom].letter,
              roundTime: rooms[currentRoom].roundTime
            });
          }
          break;

        case 'stopPressed':
          {
            if (!rooms[currentRoom]) break;
            if (!rooms[currentRoom].roundActive) break;

            rooms[currentRoom].roundActive = false;

            broadcast(currentRoom, {
              type: 'roundStopped',
              by: currentUser
            });
          }
          break;

        case 'submitAnswers':
          {
            if (!rooms[currentRoom]) break;

            // Guardar respuestas recibidas
            const answers = data.answers || {};
            rooms[currentRoom].scores = rooms[currentRoom].scores || {};
            rooms[currentRoom].players.forEach(({ username }) => {
              if (!(username in rooms[currentRoom].scores)) {
                rooms[currentRoom].scores[username] = 0;
              }
            });

            // Guardar respuestas para esta ronda en el objeto
            rooms[currentRoom].playersAnswers = rooms[currentRoom].playersAnswers || {};
            rooms[currentRoom].playersAnswers[currentUser] = answers;

            // Cuando todos envían respuestas, calcular puntajes
            if (Object.keys(rooms[currentRoom].playersAnswers).length === rooms[currentRoom].players.length) {
              // Contar ocurrencias de cada respuesta para puntuar
              const allAnswers = {};
              Object.values(rooms[currentRoom].playersAnswers).forEach(ans => {
                Object.entries(ans).forEach(([cat, val]) => {
                  const v = val.trim().toLowerCase();
                  if (v) {
                    if (!allAnswers[cat]) allAnswers[cat] = {};
                    allAnswers[cat][v] = (allAnswers[cat][v] || 0) + 1;
                  }
                });
              });

              // Calcular puntajes
              Object.entries(rooms[currentRoom].playersAnswers).forEach(([player, ans]) => {
                let points = 0;
                Object.entries(ans).forEach(([cat, val]) => {
                  const v = val.trim().toLowerCase();
                  if (v) {
                    const count = allAnswers[cat][v];
                    if (count === 1) points += 10;
                    else if (count > 1) points += 5;
                  }
                });
                rooms[currentRoom].scores[player] += points;
              });

              // Limpiar respuestas para la próxima ronda
              rooms[currentRoom].playersAnswers = {};

              // Enviar tabla de puntuación
              broadcast(currentRoom, {
                type: 'scoreboard',
                scores: rooms[currentRoom].scores
              });
            }

            // Confirmación recepción
            ws.send(JSON.stringify({
              type: 'answersReceived',
              username: currentUser,
              answers
            }));
          }
          break;
      }
    } catch (e) {
      console.error('Error procesando mensaje:', e);
    }
  });

  ws.on('close', () => {
    if (!currentRoom || !currentUser) return;

    const roomObj = rooms[currentRoom];
    if (!roomObj) return;

    // Quitar jugador
    roomObj.players = roomObj.players.filter(p => p.username !== currentUser);

    // Si era host, asignar nuevo host (primer jugador si queda alguno)
    if (roomObj.host === currentUser) {
      roomObj.host = roomObj.players.length > 0 ? roomObj.players[0].username : null;
    }

    // Actualizar lista jugadores a todos
    sendPlayersUpdate(currentRoom);

    // Si ya no quedan jugadores, eliminar sala
    if (roomObj.players.length === 0) {
      delete rooms[currentRoom];
    }
  });
});

