// js/game.js

const socket = new WebSocket('ws://localhost:8080');

socket.addEventListener('open', () => {
  console.log('Conectado al servidor WebSocket');

  const room = document.getElementById('room').value || 'Privada';
  const username = document.getElementById('username').value || 'Jugador';

  socket.send(JSON.stringify({
    type: 'joinRoom',
    room,
    username
  }));
});

socket.addEventListener('message', event => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'joined':
      console.log(`Entraste a la sala ${msg.room}`);
      break;

    case 'roundStarted':
      console.log(`Ronda iniciada con letra ${msg.letter} y tiempo ${msg.roundTime}`);
      document.getElementById('letter').textContent = msg.letter;
      document.getElementById('letra').value = msg.letter;
      tiempoRestante = msg.roundTime;
      document.getElementById('tiempo').textContent = `${tiempoRestante}s`;
      startTimer();
      disableInputs(false);
      break;

    case 'roundStopped':
      alert(`Ronda detenida por ${msg.by}`);
      stopTimer();
      disableInputs(true);
      enviarRespuestas();
      break;

    case 'answersReceived':
      console.log(`Jugador ${msg.username} envió respuestas`, msg.answers);
      break;

    case 'updatePlayers':
      const ul = document.getElementById('playerNames');
      if (ul) {
        ul.innerHTML = '';
        msg.players.forEach(p => {
          const li = document.createElement('li');
          li.textContent = p;
          ul.appendChild(li);
        });
      }
      break;
  }
});

function enviarRespuestas() {
  const respuestas = {};
  const inputs = document.querySelectorAll('input[type="text"]');

  inputs.forEach(input => {
    const nameMatch = input.name.match(/\[(.*)\]/);
    if (nameMatch) {
      const key = nameMatch[1];
      respuestas[key] = input.value.trim();
    }
  });

  socket.send(JSON.stringify({
    type: 'submitAnswers',
    room: document.getElementById('room').value,
    username: document.getElementById('username').value,
    answers: respuestas
  }));
}

// 🛑 STOP
function presionarStop() {
  const room = document.getElementById('room').value || 'Privada';
  const username = document.getElementById('username').value || 'Jugador';

  socket.send(JSON.stringify({
    type: 'stopPressed',
    room,
    username
  }));

  stopTimer();
  disableInputs(true);
  enviarRespuestas();
}

// Temporizador
let tiempoRestante = 60;
let temporizador;

function startTimer() {
  clearInterval(temporizador);
  temporizador = setInterval(() => {
    tiempoRestante--;
    document.getElementById('tiempo').textContent = `${tiempoRestante}s`;
    if (tiempoRestante <= 0) {
      stopTimer();
      disableInputs(true);
      enviarRespuestas();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(temporizador);
}

function disableInputs(disabled) {
  const inputs = document.querySelectorAll('input[type="text"]');
  inputs.forEach(i => i.disabled = disabled);

  const btnStop = document.getElementById('btnStop');
  if (btnStop) btnStop.disabled = disabled;
}
