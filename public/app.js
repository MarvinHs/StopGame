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
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handle(msg);
    });

    ws.addEventListener('close', () => {
      ws = null;
      if (!allowReconnect || (!session && !pending)) return;
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
        saveSession({ code: msg.code, playerId: msg.playerId, token: msg.token });
        history.replaceState(null, '', `?sala=${msg.code}`);
        break;
      case 'state':
        clockOffset = msg.state.serverNow - Date.now();
        render(msg.state);
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
    $('roundInfo').textContent = state.phase === 'lobby' ? 'En la sala' : state.phase === 'final' ? 'Partida terminada' : `Ronda ${state.round} de ${state.settings.rounds}`;

    for (const [phase, id] of Object.entries(PHASE_SECTIONS)) $(id).hidden = phase !== state.phase;

    const key = `${state.phase}:${state.round}`;
    const changed = key !== lastKey;
    lastKey = key;

    if (changed) onPhaseEnter(state.phase, prev ? prev.phase : null);

    renderPlayers();
    renderChat();

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
        controls.push(h('button', {
          class: 'mini-btn', title: 'Hacer host', text: '👑',
          onclick: () => send({ type: 'makeHost', playerId: p.id }),
        }));
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

      list.append(h('li', { class: p.connected ? '' : 'off' },
        h('span', { class: `dot ${p.connected ? '' : 'off'}`, title: p.connected ? 'Conectado' : 'Desconectado' }),
        h('span', { class: 'pname', text: p.name }),
        p.id === state.hostId ? h('span', { class: 'badge', text: 'HOST' }) : null,
        me ? h('span', { class: 'badge you', text: 'TÚ' }) : null,
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

    $('btnStart').hidden = !host;
    $('waitHost').hidden = host;
  }

  $('btnStart').addEventListener('click', () => {
    if (state.players.length < 2) toast('Estás solo en la sala. Invita a alguien con el botón 🔗 (igual puedes practicar).');
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
        } else if (cell.votable) {
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

    const host = isHost();
    $('btnConfirm').hidden = !host;
    $('btnConfirm').textContent = state.round >= state.settings.rounds ? 'Confirmar y ver ganador 🏆' : 'Confirmar puntos y seguir ▶';
    $('waitConfirm').hidden = host;
  }

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

  // ───────────────────────── Reloj ─────────────────────────
  let lastSecond = null;

  function tick() {
    if (!state || !state.endsAt) return;
    const remaining = Math.max(0, state.endsAt - (Date.now() + clockOffset));
    const seconds = Math.ceil(remaining / 1000);

    if (state.phase === 'countdown') {
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
  updateSoundButton();
  $('nameInput').value = storage.get('localStorage', 'stop.name') || '';
  const params = new URLSearchParams(location.search);
  const codeParam = (params.get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (codeParam) $('codeInput').value = codeParam;

  if (session && (!codeParam || codeParam === session.code)) {
    connect(); // volver a la sala después de recargar la página
  } else {
    saveSession(null);
    if (codeParam) ($('nameInput').value ? $('btnJoin') : $('nameInput')).focus();
  }
})();
