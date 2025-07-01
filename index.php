<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>STOP - Unirse a Sala</title>
  <style>
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #f0f4f7;
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
      box-shadow: 0 0 12px rgba(0,0,0,0.1);
      width: 100%;
      max-width: 400px;
      text-align: center;
    }

    h2 {
      margin-bottom: 20px;
      color: #2c3e50;
    }

    input[type="text"], input[type="number"] {
      width: 100%;
      padding: 10px;
      margin-bottom: 15px;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 16px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      text-align: left;
      font-weight: bold;
    }

    .checkbox {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      margin-bottom: 15px;
    }

    .checkbox input {
      margin-right: 10px;
    }

    button {
      background-color: #27ae60;
      color: white;
      border: none;
      padding: 12px 25px;
      font-size: 16px;
      font-weight: bold;
      border-radius: 10px;
      cursor: pointer;
      transition: 0.3s;
    }

    button:hover {
      background-color: #1e8449;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>Unirse a una Sala</h2>
    <form action="game.php" method="GET">
      <label for="username">Nombre de usuario</label>
      <input type="text" id="username" name="username" placeholder="Tu nombre" required>

      <label for="room">Nombre de la sala</label>
      <input type="text" id="room" name="room" placeholder="Ej: Familia, Amigos" required>

      <label for="round_time">Tiempo por ronda (segundos)</label>
      <input type="number" id="round_time" name="round_time" value="60" min="10" max="300" required>

      <div class="checkbox">
        <input type="checkbox" id="host" name="host" value="1">
        <label for="host" style="font-weight: normal;">Soy el host</label>
      </div>

      <button type="submit">Entrar al Juego</button>
    </form>
  </div>
</body>
</html>
