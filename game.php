  <?php
  $username = $_GET['username'] ?? 'Jugador';
  $room = $_GET['room'] ?? 'Privada';
  $round_time = $_GET['round_time'] ?? 60;
  ?>

  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Juego STOP</title>
    <style>
      body {
        font-family: 'Segoe UI', sans-serif;
        background-color: #eef3f8;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
      }

      .container {
        background: white;
        padding: 30px 40px;
        border-radius: 15px;
        box-shadow: 0 0 15px rgba(0,0,0,0.1);
        max-width: 1000px;
        width: 95%;
        text-align: center;
      }

      h2, h3, h4 { margin: 10px 0; }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
      }

      th, td {
        border: 1px solid #ccc;
        padding: 10px;
      }

      input[type="text"] {
   width: 100%;  /* Ya lo tienes */
  max-width: 120px; /* Limita ancho máximo para que no estiren mucho */
  box-sizing: border-box; /* Incluye padding y border en el ancho */
   border-radius: 4px;
      }

      button {
        padding: 12px 25px;
        font-size: 16px;
        font-weight: bold;
        border-radius: 10px;
        border: none;
        cursor: pointer;
        margin-top: 20px;
        transition: background 0.3s;
      }

      #btnStop {
        background-color: #e74c3c;
        color: white;
      }

      #btnStop:hover {
        background-color: #c0392b;
      }

      #btnStartRound {
        background-color: #2980b9;
        color: white;
        display: none;
      }

      #btnStartRound:hover {
        background-color: #21618c;
      }

      #status {
        margin-top: 10px;
        font-style: italic;
        color: #666;
      }

      #playersList {
        text-align: left;
        margin-top: 15px;
      }

      #playersList ul {
        list-style: disc;
        padding-left: 20px;
        margin: 5px 0;
      }

      #scoreboard {
        margin-top: 20px;
      }

      .host-label {
        background: #27ae60;
        color: white;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 6px;
        margin-left: 6px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>¡Bienvenido, <?= htmlspecialchars($username) ?>!</h2>
      <h3>Sala: <span id="roomDisplay"><?= htmlspecialchars($room) ?></span> | Letra: <span id="letter" style="color:blue">-</span></h3>
      <h4>Tiempo por ronda: <span id="tiempo"><?= $round_time ?></span>s</h4>

      <div id="playersList">
        <strong>Jugadores en sala:</strong>
        <ul id="playerNames"></ul>
      </div>

      <form id="formulario">
        <input type="hidden" id="username" value="<?= htmlspecialchars($username) ?>">
        <input type="hidden" id="room" value="<?= htmlspecialchars($room) ?>">
        <input type="hidden" id="letra">

        <?php $categorias = ['Nombre', 'Apellido', 'Animal', 'Color', 'País', 'Fruta', 'Objeto']; ?>
        <table>
          <thead>
            <tr>
              <?php foreach ($categorias as $cat): ?>
                <th><?= $cat ?></th>
              <?php endforeach; ?>
            </tr>
          </thead>
          <tbody>
            <tr>
              <?php foreach ($categorias as $cat): ?>
                <td><input type="text" name="respuestas[<?= strtolower($cat) ?>]" placeholder="<?= $cat ?>"></td>
              <?php endforeach; ?>
            </tr>
          </tbody>
        </table>

        <button type="button" id="btnStop" disabled>¡STOP!</button>
      </form>

      <button id="btnStartRound">Iniciar Ronda</button>

      <div id="status">Conectando...</div>
      <div id="scoreboard"></div>
    </div>

  <script>
    const username = document.getElementById('username').value;
    const room = document.getElementById('room').value;
    const letterInput = document.getElementById('letra');
    const letterDisplay = document.getElementById('letter');
    const tiempoDisplay = document.getElementById('tiempo');
    const statusDiv = document.getElementById('status');
    const btnStartRound = document.getElementById('btnStartRound');
    const btnStop = document.getElementById('btnStop');
    const form = document.getElementById('formulario');
    const playerNamesUl = document.getElementById('playerNames');
    const scoreboardDiv = document.getElementById('scoreboard');

    let isHost = false;
    let tiempoRestante = parseInt(tiempoDisplay.textContent);
    let temporizador = null;
    let roundActive = false;

    const socket = new WebSocket('ws://localhost:8080');

    socket.addEventListener('open', () => {
      statusDiv.textContent = 'Conectado al servidor...';
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
          isHost = msg.isHost;
          if (isHost) btnStartRound.style.display = 'inline-block';
          statusDiv.textContent = isHost ? 'Eres el host de la sala.' : 'Esperando al host para iniciar...';
          break;

        case 'updatePlayers':
          playerNamesUl.innerHTML = '';
          msg.players.forEach(name => {
            const li = document.createElement('li');
            li.textContent = name;
            if (name === msg.host) {
              const span = document.createElement('span');
              span.className = 'host-label';
              span.textContent = 'HOST';
              li.appendChild(span);
            }
            playerNamesUl.appendChild(li);
          });
          break;

        case 'roundStarted':
          roundActive = true;
          letterDisplay.textContent = msg.letter;
          letterInput.value = msg.letter;
          tiempoRestante = msg.roundTime;
          tiempoDisplay.textContent = tiempoRestante + 's';
          clearInputs();
          disableInputs(false);
          startTimer();
          statusDiv.textContent = 'Ronda iniciada. ¡A jugar!';
          btnStartRound.disabled = true;
          btnStop.disabled = false;
          scoreboardDiv.innerHTML = '';
          break;

        case 'roundStopped':
          roundActive = false;
          stopTimer();
          disableInputs(true);
          statusDiv.textContent = `STOP presionado por ${msg.by}`;
          enviarRespuestas();
          btnStop.disabled = true;
          if (isHost) btnStartRound.disabled = false;
          break;

        case 'scoreboard':
          mostrarPuntajes(msg.scores);
          break;
      }
    });

    function startTimer() {
      clearInterval(temporizador);
      temporizador = setInterval(() => {
        tiempoRestante--;
        tiempoDisplay.textContent = tiempoRestante + 's';
        if (tiempoRestante <= 0) {
          stopTimer();
          statusDiv.textContent = 'Tiempo agotado.';
          disableInputs(true);
          enviarRespuestas();
          btnStop.disabled = true;
          if (isHost) btnStartRound.disabled = false;
        }
      }, 1000);
    }

    function stopTimer() {
      clearInterval(temporizador);
    }

    function disableInputs(disabled) {
      const inputs = form.querySelectorAll('input[type="text"]');
      inputs.forEach(input => input.disabled = disabled);
      btnStop.disabled = disabled;
    }

    function clearInputs() {
      const inputs = form.querySelectorAll('input[type="text"]');
      inputs.forEach(input => input.value = '');
    }

    btnStartRound.addEventListener('click', () => {
      if (!isHost) return;
      socket.send(JSON.stringify({
        type: 'startRound',
        room,
        username,
        roundTime: parseInt(tiempoDisplay.textContent)
      }));
      btnStartRound.disabled = true;
    });

    btnStop.addEventListener('click', () => {
      if (!roundActive) return;
      roundActive = false;
      stopTimer();
      statusDiv.textContent = 'Has presionado STOP.';
      disableInputs(true);
      socket.send(JSON.stringify({
        type: 'stopPressed',
        room,
        username
      }));
      enviarRespuestas();
      btnStop.disabled = true;
      if (isHost) btnStartRound.disabled = false;
    });

    function enviarRespuestas() {
      const respuestas = {};
      const inputs = form.querySelectorAll('input[type="text"]');
      inputs.forEach(input => {
        const name = input.name.match(/\[(.*)\]/)[1];
        respuestas[name] = input.value.trim();
      });

      socket.send(JSON.stringify({
        type: 'submitAnswers',
        room,
        username,
        answers: respuestas
      }));
    }

    function mostrarPuntajes(scores) {
      let html = '<h3>📊 Tabla de Puntuación</h3>';
      html += '<table><tr><th>Jugador</th><th>Puntos</th></tr>';
      Object.entries(scores).sort((a, b) => b[1] - a[1]).forEach(([jug, pts]) => {
        html += `<tr><td>${jug}</td><td>${pts}</td></tr>`;
      });
      html += '</table>';
      scoreboardDiv.innerHTML = html;
    }
  </script>
  </body>
  </html>
