'use strict';

/* STOP Dominicano — cliente del navegador */
(() => {
  const $ = (id) => document.getElementById(id);

  /** Crea elementos sin usar innerHTML (así ningún nombre puede meter código). */
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key in el && typeof value !== 'string') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  /** Reemplaza el contenido de un elemento ignorando los huecos (null/false). */
  function fill(el, ...children) {
    el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  }

  // ───────────────────────── Almacenamiento ─────────────────────────
  const storage = {
    get(area, key) {
      try { return window[area].getItem(key); } catch { return null; }
    },
    set(area, key, value) {
      try {
        if (value === null) window[area].removeItem(key);
        else window[area].setItem(key, value);
      } catch { /* modo privado, sin almacenamiento */ }
    },
  };

  function loadSession() {
    try { return JSON.parse(storage.get('sessionStorage', 'stop.session')) || null; } catch { return null; }
  }
  function saveSession(s) {
    session = s;
    storage.set('sessionStorage', 'stop.session', s ? JSON.stringify(s) : null);
  }

  // ───────────────────────── Texto (igual que en el servidor) ─────────────────────────
  function normalizeAnswer(text) {
    return String(text ?? '')
      .normalize('NFC').toLowerCase()
      .replace(/ñ/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\u0001/g, 'ñ')
      .replace(/[^a-zñ0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const startsWithLetter = (text, letter) => {
    const n = normalizeAnswer(text);
    return Boolean(n && letter && n.startsWith(normalizeAnswer(letter)));
  };

  const SUGGESTED_CATEGORIES = [
    'Artista o Cantante', 'Pelotero', 'Marca', 'Carro', 'Comida', 'Profesión', 'Deporte',
    'Película o Serie', 'Parte del cuerpo', 'Flor o Planta', 'Barrio o Sector', 'Cosa de la casa',
    'Verbo', 'Bebida', 'Programa de TV', 'Instrumento',
  ];
  const DEFAULT_CATEGORIES = ['Nombre', 'Apellido', 'Ciudad o País', 'Animal', 'Fruta o Comida', 'Color', 'Cosa'];

  // ───────────────────────── Sonido ─────────────────────────
  let audio = null;
  let muted = storage.get('localStorage', 'stop.muted') === '1';
  function beep(freq, ms, type = 'sine', gain = 0.15) {
    if (muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      vol.gain.setValueAtTime(gain, audio.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000);
      osc.connect(vol).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + ms / 1000);
    } catch { /* sin audio */ }
  }
  const sounds = {
    tick: () => beep(660, 120),
    go: () => { beep(880, 160); setTimeout(() => beep(1320, 260), 140); },
    stop: () => { beep(220, 450, 'square', 0.12); if (navigator.vibrate) navigator.vibrate([120, 60, 120]); },
    warn: () => beep(990, 80, 'triangle', 0.1),
    win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 220, 'triangle'), i * 160)),
  };

  // ───────────────────────── Avisos ─────────────────────────
  function toast(message, kind = '') {
    const el = h('div', { class: `toast ${kind}`, text: message });
    $('toasts').append(el);
    setTimeout(() => el.remove(), kind === 'error' ? 4500 : 3000);
  }

  // ───────────────────────── Conexión ─────────────────────────
  let ws = null;
  let session = loadSession();
  let state = null;
  let clockOffset = 0;
  let pending = null; // mensaje para enviar al conectar (crear/unirse)
  let retry = 0;
  let reconnectTimer = null;
  let allowReconnect = true;

  function wsUrl() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(reconnectTimer);
    ws = new WebSocket(wsUrl());

    ws.addEventListener('open', () => {
      retry = 0;
      $('connBanner').hidden = true;
      if (session) send({ type: 'resume', ...session });
      else if (pending) send(pending);
      else if (lobbyActive) send({ type: 'lobbyWatch' });
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handle(msg);
    });

    ws.addEventListener('close', () => {
      ws = null;
      if (lobbyActive && !session) $('lobbyOnline').textContent = 'reconectando…';
      if (!allowReconnect || (!session && !pending && !lobbyActive)) return;
      if (session) $('connBanner').hidden = false;
      const wait = Math.min(10000, 800 * 2 ** retry++);
      reconnectTimer = setTimeout(connect, wait);
    });
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  function enterRoom(message) {
    allowReconnect = true;
    pending = message;
    if (!send(message)) connect();
  }

  function goHome(message, kind) {
    voiceLeave(true);
    startLobby();
    saveSession(null);
    pending = null;
    state = null;
    lastKey = '';
    $('screenRoom').hidden = true;
    $('screenHome').hidden = false;
    history.replaceState(null, '', location.pathname);
    document.title = 'STOP Dominicano 🇩🇴';
    if (message) toast(message, kind);
  }

  function handle(msg) {
    switch (msg.type) {
      case 'joined':
        pending = null;
        lobbyActive = false;
        saveSession({ code: msg.code, playerId: msg.playerId, token: msg.token });
        if (voice.joined) voiceRejoin();
        history.replaceState(null, '', `?sala=${msg.code}`);
        break;
      case 'state':
        clockOffset = msg.state.serverNow - Date.now();
        render(msg.state);
        break;
      case 'rtc':
        handleSignal(msg.from, msg.signal);
        break;
      case 'lobby':
        lobbyMessages = msg.messages;
        renderLobbyChat();
        renderPublicRooms(msg.rooms);
        setOnline(msg.online);
        break;
      case 'lobbyMessage':
        lobbyMessages.push(msg.message);
        if (lobbyMessages.length > 80) lobbyMessages.shift();
        renderLobbyChat();
        break;
      case 'lobbyRemove':
        lobbyMessages = lobbyMessages.filter((m) => m.id !== msg.id);
        renderLobbyChat();
        break;
      case 'lobbyOnline':
        setOnline(msg.online);
        break;
      case 'lobbyRooms':
        renderPublicRooms(msg.rooms);
        break;
      case 'notice':
        toast(msg.message, 'ok');
        break;
      case 'event':
        if (msg.event.kind === 'stop') sounds.stop();
        break;
      case 'error':
        pending = null;
        toast(msg.message, 'error');
        break;
      case 'resumeFailed':
        goHome('Tu lugar en la sala se perdió. Vuelve a entrar con el código.', 'error');
        break;
      case 'kicked':
        allowReconnect = false;
        goHome('El host te sacó de la sala.', 'error');
        break;
      case 'replaced':
        allowReconnect = false;
        $('connBanner').hidden = true;
        toast('Abriste esta sala en otra pestaña o dispositivo.', 'error');
        break;
      case 'left':
        allowReconnect = false;
        goHome();
        break;
      default:
        break;
    }
  }

  // ───────────────────────── Inicio ─────────────────────────
  function readName() {
    const name = $('nameInput').value.trim();
    if (!name) {
      toast('Primero escribe tu nombre.', 'error');
      $('nameInput').focus();
      return null;
    }
    storage.set('localStorage', 'stop.name', name);
    return name;
  }

  $('btnCreate').addEventListener('click', () => {
    const name = readName();
    if (name) enterRoom({ type: 'create', name });
  });

  $('btnSolo').addEventListener('click', () => {
    const name = readName();
    if (name) enterRoom({ type: 'create', name, solo: true, bots: 3, level: $('soloLevel').value });
  });

  function join() {
    const name = readName();
    if (!name) return;
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) {
      toast('El código de la sala tiene 4 letras.', 'error');
      $('codeInput').focus();
      return;
    }
    enterRoom({ type: 'join', name, code });
  }
  $('btnJoin').addEventListener('click', join);
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('nameInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if ($('codeInput').value.trim()) join();
    else $('btnCreate').click();
  });

  // ───────────────────────── Chat principal ─────────────────────────
  let lobbyActive = false;
  let lobbyMessages = [];
  let blocked = new Set();
  try { blocked = new Set(JSON.parse(storage.get('localStorage', 'stop.blocked')) || []); } catch { /* vacío */ }

  function startLobby() {
    lobbyActive = true;
    allowReconnect = true;
    if (!send({ type: 'lobbyWatch' })) connect();
  }

  function setOnline(n) {
    $('lobbyOnline').textContent = `🟢 ${n} ${n === 1 ? 'persona' : 'personas'} aquí`;
  }

  const timeFmt = new Intl.DateTimeFormat('es-DO', { hour: 'numeric', minute: '2-digit' });

  function joinCode(code) {
    $('codeInput').value = code;
    if (!$('nameInput').value.trim()) {
      toast('Escribe tu nombre y toca Entrar.', 'error');
      $('nameInput').focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    join();
  }

  function renderLobbyChat() {
    const list = $('lobbyList');
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    const visible = lobbyMessages.filter((m) => !blocked.has(m.name.toLowerCase()));
    fill(list, visible.length ? visible.map((m) => {
      const mine = m.name.toLowerCase() === ($('nameInput').value.trim() || '').toLowerCase();
      const li = h('li', { class: m.kind === 'invite' ? 'invite' : '' },
        h('span', { class: 'from', text: m.kind === 'invite' ? `📣 ${m.name}` : `${m.name}:` }),
        m.text,
        m.kind === 'invite' && m.code ? h('button', {
          class: 'join-btn', text: `Entrar a ${m.code}`,
          onclick: (e) => { e.stopPropagation(); joinCode(m.code); },
        }) : null,
        h('span', { class: 'when', text: timeFmt.format(new Date(m.at)) }),
        mine ? null : h('div', { class: 'acts' },
          h('button', {
            text: `🙈 Ocultar a ${m.name}`,
            onclick: (e) => {
              e.stopPropagation();
              blocked.add(m.name.toLowerCase());
              storage.set('localStorage', 'stop.blocked', JSON.stringify([...blocked]));
              toast(`Ya no verás los mensajes de ${m.name}.`, 'ok');
              renderLobbyChat();
            },
          }),
          h('button', {
            text: '🚩 Reportar',
            onclick: (e) => {
              e.stopPropagation();
              send({ type: 'lobbyReport', id: m.id });
              li.classList.remove('open');
            },
          })));
      li.addEventListener('click', () => { if (!mine) li.classList.toggle('open'); });
      return li;
    }) : h('li', { class: 'lobby-empty', text: 'Nadie ha escrito todavía. ¡Saluda! 👋' }));
    if (nearBottom || list.scrollTop === 0) list.scrollTop = list.scrollHeight;
  }

  const PHASE_LABEL = { lobby: 'esperando jugadores', countdown: 'jugando', playing: 'jugando', collecting: 'jugando', review: 'revisando', final: 'terminó la partida' };

  function renderPublicRooms(rooms) {
    fill($('publicRooms'), rooms && rooms.length ? [
      h('strong', { class: 'small', text: '🟢 Salas abiertas' }),
      ...rooms.map((r) => h('div', { class: 'proom' },
        h('span', { class: 'pcode', text: r.code }),
        h('span', { class: 'pinfo', text: `de ${r.host} · ${r.players}/${r.max} · ${r.phase === 'lobby' || r.phase === 'final' ? PHASE_LABEL[r.phase] : `${PHASE_LABEL[r.phase]} (ronda ${r.round} de ${r.rounds})`}` }),
        h('button', { class: 'btn btn-red btn-sm', text: 'Entrar', onclick: () => joinCode(r.code) }))),
    ] : []);
  }

  $('lobbyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('lobbyInput').value.trim();
    if (!text) return;
    const name = $('nameInput').value.trim();
    if (!name) {
      toast('Primero escribe tu nombre arriba.', 'error');
      $('nameInput').focus();
      return;
    }
    storage.set('localStorage', 'stop.name', name);
    if (send({ type: 'lobbySay', name, text })) $('lobbyInput').value = '';
    else toast('Sin conexión. Intentando reconectar…', 'error');
  });

  // ───────────────────────── Barra superior ─────────────────────────
  function updateSoundButton() {
    $('btnSound').textContent = muted ? '🔇' : '🔊';
  }
  $('btnSound').addEventListener('click', () => {
    muted = !muted;
    storage.set('localStorage', 'stop.muted', muted ? '1' : '0');
    updateSoundButton();
    if (!muted) sounds.tick();
  });

  $('btnCopy').addEventListener('click', async () => {
    if (!state) return;
    const link = `${location.origin}/?sala=${state.code}`;
    const text = `¡Vamos a jugar STOP! 🛑 Entra aquí: ${link} (código ${state.code})`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'STOP Dominicano', text });
        return;
      }
      await navigator.clipboard.writeText(link);
      toast('Enlace copiado. ¡Pásaselo a tus panas!', 'ok');
    } catch {
      toast(`Comparte este enlace: ${link}`);
    }
  });

  $('btnLeave').addEventListener('click', () => {
    if (!send({ type: 'leave' })) {
      allowReconnect = false;
      goHome();
    }
  });

  // ───────────────────────── Render principal ─────────────────────────
  let lastKey = '';
  let lastPhase = '';

  const PHASE_SECTIONS = {
    lobby: 'phaseLobby',
    countdown: 'phaseCountdown',
    playing: 'phasePlaying',
    collecting: 'phaseCollecting',
    review: 'phaseReview',
    final: 'phaseFinal',
  };

  const isHost = () => state && state.hostId === state.you;
  const playerName = (id) => (state.players.find((p) => p.id === id) || {}).name || '¿?';

  function render(next) {
    const prev = state;
    state = next;
    $('screenHome').hidden = true;
    $('screenRoom').hidden = false;
    $('roomCode').textContent = state.code;
    document.title = `STOP · Sala ${state.code}`;
    $('roundInfo').textContent = (state.phase === 'lobby' ? 'En la sala' : state.phase === 'final' ? 'Partida terminada' : `Ronda ${state.round} de ${state.settings.rounds}`)
      + (state.locked ? ' · 🔒' : '');

    for (const [phase, id] of Object.entries(PHASE_SECTIONS)) $(id).hidden = phase !== state.phase;

    const key = `${state.phase}:${state.round}`;
    const changed = key !== lastKey;
    lastKey = key;

    if (changed) onPhaseEnter(state.phase, prev ? prev.phase : null);

    renderPlayers();
    renderChat();
    syncVoice();

    switch (state.phase) {
      case 'lobby': renderLobby(); break;
      case 'countdown': $('cdRound').textContent = state.round; break;
      case 'playing': if (changed) buildAnswers(); updatePlaying(); break;
      case 'collecting': renderCollecting(); break;
      case 'review': renderReview(); break;
      case 'final': renderFinal(); break;
      default: break;
    }
    tick();
  }

  function onPhaseEnter(phase, prevPhase) {
    if (phase === 'playing') sounds.go();
    if (phase === 'collecting') flushDraft();
    if (phase === 'final' && prevPhase === 'review') sounds.win();
    lastPhase = phase;
    lastSecond = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ───────────────────────── Jugadores ─────────────────────────
  const confirmKick = new Set();

  function renderPlayers() {
    const list = $('playerList');
    fill(list);
    $('playerCount').textContent = `(${state.players.length})`;
    const total = state.settings.categories.length;

    for (const p of state.players) {
      const me = p.id === state.you;
      const controls = [];
      if (isHost() && !me) {
        if (!p.isBot) {
          controls.push(h('button', {
            class: 'mini-btn', title: 'Hacer host', text: '👑',
            onclick: () => send({ type: 'makeHost', playerId: p.id }),
          }));
        }
        controls.push(h('button', {
          class: 'mini-btn',
          title: 'Sacar de la sala',
          text: confirmKick.has(p.id) ? '¿Sacar?' : '✕',
          onclick: () => {
            if (confirmKick.has(p.id)) {
              confirmKick.delete(p.id);
              send({ type: 'kick', playerId: p.id });
            } else {
              confirmKick.add(p.id);
              setTimeout(() => { confirmKick.delete(p.id); if (state) renderPlayers(); }, 3000);
              renderPlayers();
            }
          },
        }));
      }

      const classes = [p.connected ? '' : 'off', voice.speaking.has(p.id) ? 'speaking' : ''].join(' ').trim();
      list.append(h('li', { class: classes, 'data-id': p.id },
        h('span', { class: `dot ${p.connected ? '' : 'off'}`, title: p.connected ? 'Conectado' : 'Desconectado' }),
        h('span', { class: 'pname', text: p.name }),
        p.voice ? h('span', { class: 'vicon', title: p.voice.muted ? 'En la voz (silenciado)' : 'En la voz', text: p.voice.muted ? '🔇' : '🎙️' }) : null,
        p.isBot ? h('span', { class: 'badge bot', text: p.level.toUpperCase() }) : null,
        p.id === state.hostId ? h('span', { class: 'badge', text: 'HOST' }) : null,
        me ? h('span', { class: 'badge you', text: 'TÚ' }) : null,
        state.phase === 'review' && p.ready ? h('span', { class: 'badge ready', title: 'Listo', text: '✓' }) : null,
        p.filled !== null ? h('span', { class: `progress ${p.filled === total ? 'full' : ''}`, text: `${p.filled}/${total}` }) : null,
        h('span', { class: 'pscore', text: p.score }),
        controls,
      ));
    }
  }

  // ───────────────────────── Chat ─────────────────────────
  let lastChatId = null;
  function renderChat() {
    const last = state.chat[state.chat.length - 1];
    if (!last || last.id === lastChatId) return;
    lastChatId = last.id;
    const list = $('chatList');
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    fill(list, ...state.chat.map((m) => (m.from
      ? h('li', {}, h('span', { class: 'from', text: `${m.from}:` }), m.text)
      : h('li', { class: 'sys', text: m.text }))));
    if (nearBottom || list.scrollTop === 0) list.scrollTop = list.scrollHeight;
  }

  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    if (send({ type: 'chat', text })) $('chatInput').value = '';
  });

  // ───────────────────────── Lobby ─────────────────────────
  (() => {
    const rounds = $('setRounds');
    for (let i = 1; i <= 20; i++) rounds.append(h('option', { value: i, text: `${i} ${i === 1 ? 'ronda' : 'rondas'}` }));
  })();

  function sendSettings(partial) {
    send({ type: 'settings', settings: partial });
  }

  $('setTime').addEventListener('change', (e) => sendSettings({ roundTime: Number(e.target.value) }));
  $('setRounds').addEventListener('change', (e) => sendSettings({ rounds: Number(e.target.value) }));

  function addCategory(name) {
    const clean = name.trim();
    if (!clean) return;
    const exists = state.settings.categories.some((c) => normalizeAnswer(c) === normalizeAnswer(clean));
    if (exists) { toast('Esa categoría ya está.', 'error'); return; }
    if (state.settings.categories.length >= state.limits.maxCategories) {
      toast(`Máximo ${state.limits.maxCategories} categorías.`, 'error');
      return;
    }
    sendSettings({ categories: [...state.settings.categories, clean] });
    $('catInput').value = '';
  }
  $('btnAddCat').addEventListener('click', () => addCategory($('catInput').value));
  $('catInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addCategory($('catInput').value); });

  function renderLobby() {
    const host = isHost();
    const s = state.settings;
    $('lobbyHint').textContent = host
      ? 'Tú eres el host: ajusta las reglas, invita a los demás con el botón 🔗 y dale a empezar cuando estén todos.'
      : 'El host está escogiendo las reglas. Así quedó por ahora:';

    const time = $('setTime');
    if (![...time.options].some((o) => Number(o.value) === s.roundTime)) {
      time.append(h('option', { value: s.roundTime, text: `${s.roundTime} segundos` }));
    }
    if (document.activeElement !== time) time.value = String(s.roundTime);
    if (document.activeElement !== $('setRounds')) $('setRounds').value = String(s.rounds);
    time.disabled = !host;
    $('setRounds').disabled = !host;

    fill($('catList'), ...s.categories.map((cat, i) => h('span', { class: 'chip' },
      cat,
      host && s.categories.length > state.limits.minCategories
        ? h('button', {
          title: `Quitar ${cat}`, text: '×',
          onclick: () => sendSettings({ categories: s.categories.filter((_, j) => j !== i) }),
        })
        : null)));

    $('catEditor').hidden = !host;
    const used = new Set(s.categories.map(normalizeAnswer));
    const suggestions = [...SUGGESTED_CATEGORIES, ...DEFAULT_CATEGORIES].filter((c) => !used.has(normalizeAnswer(c)));
    const sameAsDefault = s.categories.length === DEFAULT_CATEGORIES.length
      && s.categories.every((c, i) => c === DEFAULT_CATEGORIES[i]);
    $('catSuggestions').hidden = !host;
    fill($('catSuggestions'),
      ...suggestions.slice(0, 12).map((c) => h('span', { class: 'chip', text: `+ ${c}`, onclick: () => addCategory(c) })),
      sameAsDefault ? null : h('span', { class: 'chip', text: '↺ Las de siempre', onclick: () => sendSettings({ categories: DEFAULT_CATEGORIES }) }),
    );

    fill($('letterGrid'), ...state.allLetters.map((letter) => {
      const on = s.letters.includes(letter);
      return h('button', {
        class: on ? '' : 'off',
        text: letter,
        disabled: !host,
        title: on ? `Quitar la ${letter}` : `Agregar la ${letter}`,
        onclick: () => {
          const letters = on ? s.letters.filter((l) => l !== letter) : [...s.letters, letter];
          sendSettings({ letters });
        },
      });
    }));

    $('hostTools').hidden = !host;
    $('btnLock').textContent = state.locked ? '🔓 Abrir sala' : '🔒 Cerrar sala';
    $('btnLock').classList.toggle('on', state.locked);
    $('btnAddBot').disabled = state.players.filter((p) => p.isBot).length >= state.limits.maxBots;

    $('btnStart').hidden = !host;
    $('waitHost').hidden = host;
    $('btnShare').hidden = state.locked;
  }

  $('btnShare').addEventListener('click', () => send({ type: 'shareRoom' }));
  $('btnAddBot').addEventListener('click', () => send({ type: 'addBot', level: $('botLevel').value }));
  $('btnLock').addEventListener('click', () => send({ type: 'lock', locked: !state.locked }));

  $('btnStart').addEventListener('click', () => {
    if (state.players.length < 2) toast('Estás solo en la sala. Agrega bots o invita a alguien con el botón 🔗.');
    send({ type: 'start' });
  });

  // ───────────────────────── Jugando ─────────────────────────
  let draftTimer = null;

  function currentAnswers() {
    return [...$('answersForm').querySelectorAll('input')].map((i) => i.value);
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 350);
  }

  function flushDraft() {
    clearTimeout(draftTimer);
    if (!$('answersForm').children.length) return;
    send({ type: 'draft', answers: currentAnswers() });
  }

  function buildAnswers() {
    const form = $('answersForm');
    const draft = state.yourDraft || [];
    $('playLetter').textContent = state.letter;
    form.replaceChildren(...state.settings.categories.map((cat, i) => {
      const input = h('input', {
        type: 'text',
        maxlength: String(state.limits.answer),
        placeholder: `${cat} con ${state.letter}…`,
        autocapitalize: 'sentences',
        spellcheck: 'false',
        value: draft[i] || '',
        oninput: () => { markAnswer(input); updateStopButton(); scheduleDraft(); },
        onkeydown: (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const inputs = [...form.querySelectorAll('input')];
          const next = inputs[i + 1];
          if (next) next.focus();
          else $('btnStop').focus();
        },
      });
      const box = h('div', { class: 'answer' },
        h('label', { text: cat }), input, h('span', { class: 'mark' }));
      markAnswer(input, box);
      return box;
    }));
    updateStopButton();
    const first = form.querySelector('input');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  }

  function markAnswer(input, box = input.parentElement) {
    const value = input.value.trim();
    const ok = startsWithLetter(value, state.letter);
    box.classList.toggle('ok', Boolean(value) && ok);
    box.classList.toggle('bad', Boolean(value) && !ok);
    box.querySelector('.mark').textContent = !value ? '' : ok ? '✓' : `✗ ${state.letter}`;
  }

  function updateStopButton() {
    const all = currentAnswers().every((a) => startsWithLetter(a, state.letter));
    $('btnStop').classList.toggle('ready', all);
  }

  function updatePlaying() {
    $('playLetter').textContent = state.letter;
  }

  $('answersForm').addEventListener('submit', (e) => e.preventDefault());
  $('btnStop').addEventListener('click', () => {
    if (!state || state.phase !== 'playing') return;
    const answers = currentAnswers();
    const missing = state.settings.categories.filter((_, i) => !startsWithLetter(answers[i], state.letter));
    if (missing.length) {
      toast(`Todavía no puedes decir STOP. Te falta: ${missing.join(', ')}.`, 'error');
      return;
    }
    send({ type: 'stop', answers });
  });

  // ───────────────────────── Recogiendo ─────────────────────────
  function renderCollecting() {
    $('collectText').textContent = state.stoppedBy
      ? (state.stoppedBy === playerName(state.you) ? '¡Tú dijiste STOP!' : `¡${state.stoppedBy} dijo STOP!`)
      : '⏰ ¡Se acabó el tiempo!';
    $('answersForm').querySelectorAll('input').forEach((i) => { i.disabled = true; });
  }

  // ───────────────────────── Revisión ─────────────────────────
  function renderReview() {
    const rows = state.review.rows;
    const cats = state.settings.categories;
    $('reviewLetter').textContent = state.letter;

    fill($('reviewCats'), ...cats.map((cat, c) => h('div', { class: 'card' },
      h('h3', { text: cat }),
      rows.map((row) => {
        const cell = row.cells[c];
        const mine = row.playerId === state.you;
        let voteEl = null;
        if (mine) {
          if (cell.rejectVotes) voteEl = h('span', { class: 'vote-count', text: `👎 ${cell.rejectVotes}` });
        } else if (cell.votable && state.review.inRound) {
          voteEl = h('button', {
            class: `vote ${cell.youRejected ? 'on' : ''}`,
            title: cell.youRejected ? 'Quitar mi voto' : 'Votar que esta respuesta no vale',
            text: `👎 No vale${cell.rejectVotes ? ` · ${cell.rejectVotes}` : ''}`,
            onclick: () => send({ type: 'vote', playerId: row.playerId, category: c, reject: !cell.youRejected }),
          });
        }
        const textClass = !cell.text ? 'empty' : !cell.valid ? 'invalid' : '';
        return h('div', { class: 'rv-row' },
          h('span', { class: 'rv-who', text: mine ? `${playerName(row.playerId)} (tú)` : playerName(row.playerId) }),
          h('span', { class: `rv-text ${textClass}` },
            cell.text || '— vacía —',
            cell.reason && cell.text ? h('span', { class: 'rv-reason', text: cell.reason }) : null),
          voteEl,
          h('span', { class: `pts p${cell.points}`, text: cell.points }));
      }))));

    const sorted = [...rows].sort((a, b) => b.total - a.total);
    fill($('reviewTotals'), ...sorted.map((row) => h('span', { class: 'total-chip' },
      playerName(row.playerId), h('strong', { text: `+${row.total}` }))));

    const me = state.players.find((p) => p.id === state.you);
    const inRound = state.review.inRound;
    const last = state.round >= state.settings.rounds;
    $('btnReady').hidden = !inRound;
    $('btnReady').textContent = me && me.ready ? '⏳ Espera, no estoy listo' : last ? '✅ Listo, ver ganador' : '✅ Listo';
    $('btnReady').classList.toggle('btn-ghost', Boolean(me && me.ready));
    $('btnReady').classList.toggle('btn-red', !(me && me.ready));
    $('btnConfirm').hidden = !isHost();
    $('btnConfirm').textContent = last ? 'Ver ganador ya (host) 🏆' : 'Seguir ya (host) ▶';
    updateReadyInfo();
  }

  function updateReadyInfo() {
    if (!state || state.phase !== 'review') return;
    const humans = state.players.filter((p) => !p.isBot && p.connected && state.review.rows.some((r) => r.playerId === p.id));
    const ready = humans.filter((p) => p.ready).length;
    const secs = state.endsAt ? Math.max(0, Math.ceil((state.endsAt - (Date.now() + clockOffset)) / 1000)) : null;
    const prefix = state.review.inRound ? '' : 'Entraste a mitad de ronda: juegas desde la próxima. ';
    $('readyInfo').textContent = `${prefix}${ready} de ${humans.length} listos${secs !== null ? ` · sigue solo en ${secs} s` : ''}`;
  }

  $('btnReady').addEventListener('click', () => {
    const me = state.players.find((p) => p.id === state.you);
    send({ type: 'ready', ready: !(me && me.ready) });
  });
  $('btnConfirm').addEventListener('click', () => send({ type: 'confirm' }));

  // ───────────────────────── Final ─────────────────────────
  function renderFinal() {
    const ranking = state.players;
    const order = [ranking[1], ranking[0], ranking[2]];
    const places = [2, 1, 3];
    fill($('podium'), ...order.map((p, i) => (p
      ? h('div', { class: `step p${places[i]}` },
        h('div', { class: 'pn', text: p.name }),
        h('div', { class: 'ps', text: `${p.score} pts` }),
        h('div', { class: 'block', text: places[i] === 1 ? '🥇' : places[i] === 2 ? '🥈' : '🥉' }))
      : null)));

    const hist = state.history;
    fill($('finalTable'),
      h('thead', {}, h('tr', {},
        h('th', { text: 'Jugador' }),
        hist.map((r) => h('th', { text: `R${r.round} · ${r.letter}` })),
        h('th', { text: 'Total' }))),
      h('tbody', {}, ranking.map((p) => h('tr', {},
        h('td', { text: p.name }),
        hist.map((r) => h('td', { text: r.points[p.id] ?? '—' })),
        h('td', { class: 'tot', text: p.score })))),
    );

    const host = isHost();
    $('btnAgain').hidden = !host;
    $('btnToLobby').hidden = !host;
    $('waitAgain').hidden = host;
  }
  $('btnAgain').addEventListener('click', () => send({ type: 'start' }));
  $('btnToLobby').addEventListener('click', () => send({ type: 'lobby' }));

  // ───────────────────────── Chat de voz (WebRTC) ─────────────────────────
  // Cada persona se conecta directo con las demás (malla). El servidor solo pasa
  // los mensajes para que se encuentren; el audio no pasa por el servidor.
  const voice = {
    joined: false, muted: false, stream: null, ice: null, ctx: null,
    peers: new Map(), meters: new Map(), speaking: new Set(), lastJoinSent: 0,
  };

  async function loadIce() {
    if (voice.ice) return voice.ice;
    try {
      const r = await fetch('/ice', { cache: 'no-store' });
      voice.ice = (await r.json()).iceServers;
    } catch {
      voice.ice = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    return voice.ice;
  }

  async function voiceJoin() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
      toast('Tu navegador no permite el chat de voz.', 'error');
      return;
    }
    $('btnVoice').disabled = true;
    try {
      voice.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      $('btnVoice').disabled = false;
      toast(err && err.name === 'NotAllowedError'
        ? 'Necesito permiso para usar el micrófono. Revísalo en la configuración del navegador.'
        : 'No se pudo abrir el micrófono.', 'error');
      return;
    }
    await loadIce();
    $('btnVoice').disabled = false;
    voice.joined = true;
    voice.muted = false;
    watchLevel(state.you, voice.stream, true);
    voice.lastJoinSent = Date.now();
    send({ type: 'voiceJoin' });
    updateVoiceUI();
  }

  function voiceLeave(silent) {
    if (!voice.joined) return;
    for (const id of [...voice.peers.keys()]) closePeer(id);
    if (voice.stream) voice.stream.getTracks().forEach((t) => t.stop());
    voice.stream = null;
    for (const id of [...voice.meters.keys()]) unwatchLevel(id);
    voice.joined = false;
    if (!silent) send({ type: 'voiceLeave' });
    updateVoiceUI();
  }

  /** Después de reconectar, el servidor nos sacó de la voz: volvemos a entrar. */
  function voiceRejoin() {
    for (const id of [...voice.peers.keys()]) closePeer(id);
    voice.lastJoinSent = Date.now();
    send({ type: 'voiceJoin' });
    if (voice.muted) send({ type: 'voiceMute', muted: true });
  }

  function syncVoice() {
    updateVoiceUI();
    if (!voice.joined) return;
    const me = state.players.find((p) => p.id === state.you);
    if (me && !me.voice && Date.now() - voice.lastJoinSent > 3000) voiceRejoin();
    const others = state.players.filter((p) => p.voice && p.id !== state.you).map((p) => p.id);
    for (const id of others) if (!voice.peers.has(id)) createPeer(id);
    for (const id of [...voice.peers.keys()]) if (!others.includes(id)) closePeer(id);
  }

  function createPeer(id) {
    const initiator = state.you < id; // solo uno de los dos manda la oferta
    const pc = new RTCPeerConnection({ iceServers: voice.ice || [] });
    const peer = { pc, audio: null, pending: [], initiator };
    voice.peers.set(id, peer);
    voice.stream.getTracks().forEach((t) => pc.addTrack(t, voice.stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'rtc', to: id, signal: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (!peer.audio) {
        peer.audio = document.createElement('audio');
        peer.audio.autoplay = true;
        peer.audio.setAttribute('playsinline', '');
        document.body.append(peer.audio);
      }
      peer.audio.srcObject = stream;
      peer.audio.play().catch(() => {});
      watchLevel(id, stream, false);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && initiator && pc.restartIce) pc.restartIce();
    };
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription();
          send({ type: 'rtc', to: id, signal: { description: pc.localDescription } });
        } catch { /* se reintenta en la próxima negociación */ }
      };
    }
    return peer;
  }

  async function handleSignal(from, signal) {
    if (!voice.joined || !signal || !state) return;
    const peer = voice.peers.get(from) || createPeer(from);
    const { pc } = peer;
    try {
      if (signal.description) {
        if (signal.description.type === 'offer' && peer.initiator) return; // no debería pasar
        await pc.setRemoteDescription(signal.description);
        if (signal.description.type === 'offer') {
          await pc.setLocalDescription();
          send({ type: 'rtc', to: from, signal: { description: pc.localDescription } });
        }
        for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (signal.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate).catch(() => {});
        else peer.pending.push(signal.candidate);
      }
    } catch (err) {
      console.warn('Voz: error de señalización', err);
    }
  }

  function closePeer(id) {
    const peer = voice.peers.get(id);
    if (!peer) return;
    voice.peers.delete(id);
    try { peer.pc.close(); } catch { /* ya cerrada */ }
    if (peer.audio) {
      peer.audio.srcObject = null;
      peer.audio.remove();
    }
    unwatchLevel(id);
  }

  // Medidor de volumen para saber quién está hablando.
  function watchLevel(id, stream, isMe) {
    try {
      voice.ctx = voice.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (voice.ctx.state === 'suspended') voice.ctx.resume();
      unwatchLevel(id);
      const source = voice.ctx.createMediaStreamSource(stream);
      const analyser = voice.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      voice.meters.set(id, { source, analyser, data: new Uint8Array(analyser.fftSize), isMe });
    } catch { /* sin medidor */ }
  }

  function unwatchLevel(id) {
    const m = voice.meters.get(id);
    if (m) {
      try { m.source.disconnect(); } catch { /* ok */ }
      voice.meters.delete(id);
    }
    if (voice.speaking.delete(id)) markSpeaking(id, false);
  }

  function markSpeaking(id, on) {
    const li = document.querySelector(`#playerList li[data-id="${CSS.escape(id)}"]`);
    if (li) li.classList.toggle('speaking', on);
  }

  setInterval(() => {
    for (const [id, m] of voice.meters) {
      m.analyser.getByteTimeDomainData(m.data);
      let sum = 0;
      for (const v of m.data) sum += ((v - 128) / 128) ** 2;
      const level = Math.sqrt(sum / m.data.length);
      const on = level > 0.03 && !(m.isMe && voice.muted);
      if (on !== voice.speaking.has(id)) {
        if (on) voice.speaking.add(id);
        else voice.speaking.delete(id);
        markSpeaking(id, on);
      }
    }
  }, 150);

  function updateVoiceUI() {
    const inVoice = state ? state.players.filter((p) => p.voice).length : 0;
    $('voiceCount').textContent = state ? `(${inVoice}/${state.limits.maxVoice})` : '';
    $('btnVoice').textContent = voice.joined ? 'Salir de la voz' : 'Entrar a la voz';
    $('btnVoice').classList.toggle('btn-blue', !voice.joined);
    $('btnVoice').classList.toggle('btn-ghost', voice.joined);
    $('btnMute').hidden = !voice.joined;
    $('btnMute').textContent = voice.muted ? '🔇 Activar micrófono' : '🎤 Silenciarme';
    $('btnMute').classList.toggle('on', voice.muted);
    $('voiceHint').textContent = voice.joined
      ? (inVoice > 1 ? `Estás hablando con ${inVoice - 1} ${inVoice - 1 === 1 ? 'persona' : 'personas'}.` : 'Estás en la voz. Esperando que alguien más entre…')
      : 'Habla con los demás mientras juegan. Usa audífonos para que no haya eco.';
  }

  $('btnVoice').addEventListener('click', () => (voice.joined ? voiceLeave(false) : voiceJoin()));
  $('btnMute').addEventListener('click', () => {
    voice.muted = !voice.muted;
    if (voice.stream) voice.stream.getAudioTracks().forEach((t) => { t.enabled = !voice.muted; });
    send({ type: 'voiceMute', muted: voice.muted });
    updateVoiceUI();
  });

  // ───────────────────────── Reloj ─────────────────────────
  let lastSecond = null;

  function tick() {
    if (!state || !state.endsAt) return;
    const remaining = Math.max(0, state.endsAt - (Date.now() + clockOffset));
    const seconds = Math.ceil(remaining / 1000);

    if (state.phase === 'review') {
      updateReadyInfo();
    } else if (state.phase === 'countdown') {
      const n = Math.max(1, seconds);
      $('cdNumber').textContent = n;
      if (n !== lastSecond) sounds.tick();
      lastSecond = n;
    } else if (state.phase === 'playing') {
      const total = state.settings.roundTime * 1000;
      $('timerText').textContent = seconds;
      $('timerFill').style.width = `${(remaining / total) * 100}%`;
      const timer = $('timerText').closest('.timer');
      timer.classList.toggle('warn', seconds <= 15 && seconds > 5);
      timer.classList.toggle('danger', seconds <= 5);
      if (seconds <= 5 && seconds > 0 && seconds !== lastSecond) sounds.warn();
      lastSecond = seconds;
    }
  }
  setInterval(tick, 200);

  // Mantener viva la conexión en celulares que duermen la pestaña.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session && !ws && allowReconnect) connect();
  });

  // ───────────────────────── Arranque ─────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  updateSoundButton();
  $('nameInput').value = storage.get('localStorage', 'stop.name') || '';
  const params = new URLSearchParams(location.search);
  const codeParam = (params.get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (codeParam) $('codeInput').value = codeParam;

  if (session && (!codeParam || codeParam === session.code)) {
    connect(); // volver a la sala después de recargar la página
  } else {
    saveSession(null);
    startLobby();
    if (codeParam) ($('nameInput').value ? $('btnJoin') : $('nameInput')).focus();
  }
})();
