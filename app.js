(() => {
  'use strict';

  const SIZE = 4;
  const STORAGE_KEY = 'ma-shang-kai-wan-2048-leaderboards-v1';
  const BACKUP_KEY = 'ma-shang-kai-wan-2048-leaderboards-backup-v1';
  const SETTINGS_KEY = 'ma-shang-kai-wan-2048-settings-v1';
  const defaults = { solo: 30, duo: 45 };
  const legacyDefaults = { solo: 20, duo: 30 };
  const $ = (selector) => document.querySelector(selector);
  const boardEl = $('#board');
  const tileLayer = boardEl.querySelector('.tile-layer');
  const scorePopLayer = boardEl.querySelector('.score-pop-layer');
  const scoreEl = $('#score');
  const timerEl = $('#timer');
  const maxTileEl = $('#max-tile');
  const timerBox = document.querySelector('.timer');
  const overlay = $('#game-overlay');
  const overlayAction = $('#overlay-action');
  const startButton = $('#start-button');
  const restartButton = $('#restart-button');
  const pendingResultButton = $('#pending-result-button');
  const durationInput = $('#duration-input');
  const durationMinus = $('#duration-minus');
  const durationPlus = $('#duration-plus');
  const modeSwitch = $('.mode-switch');
  const boardWrap = $('.board-wrap');
  const guideText = $('#guide-text');
  const wasdToggle = $('#wasd-toggle');
  const leaderboardTitle = $('#leaderboard-title');
  const leaderboardEl = $('#leaderboard');
  const leaderboardEmpty = $('#leaderboard-empty');
  const leaderboardStatus = $('#leaderboard-status');
  const backupLeaderboardButton = $('#backup-leaderboard');
  const restoreLeaderboardButton = $('#restore-leaderboard');
  const clearLeaderboardButton = $('#clear-leaderboard');
  const resultDialog = $('#result-dialog');
  const resultForm = $('#result-form');
  const resultScore = $('#result-score');
  const resultMax = $('#result-max');
  const resultRank = $('#result-rank');
  const resultTitle = $('#result-title');
  const playerName = $('#player-name');
  const submitHint = $('#submit-hint');
  const overlayTitle = $('#overlay-title');
  const overlayMessage = $('#overlay-message');

  let mode = 'solo'; let duration = defaults.solo; let wasdEnabled = false; let tiles = []; let nextId = 1; let score = 0; let maxTile = 0;
  let running = false; let modeSwitching = false; let modeSwitchTimer = null; let endAt = 0; let timerId = null; let lastResult = null; let submitted = false; let gameVersion = 0;
  let touchStartX = 0; let touchStartY = 0; let touchPointerId = null; let gestureStartedAt = 0;
  let remoteLeaderboards = null; let adminTokenValue = '';
  const domTiles = new Map();
  const memoryStorage = new Map();

  const loadJson = (key, fallback) => { if (memoryStorage.has(key)) return memoryStorage.get(key); try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } };
  const saveJson = (key, value) => { memoryStorage.set(key, value); try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 离线文件或存储受限时，本次页面仍可继续使用。 */ } };
  const leaderboards = () => remoteLeaderboards || loadJson(STORAGE_KEY, { solo: [], duo: [] });
  const localLeaderboards = () => loadJson(STORAGE_KEY, { solo: [], duo: [] });
  async function apiRequest(endpoint, options = {}) {
    if (window.location.protocol === 'file:') throw new Error('offline');
    const response = await fetch(endpoint, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `http_${response.status}`);
    return body;
  }
  function setRemoteLeaderboards(data) {
    if (!data || !Array.isArray(data.solo) || !Array.isArray(data.duo)) return false;
    remoteLeaderboards = { solo: data.solo, duo: data.duo }; saveJson(STORAGE_KEY, remoteLeaderboards); return true;
  }
  async function syncServerLeaderboards() {
    try { const data = await apiRequest('/api/leaderboard'); if (setRemoteLeaderboards(data)) { setLeaderboardStatus('已连接现场排行榜'); renderLeaderboard(); } }
    catch (_) { setLeaderboardStatus('离线模式：成绩保存在本机'); }
  }
  const emptyBoard = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

  function tileGeometry(tile) {
    const gap = Number.parseFloat(getComputedStyle(boardEl).getPropertyValue('--gap')) || 12;
    const cell = (tileLayer.clientWidth - (gap * 3)) / SIZE;
    return { left: tile.c * (cell + gap), top: tile.r * (cell + gap), cell };
  }
  function positionClass(position) {
    // Activity state uses { c, r }; the upstream Tile uses { x, y }.
    const x = position.c ?? position.x;
    const y = position.r ?? position.y;
    return `tile-position-${x + 1}-${y + 1}`;
  }
  function positionTile(element, tile) {
    const geometry = tileGeometry(tile);
    element.style.left = '0px'; element.style.top = '0px';
    element.style.width = `${geometry.cell}px`; element.style.height = `${geometry.cell}px`;
  }
  function tileClass(value) { return value <= 2048 ? `tile tile-${value}` : 'tile tile-super'; }
  function createTile(tile, animate = false) {
    const element = document.createElement('div');
    const position = tile.previousPosition || tile;
    const classes = [tileClass(tile.value), positionClass(position)];
    if (tile.previousPosition) {
      // Match the upstream HTMLActuator: render at the saved position first,
      // then replace the position class on the next frame.
      window.requestAnimationFrame(() => {
        classes[1] = positionClass(tile);
        element.className = classes.join(' ');
      });
    } else if (tile.mergedFrom) {
      classes.push('tile-merged');
      // Add the source tiles before the merged result so the result remains
      // the top layer, exactly as in the upstream actuator.
      tile.mergedFrom.forEach((source) => createTile(source, false));
    } else if (animate) {
      classes.push('tile-new');
    }
    element.className = classes.join(' ');
    element.dataset.id = tile.id;
    element.setAttribute('role', 'gridcell');
    element.setAttribute('aria-label', String(tile.value));
    const inner = document.createElement('div');
    inner.className = 'tile-inner';
    inner.textContent = tile.value;
    element.appendChild(inner);
    positionTile(element, tile);
    domTiles.set(tile.id, element);
    tileLayer.appendChild(element);
    return element;
  }
  function renderStatic() { tileLayer.replaceChildren(); domTiles.clear(); tiles.forEach((tile) => createTile(tile)); scoreEl.textContent = score; maxTileEl.textContent = maxTile || '—'; }
  function showScorePop(amount, tile) {
    if (!amount || !tile) return;
    const pop = document.createElement('span');
    pop.className = 'score-pop';
    pop.textContent = `+${amount}`;
    pop.style.setProperty('--pop-col', tile.c);
    pop.style.setProperty('--pop-row', tile.r);
    const gap = Number.parseFloat(getComputedStyle(boardEl).getPropertyValue('--gap')) || 12;
    const cell = (tileLayer.clientWidth - (gap * 3)) / SIZE;
    pop.style.left = `${tile.c * (cell + gap) + cell / 2}px`;
    pop.style.top = `${tile.r * (cell + gap) + cell / 2}px`;
    scorePopLayer.appendChild(pop);
    setTimeout(() => pop.remove(), 620);
  }
  function randomInt(max) {
    if (max <= 0) return 0;
    const cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const range = 0x100000000;
      const limit = range - (range % max);
      const sample = new Uint32Array(1);
      do { cryptoApi.getRandomValues(sample); } while (sample[0] >= limit);
      return sample[0] % max;
    }
    return Math.floor(Math.random() * max);
  }
  function randomEmptyCell() {
    const occupied = new Set(tiles.map((tile) => `${tile.r},${tile.c}`));
    const cells = [];
    for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) if (!occupied.has(`${r},${c}`)) cells.push([r, c]);
    return cells.length ? cells[randomInt(cells.length)] : null;
  }
  function addRandomTile() {
    const cell = randomEmptyCell();
    if (!cell) return null;
    const tile = { id: nextId++, value: randomInt(10) === 0 ? 4 : 2, r: cell[0], c: cell[1], spawned: true };
    tiles.push(tile);
    return tile;
  }
  function initBoard() { tiles = []; nextId = 1; score = 0; maxTile = 0; addRandomTile(); addRandomTile(); maxTile = Math.max(...tiles.map((tile) => tile.value)); scorePopLayer.replaceChildren(); renderStatic(); }
  function tileAt(r, c) { return tiles.find((tile) => tile.r === r && tile.c === c); }
  function valueBoard() { const values = emptyBoard(); tiles.forEach((tile) => { values[tile.r][tile.c] = tile.value; }); return values; }
  function canMove() { const values = valueBoard(); for (let r = 0; r < SIZE; r += 1) for (let c = 0; c < SIZE; c += 1) { if (!values[r][c]) return true; if (c < SIZE - 1 && values[r][c] === values[r][c + 1]) return true; if (r < SIZE - 1 && values[r][c] === values[r + 1][c]) return true; } return false; }
  function orderedLine(index, direction) { const cells = []; for (let i = 0; i < SIZE; i += 1) { const r = direction === 'left' || direction === 'right' ? index : i; const c = direction === 'left' || direction === 'right' ? i : index; cells.push([r, c]); } if (direction === 'right' || direction === 'down') cells.reverse(); return cells; }
  // Adapt the upstream Grid/Tile traversal to the activity UI's animation
  // metadata. The DOM and timer stay activity-specific; movement and merge
  // ordering follow the original 2048 engine.
  function calculateMove(direction) {
    const vectors = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
    const vector = vectors[direction];
    const grid = new Grid(SIZE);
    tiles.forEach((source) => {
      const tile = new Tile({ x: source.c, y: source.r }, source.value);
      tile.id = source.id;
      grid.insertTile(tile);
    });

    const traversals = { x: [], y: [] };
    for (let position = 0; position < SIZE; position += 1) { traversals.x.push(position); traversals.y.push(position); }
    if (vector.x === 1) traversals.x.reverse();
    if (vector.y === 1) traversals.y.reverse();

    const moves = []; const merged = []; let gained = 0;
    const moveTile = (tile, cell) => {
      grid.cells[tile.x][tile.y] = null;
      grid.cells[cell.x][cell.y] = tile;
      tile.updatePosition(cell);
    };
    const farthestPosition = (cell) => {
      let previous;
      do {
        previous = cell;
        cell = { x: previous.x + vector.x, y: previous.y + vector.y };
      } while (grid.withinBounds(cell) && grid.cellAvailable(cell));
      return { farthest: previous, next: cell };
    };

    traversals.x.forEach((x) => traversals.y.forEach((y) => {
      const cell = { x, y }; const tile = grid.cellContent(cell);
      if (!tile) return;
      const positions = farthestPosition(cell); const nextTile = grid.cellContent(positions.next);
      if (nextTile && nextTile.value === tile.value && !nextTile.mergedFrom) {
        const result = new Tile(positions.next, tile.value * 2);
        result.id = tile.id;
        result.mergedFrom = [tile, nextTile];
        grid.insertTile(result); grid.removeTile(tile); tile.updatePosition(positions.next);
        moves.push({ id: tile.id, r: positions.next.y, c: positions.next.x });
        moves.push({ id: nextTile.id, r: positions.next.y, c: positions.next.x });
        merged.push({ primary: { id: result.id, value: result.value, r: result.y, c: result.x, spawned: false }, consumed: nextTile.id });
        gained += result.value;
      } else {
        moveTile(tile, positions.farthest);
        moves.push({ id: tile.id, r: positions.farthest.y, c: positions.farthest.x });
      }
    }));

    const next = []; grid.eachCell((x, y, tile) => { if (tile) next.push({ id: tile.id, value: tile.value, r: y, c: x, spawned: false }); });
    const changed = moves.some((move) => { const old = tiles.find((tile) => tile.id === move.id); return old && (old.r !== move.r || old.c !== move.c); });
    return { next, moves, merged, gained, changed };
  }
  function animateMove(result) {
    // Upstream processes key events synchronously; the browser animates the
    // freshly rendered actuator layer independently of game state updates.
    const version = gameVersion;
    const nextTiles = result.next.map((tile) => ({ ...tile }));
    const mergeByPrimary = new Map(result.merged.map((merge) => [merge.primary.id, merge]));
    const consumedIds = new Set(result.merged.map((merge) => merge.consumed));
    const occupied = new Set(nextTiles.map((tile) => tile.r + ',' + tile.c));
    const emptyCells = [];
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        if (!occupied.has(r + ',' + c)) emptyCells.push([r, c]);
      }
    }

    let spawned = null;
    if (emptyCells.length) {
      const cell = emptyCells[randomInt(emptyCells.length)];
      spawned = { id: nextId++, value: randomInt(10) === 0 ? 4 : 2, r: cell[0], c: cell[1], spawned: true };
    }

    score += result.gained;
    nextTiles.forEach((tile) => { if (tile.value > maxTile) maxTile = tile.value; });
    if (spawned && spawned.value > maxTile) maxTile = spawned.value;
    scoreEl.textContent = score;
    maxTileEl.textContent = maxTile || '\u2014';
    if (result.gained) showScorePop(result.gained, result.merged[0] && result.merged[0].primary);

    // This follows the upstream HTMLActuator: clear the tile layer, render
    // source tiles at their saved positions, then let the next animation frame
    // switch them to their destination position classes.
    tileLayer.replaceChildren();
    domTiles.clear();
    nextTiles.forEach((tile) => {
      const merge = mergeByPrimary.get(tile.id);
      if (merge) {
        const primarySource = tiles.find((source) => source.id === tile.id);
        const consumedSource = tiles.find((source) => source.id === merge.consumed);
        const mergedTile = {
          id: 'merge-' + tile.id + '-' + version,
          value: tile.value,
          r: tile.r,
          c: tile.c,
          mergedFrom: [
            { id: primarySource.id, value: primarySource.value, r: tile.r, c: tile.c, previousPosition: { x: primarySource.c, y: primarySource.r } },
            { id: consumedSource.id, value: consumedSource.value, r: tile.r, c: tile.c, previousPosition: { x: consumedSource.c, y: consumedSource.r } }
          ]
        };
        createTile(mergedTile, false);
        return;
      }
      if (consumedIds.has(tile.id)) return;
      const previous = tiles.find((source) => source.id === tile.id);
      createTile({ ...tile, previousPosition: { x: previous.c, y: previous.r } }, false);
    });
    if (spawned) createTile(spawned, true);
    tiles = spawned ? nextTiles.concat(spawned) : nextTiles;
    if (running && performance.now() >= endAt) finishGame('time');
    else if (!canMove()) finishGame('no-moves');
  }
  function move(direction) {
    if (!running) return;
    if (performance.now() >= endAt) { finishGame('time'); return; }
    const result = calculateMove(direction);
    if (!result.changed) return;
    animateMove(result);
  }
  function normalizeDuration() { const parsed = Number.parseInt(durationInput.value, 10); const value = Math.max(5, Math.min(180, Number.isFinite(parsed) ? parsed : defaults[mode])); durationInput.value = value; duration = value; const settings = loadJson(SETTINGS_KEY, {}); settings[mode] = value; saveJson(SETTINGS_KEY, settings); updateTimerDisplay(duration * 1000); }
  function previewDuration() { const value = Number.parseInt(durationInput.value, 10); updateTimerDisplay(Math.max(5, Math.min(180, Number.isFinite(value) ? value : duration)) * 1000); }
  function resultRankFor(result) { const entries = leaderboards()[result.mode] || []; const candidate = { score: result.score, maxTile: result.maxTile, at: result.at }; const ranked = [...entries, candidate].sort((a, b) => b.score - a.score || b.maxTile - a.maxTile || a.at - b.at); const rank = ranked.indexOf(candidate) + 1; return rank <= 5 ? rank : null; }
  function setModeControls(disabled) { document.querySelectorAll('.mode-button').forEach((button) => { button.disabled = disabled; }); durationInput.disabled = disabled; durationMinus.disabled = disabled; durationPlus.disabled = disabled; if (wasdToggle) wasdToggle.disabled = disabled; }
  function setLeaderboardControls(disabled) { [backupLeaderboardButton, restoreLeaderboardButton, clearLeaderboardButton].forEach((button) => { if (button) button.disabled = disabled; }); }
  function readyGuideText() { const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0; if (touchDevice) return mode === 'solo' ? '\u6ed1\u52a8\u68cb\u76d8\u63a7\u5236\u79fb\u52a8' : '\u53cc\u4eba\u6a21\u5f0f\u8bf7\u4f7f\u7528\u5206\u5de5\u6309\u952e'; if (mode === 'solo') return wasdEnabled ? '\u65b9\u5411\u952e / WASD \u63a7\u5236\u79fb\u52a8' : '\u65b9\u5411\u952e\u63a7\u5236\u79fb\u52a8'; return wasdEnabled ? '\u7532 W/S \u00b7 \u4e59 A/D' : '\u7532 \u2191\u2193 \u00b7 \u4e59 \u2190\u2192'; }
  function playingGuideText() { const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0; if (touchDevice) return mode === 'solo' ? '\u6ed1\u52a8\u68cb\u76d8\u64cd\u4f5c' : '\u53cc\u4eba\u6a21\u5f0f\u8bf7\u4f7f\u7528\u5206\u5de5\u6309\u952e'; if (mode === 'solo') return wasdEnabled ? '\u65b9\u5411\u952e / WASD \u64cd\u4f5c' : '\u65b9\u5411\u952e\u64cd\u4f5c'; return wasdEnabled ? '\u7532 W/S \u00b7 \u4e59 A/D' : '\u7532 \u2191\u2193 \u00b7 \u4e59 \u2190\u2192'; }
  function resetToReady() {
    if (running) {
      if (!window.confirm('\u786e\u5b9a\u7ed3\u675f\u672c\u5c40\u5e76\u8fd4\u56de\u51c6\u5907\u754c\u9762\u5417\uff1f\u5f53\u524d\u6210\u7ee9\u4ecd\u53ef\u4fdd\u5b58\u3002')) return;
      finishGame('stopped');
      return;
    }
    if (lastResult && !submitted && !window.confirm('\u4e0a\u4e00\u5c40\u6210\u7ee9\u5c1a\u672a\u4fdd\u5b58\uff0c\u786e\u5b9a\u653e\u5f03\u8fd9\u6761\u6210\u7ee9\u5e76\u91cd\u65b0\u51c6\u5907\u5417\uff1f')) return;
    if (modeSwitchTimer) { window.clearTimeout(modeSwitchTimer); modeSwitchTimer = null; }
    modeSwitching = false; boardWrap.classList.remove('turn-out', 'turn-in'); boardWrap.classList.add('ready-stage');
    gameVersion += 1;
    running = false;

    normalizeDuration();
    if (timerId) cancelAnimationFrame(timerId);
    timerId = null;
    initBoard();
    updateTimerDisplay(duration * 1000);
    overlayTitle.textContent = '准备开始';
    overlayMessage.textContent = '准备好后点击开始，计时才会正式启动。';
    overlay.classList.add('visible');
    startButton.disabled = false;
    restartButton.disabled = true;
    restartButton.textContent = '重来';
    setModeControls(false);
    setLeaderboardControls(false);
    guideText.textContent = readyGuideText();
    lastResult = null;
    submitted = false;
    pendingResultButton.hidden = true;
    document.body.classList.remove('is-playing');
    boardEl.blur();
  }
  function updateModeUi() { modeSwitch.classList.toggle('is-duo', mode === 'duo'); boardEl.classList.toggle('mode-solo', mode === 'solo'); boardEl.classList.toggle('mode-duo', mode === 'duo'); document.querySelectorAll('.mode-button').forEach((button) => { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); }); const settings = loadJson(SETTINGS_KEY, {}); const savedDuration = Number(settings[mode]); duration = Number.isFinite(savedDuration) && savedDuration >= 5 && savedDuration <= 180 && savedDuration !== legacyDefaults[mode] ? savedDuration : defaults[mode]; settings[mode] = duration; saveJson(SETTINGS_KEY, settings); durationInput.value = duration; wasdEnabled = settings.wasd === true; if (wasdToggle) wasdToggle.checked = wasdEnabled; leaderboardTitle.textContent = mode === 'solo' ? '单人' : '双人'; guideText.textContent = readyGuideText(); renderLeaderboard(); updateTimerDisplay(duration * 1000); }
  function updateTimerDisplay(ms) { const seconds = Math.max(0, ms / 1000); timerEl.textContent = seconds.toFixed(1); timerBox.classList.toggle('urgent', seconds <= 5 && seconds > 0); }
  function tick() { if (!running) return; const remaining = endAt - performance.now(); updateTimerDisplay(remaining); if (remaining <= 0) { finishGame('time'); return; } timerId = requestAnimationFrame(tick); }
  function startGame() { if (running) return; if (lastResult && !submitted && !window.confirm('\u4e0a\u4e00\u5c40\u6210\u7ee9\u5c1a\u672a\u4fdd\u5b58\uff0c\u786e\u5b9a\u653e\u5f03\u8fd9\u6761\u6210\u7ee9\u5e76\u5f00\u59cb\u65b0\u5c40\u5417\uff1f')) return; if (lastResult && !submitted) { lastResult = null; pendingResultButton.hidden = true; } if (modeSwitchTimer) { window.clearTimeout(modeSwitchTimer); modeSwitchTimer = null; } modeSwitching = false; boardWrap.classList.remove('ready-stage'); gameVersion += 1; normalizeDuration(); initBoard(); running = true; submitted = false; endAt = performance.now() + duration * 1000; overlay.classList.remove('visible'); startButton.disabled = true; restartButton.disabled = false; restartButton.textContent = '\u7ed3\u675f\u672c\u5c40'; restartButton.title = '\u7ed3\u675f\u672c\u5c40\u524d\u9700\u8981\u786e\u8ba4'; setModeControls(true); setLeaderboardControls(true); guideText.textContent = playingGuideText(); document.body.classList.add('is-playing'); timerId = requestAnimationFrame(tick); boardEl.focus(); }
  function finishGame(reason) { if (!running) return; gameVersion += 1; running = false; cancelAnimationFrame(timerId); timerId = null; updateTimerDisplay(0); startButton.disabled = false; restartButton.disabled = false; restartButton.textContent = '\u91cd\u6765'; restartButton.title = ''; setModeControls(false); setLeaderboardControls(false); guideText.textContent = readyGuideText() + ' \u00b7 \u70b9\u51fb\u91cd\u6765\u91cd\u65b0\u51c6\u5907'; document.body.classList.remove('is-playing'); lastResult = { mode, score, maxTile, duration, reason, at: Date.now() }; pendingResultButton.hidden = true; resultScore.textContent = score; resultMax.textContent = maxTile || '\u2014'; const rank = resultRankFor(lastResult); resultRank.textContent = rank ? '\u8fdb\u5165' + (mode === 'solo' ? '\u5355\u4eba' : '\u53cc\u4eba') + '\u699c \u00b7 \u7b2c ' + rank + ' \u540d' : '\u672c\u5c40\u672a\u8fdb\u5165\u524d\u4e94'; resultTitle.textContent = reason === 'no-moves' ? '\u68cb\u76d8\u5df2\u6ee1' : reason === 'stopped' ? '\u672c\u5c40\u5df2\u7ed3\u675f' : '\u65f6\u95f4\u5230'; submitted = false; playerName.value = ''; submitHint.textContent = '\u53ef\u7a0d\u540e\u4fdd\u5b58\uff0c\u5173\u95ed\u5f39\u7a97\u4e5f\u4e0d\u4f1a\u4e22\u5931'; if (typeof resultDialog.showModal === 'function') resultDialog.showModal(); else resultDialog.setAttribute('open', ''); }
  function backupSnapshot() { return { savedAt: new Date().toISOString(), data: leaderboards() }; }
  function saveLeaderboardBackup() { const snapshot = backupSnapshot(); saveJson(BACKUP_KEY, snapshot); return snapshot; }
  function downloadLeaderboardBackup(snapshot) {
    try {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `码上开玩-2048排行榜备份-${snapshot.savedAt.slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (_) { /* 本机备份仍然保留 */ }
  }
  function setLeaderboardStatus(message) { if (leaderboardStatus) leaderboardStatus.textContent = message; }
  function renderLeaderboard() {
    const data = (leaderboards()[mode] || []).slice(0, 5); const highest = Math.max(1, ...data.map((entry) => Number(entry.score) || 0));
    leaderboardEl.replaceChildren(); leaderboardEmpty.hidden = data.length > 0;
    data.forEach((entry, index) => {
      const item = document.createElement('li'); item.className = `rank-${index + 1}${index === 0 ? ' rank-top' : ''}`;
      item.style.setProperty('--score-ratio', `${Math.max(index === 0 ? 14 : 7, ((Number(entry.score) || 0) / highest) * 100)}%`);
      const main = document.createElement('div'); main.className = 'leader-main';
      const name = document.createElement('span'); name.className = 'leader-name'; name.textContent = entry.name;
      const meta = document.createElement('span'); meta.className = 'leader-meta'; meta.textContent = '最高 ' + (entry.maxTile || '—') + '  ·  ' + (entry.duration || '—') + ' 秒'; const bar = document.createElement('span'); bar.className = 'leader-bar'; const fill = document.createElement('i'); bar.appendChild(fill); main.append(name, meta, bar);
      const value = document.createElement('span'); value.className = 'leader-score'; value.textContent = String(entry.score);
      const max = document.createElement('small'); max.textContent = entry.maxTile || '—'; value.appendChild(max);
      item.append(main, value); leaderboardEl.appendChild(item);
    });
    restoreLeaderboardButton.hidden = !loadJson(BACKUP_KEY, null);
  }
  async function adminRequest(endpoint, payload) {
    if (!adminTokenValue) adminTokenValue = window.prompt('请输入排行榜管理员密钥');
    if (!adminTokenValue) throw new Error('cancelled');
    return apiRequest(endpoint, { method: 'POST', headers: { 'X-Admin-Token': adminTokenValue }, body: JSON.stringify(payload || {}) });
  }
  async function backupLeaderboard() {
    const snapshot = saveLeaderboardBackup(); downloadLeaderboardBackup(snapshot);
    try { await adminRequest('/api/admin/backup'); setLeaderboardStatus('已备份现场排行榜'); }
    catch (_) { setLeaderboardStatus('已下载本机备份服务器备份未连接'); }
    renderLeaderboard();
  }
  async function clearLeaderboard() {
    if (!confirm('清空前会自动备份当前排行榜。确定清空吗')) return;
    const snapshot = saveLeaderboardBackup(); downloadLeaderboardBackup(snapshot);
    try {
      const result = await adminRequest('/api/admin/clear'); setRemoteLeaderboards(result.data); setLeaderboardStatus('已备份并清空现场排行榜');
    } catch (_) { saveJson(STORAGE_KEY, { solo: [], duo: [] }); remoteLeaderboards = { solo: [], duo: [] }; setLeaderboardStatus('已备份并清空本机排行榜'); }
    renderLeaderboard();
  }
  async function restoreLeaderboard() {
    const snapshot = loadJson(BACKUP_KEY, null); if (!snapshot || !snapshot.data) return;
    if (!confirm('将恢复最近一次备份并覆盖当前排行榜。确定恢复吗')) return;
    try { const result = await adminRequest('/api/admin/restore', { data: snapshot.data }); setRemoteLeaderboards(result.data); setLeaderboardStatus('已恢复现场排行榜'); }
    catch (_) { setRemoteLeaderboards({ solo: snapshot.data.solo || [], duo: snapshot.data.duo || [] }); setLeaderboardStatus('已恢复本机备份'); }
    renderLeaderboard();
  }
  async function submitScore() {
    if (!lastResult || submitted) return;
    submitted = true;
    pendingResultButton.hidden = true;
    const name = (playerName.value.trim() || '匿名玩家').slice(0, 12);
    const entry = { mode: lastResult.mode, name, score: lastResult.score, maxTile: lastResult.maxTile, duration: lastResult.duration };
    try {
      const result = await apiRequest('/api/scores', { method: 'POST', body: JSON.stringify(entry) });
      if (result.mode && Array.isArray(result.entries)) { const all = leaderboards(); all[result.mode] = result.entries; setRemoteLeaderboards(all); }
      submitHint.textContent = result.accepted ? '已保存到现场排行榜' : '成绩已记录';
    } catch (_) {
      const all = localLeaderboards(); all[lastResult.mode] = [...(all[lastResult.mode] || []), { ...entry, at: lastResult.at }].sort((a, b) => b.score - a.score || b.maxTile - a.maxTile || a.at - b.at).slice(0, 5); saveJson(STORAGE_KEY, all); remoteLeaderboards = all;
      submitHint.textContent = '服务器暂时不可用已保存到本机';
    }
    renderLeaderboard(); setTimeout(() => { if (resultDialog.open) resultDialog.close(); }, 500);
  }
  function dismissResultDialog() {
    if (!lastResult || submitted) { if (resultDialog.open) resultDialog.close(); return; }
    pendingResultButton.hidden = false;
    submitHint.textContent = '本局成绩尚未保存点击保存上一局成绩可继续提交';
    if (resultDialog.open) resultDialog.close();
  }

  document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => {
    if (running || modeSwitching || button.dataset.mode === mode) return;
    modeSwitching = true;
    boardWrap.classList.remove('turn-in');
    boardWrap.classList.add('turn-out');
    modeSwitchTimer = window.setTimeout(() => {
      mode = button.dataset.mode;
      updateModeUi();
      initBoard();
      boardWrap.classList.remove('turn-out');
      boardWrap.classList.add('turn-in');
      modeSwitchTimer = window.setTimeout(() => { boardWrap.classList.remove('turn-in'); modeSwitching = false; modeSwitchTimer = null; }, 360);
    }, 150);
  }));
  durationMinus.addEventListener('click', () => { durationInput.value = Math.max(5, (Number.parseInt(durationInput.value, 10) || defaults[mode]) - 5); normalizeDuration(); });
  durationPlus.addEventListener('click', () => { durationInput.value = Math.min(180, (Number.parseInt(durationInput.value, 10) || defaults[mode]) + 5); normalizeDuration(); });
  durationInput.addEventListener('input', previewDuration); durationInput.addEventListener('change', normalizeDuration); startButton.addEventListener('click', startGame); restartButton.addEventListener('click', resetToReady); overlayAction.addEventListener('click', startGame);
  $('#submit-score').addEventListener('click', (event) => { event.preventDefault(); submitScore(); }); $('#close-dialog').addEventListener('click', dismissResultDialog); pendingResultButton.addEventListener('click', () => { if (!lastResult || submitted) return; pendingResultButton.hidden = true; resultDialog.showModal?.(); }); resultDialog.addEventListener('cancel', (event) => { event.preventDefault(); dismissResultDialog(); }); resultForm.addEventListener('submit', (event) => { event.preventDefault(); submitScore(); });
  backupLeaderboardButton.addEventListener('click', backupLeaderboard); restoreLeaderboardButton.addEventListener('click', restoreLeaderboard); clearLeaderboardButton.addEventListener('click', clearLeaderboard);
  wasdToggle?.addEventListener('change', () => { if (running) return; wasdEnabled = wasdToggle.checked; const settings = loadJson(SETTINGS_KEY, {}); settings.wasd = wasdEnabled; saveJson(SETTINGS_KEY, settings); guideText.textContent = readyGuideText(); });
  document.addEventListener('keydown', (event) => { if (!running) return; const directions = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }; if (wasdEnabled) Object.assign(directions, { w: 'up', s: 'down', a: 'left', d: 'right' }); const direction = directions[event.key.length === 1 ? event.key.toLowerCase() : event.key]; if (!direction) return; event.preventDefault(); move(direction); });
  const swipeConfig = { minDistance: 22, axisBias: 1.12, maxDuration: 900 };
  function clearGesture() { touchPointerId = null; }
  function beginGesture(pointerId, clientX, clientY) {
    if (!running || mode === 'duo' || touchPointerId !== null) return false;
    touchPointerId = pointerId; touchStartX = clientX; touchStartY = clientY; gestureStartedAt = performance.now();
    return true;
  }
  function endGesture(pointerId, clientX, clientY, event) {
    if (pointerId !== touchPointerId) return;
    const dx = clientX - touchStartX; const dy = clientY - touchStartY;
    clearGesture();
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const threshold = Math.max(swipeConfig.minDistance, Math.min(38, boardEl.clientWidth * .075));
    const dominant = Math.max(Math.abs(dx), Math.abs(dy));
    const secondary = Math.min(Math.abs(dx), Math.abs(dy));
    if (performance.now() - gestureStartedAt > swipeConfig.maxDuration || distance < threshold || dominant < secondary * swipeConfig.axisBias) return;
    if (event.cancelable) event.preventDefault();
    move(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }
  if ('PointerEvent' in window) {
    boardEl.addEventListener('pointerdown', (event) => {
      if ((event.pointerType !== 'touch' && event.pointerType !== 'pen') || event.isPrimary === false) return;
      if (beginGesture(event.pointerId, event.clientX, event.clientY)) boardEl.setPointerCapture?.(event.pointerId);
    });
    boardEl.addEventListener('pointerup', (event) => endGesture(event.pointerId, event.clientX, event.clientY, event));
    boardEl.addEventListener('pointercancel', (event) => { if (event.pointerId === touchPointerId) clearGesture(); });
  } else {
    boardEl.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) { clearGesture(); return; }
      const touch = event.touches[0]; beginGesture('touch', touch.clientX, touch.clientY);
    }, { passive: true });
    boardEl.addEventListener('touchmove', (event) => { if (event.touches.length > 1) clearGesture(); }, { passive: true });
    boardEl.addEventListener('touchend', (event) => {
      if (!event.changedTouches.length) return;
      const touch = event.changedTouches[0]; endGesture('touch', touch.clientX, touch.clientY, event);
    }, { passive: false });
    boardEl.addEventListener('touchcancel', clearGesture, { passive: true });
  }
  document.querySelectorAll('.keys b').forEach((key) => key.addEventListener('click', () => move(key.dataset.direction)));
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch-device');
  document.querySelector('.cell-layer').innerHTML = '<i class="cell"></i>'.repeat(16); updateModeUi(); initBoard(); syncServerLeaderboards();
  window.addEventListener('resize', () => tiles.forEach((tile) => { const element = domTiles.get(tile.id); if (element) positionTile(element, tile); }));
})();
