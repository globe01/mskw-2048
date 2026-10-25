(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const loginView = $('#login-view'), dashboard = $('#dashboard-view'), content = $('#mode-content');
  const status = $('#action-status'), loginError = $('#login-error');
  const labels = { solo: '单人极速', duo: '双人协作' };
  const errors = { invalid_credentials: '账号或密码不正确', login_rate_limited: '尝试次数过多，请 15 分钟后重试', admin_not_configured: '尚未配置管理员账号，请在服务器运行 npm run admin:setup', admin_required: '登录已过期，请重新登录', invalid_csrf: '登录状态已更新，请刷新页面后重试', invalid_backup: '备份格式不正确，未修改成绩', backup_failed: '备份失败，请检查服务器存储', clear_failed: '清空未完成，请刷新查看当前数据', invalid_json: '文件或请求格式不正确' };
  let session = null, state = null, mode = 'solo', page = 0, busy = false, refreshing = false, generation = 0;
  let animations = [];
  const pageSize = 20;
  const number = value => Number(value).toLocaleString('zh-CN');
  const formatTime = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const message = error => errors[error.message] || '操作未完成，请检查网络后重试';
  const entries = () => state ? state.data[mode] : [];

  async function request(endpoint, options = {}) {
    const response = await fetch(endpoint, {
      ...options, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(session ? { 'X-CSRF-Token': session.csrf } : {}), ...options.headers }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // An anonymous session probe is the normal first visit; only show the
      // expiry message after a previously authenticated session disappears.
      if (response.status === 401 && endpoint !== '/api/admin/login' && session) showLogin('登录已过期，请重新登录');
      throw new Error(body.error || 'http_' + response.status);
    }
    return body;
  }
  function showLogin(error = '') {
    generation += 1;
    session = null; state = null;
    dashboard.hidden = true; loginView.hidden = false;
    $('#password-input').value = '';
    loginError.textContent = error;
    // Remove credentials left by the older token-based console.
    try { sessionStorage.removeItem('2048-admin-token'); } catch (_) { /* storage may be disabled */ }
  }
  function showDashboard() { loginView.hidden = true; dashboard.hidden = false; loginError.textContent = ''; }
  function setHealth(ok) { $('#health').classList.toggle('ok', ok); $('#health').replaceChildren(); const dot = document.createElement('i'); $('#health').append(dot, ok ? '已同步' : '连接中断'); }
  async function refresh() {
    if (refreshing || !session) return;
    refreshing = true;
    $('#refresh-button').disabled = true;
    const version = generation;
    try {
      const data = await request('/api/admin/summary');
      if (version !== generation || !session) return;
      state = data; setHealth(true); render();
      $('#last-sync').textContent = '更新于 ' + formatTime(data.serverTime);
    } catch (error) { setHealth(false); status.textContent = message(error); throw error; }
    finally { refreshing = false; $('#refresh-button').disabled = false; }
  }

  function svgNode(tag, attrs = {}, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function createChart(target, title, description) {
    const svg = svgNode('svg', { viewBox: '0 0 480 180', role: 'img', 'aria-label': title });
    svg.append(svgNode('title', {}, title), svgNode('desc', {}, description));
    target.replaceChildren(svg);
    return svg;
  }
  function placeholder(target, text) {
    const element = document.createElement('div'); element.className = 'chart-placeholder';
    const svg = svgNode('svg', { viewBox: '0 0 60 40', 'aria-hidden': 'true' });
    svg.append(svgNode('path', { d: 'M7 33V22m15 11V13m15 20V5m15 28V17' }));
    element.append(svg, document.createTextNode(text)); target.replaceChildren(element);
  }
  function renderDistribution(data) {
    const target = $('#distribution-chart');
    $('#distribution-caption').textContent = number(data.length) + ' 局';
    if (!data.length) return placeholder(target, '完成挑战后展示分数分布');
    const max = Math.max(...data.map(entry => Number(entry.score)));
    const rough = Math.max(1, Math.ceil((max + 1) / 6));
    const unit = Math.pow(10, Math.floor(Math.log10(rough)));
    const width = Math.ceil(rough / unit) * unit;
    const bins = Array.from({ length: 6 }, () => 0);
    data.forEach(entry => { bins[Math.min(5, Math.floor(Number(entry.score) / width))] += 1; });
    const peak = Math.max(...bins, 1);
    const description = bins.map((value, i) => i * width + '–' + ((i + 1) * width - 1) + ' 分：' + value + ' 局').join('；');
    const svg = createChart(target, labels[mode] + '分数分布', description);
    svg.append(svgNode('line', { x1: 12, y1: 142, x2: 468, y2: 142, class: 'chart-baseline' }));
    bins.forEach((value, i) => {
      const x = 22 + i * 76, height = value / peak * 104;
      if (value) {
        const bar = svgNode('rect', { x, y: 142 - height, width: 54, height, rx: 4, class: 'chart-bar', tabindex: 0 });
        bar.append(svgNode('title', {}, i * width + '–' + ((i + 1) * width - 1) + ' 分 · ' + value + ' 局'));
        svg.append(bar, svgNode('text', { x: x + 27, y: 132 - height, 'text-anchor': 'middle', class: 'chart-value' }, value));
      }
      svg.append(svgNode('text', { x: x + 27, y: 164, 'text-anchor': 'middle' }, i * width + '–' + ((i + 1) * width - 1)));
    });
  }
  function renderActivity(data) {
    const target = $('#activity-chart');
    if (!data.length) { $('#activity-caption').textContent = '提交时间'; return placeholder(target, '完成挑战后展示参与节奏'); }
    const times = data.map(entry => Number(entry.at));
    const first = Math.min(...times), last = Math.max(...times);
    const step = Math.max(60000, Math.ceil((last - first + 60000) / 12 / 60000) * 60000);
    const start = Math.floor(first / 60000) * 60000;
    const bins = Array.from({ length: 12 }, () => 0);
    times.forEach(at => { bins[Math.min(11, Math.floor((at - start) / step))] += 1; });
    const peak = Math.max(...bins, 1);
    const time = at => new Date(at).toLocaleString('zh-CN', { ...(last - first > 86400000 ? { month: 'numeric', day: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false });
    $('#activity-caption').textContent = '每 ' + step / 60000 + ' 分钟提交局数';
    const svg = createChart(target, labels[mode] + '参与节奏', bins.map((count, i) => time(start + i * step) + '：' + count + ' 局').join('；'));
    const points = bins.map((count, i) => [24 + i * 39, 140 - count / peak * 104]);
    const line = points.map((point, i) => (i ? 'L' : 'M') + point.join(',')).join(' ');
    svg.append(svgNode('line', { x1: 24, y1: 140, x2: 453, y2: 140, class: 'chart-baseline' }));
    svg.append(svgNode('path', { d: line + ' L453,140 L24,140 Z', class: 'chart-area' }));
    svg.append(svgNode('path', { d: line, class: 'chart-line' }));
    points.forEach(([x, y], i) => {
      const point = svgNode('circle', { cx: x, cy: y, r: bins[i] ? 4 : 2.5, class: 'chart-point', tabindex: 0 });
      point.append(svgNode('title', {}, time(start + i * step) + '–' + time(start + (i + 1) * step) + ' · ' + bins[i] + ' 局'));
      svg.append(point);
      if (bins[i]) svg.append(svgNode('text', { x, y: y - 12, 'text-anchor': 'middle', class: 'chart-value' }, bins[i]));
    });
    [0, 5, 11].forEach(i => svg.append(svgNode('text', { x: points[i][0], y: 164, 'text-anchor': i === 0 ? 'start' : i === 11 ? 'end' : 'middle' }, time(start + i * step))));
  }
  function renderTable() {
    const query = $('#search-input').value.trim().toLocaleLowerCase();
    const filtered = entries().map((entry, index) => ({ ...entry, rank: index + 1 })).filter(entry => entry.name.toLocaleLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    const body = $('#score-rows'); body.replaceChildren();
    filtered.slice(page * pageSize, (page + 1) * pageSize).forEach(entry => {
      const row = document.createElement('tr'); row.dataset.top = String(entry.rank <= 3);
      [entry.rank, entry.name, number(entry.score), number(entry.maxTile), entry.duration + ' 秒', formatTime(entry.at)].forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
      body.append(row);
    });
    $('#record-count').textContent = number(entries().length);
    $('#empty-state').hidden = filtered.length > 0;
    $('#empty-state').textContent = query ? '没有找到这个昵称' : '还没有挑战记录';
    $('#page-status').textContent = filtered.length ? '第 ' + (page + 1) + ' / ' + pages + ' 页 · 共 ' + number(filtered.length) + ' 条' : '0 条记录';
    $('#previous-page').disabled = page === 0; $('#next-page').disabled = page >= pages - 1;
    $('#export-button').disabled = !entries().length;
  }
  function renderBackups() {
    const list = $('#backup-list'); list.replaceChildren();
    $('#backup-count').textContent = state.backups.length;
    $('#backup-empty').hidden = state.backups.length > 0;
    state.backups.forEach(file => {
      const row = document.createElement('li'), info = document.createElement('div'), detail = document.createElement('span'), link = document.createElement('a');
      const reason = file.name.includes('before-clear') ? '清空前备份' : file.name.includes('before-restore') ? '恢复前备份' : '手动备份';
      info.textContent = formatTime(file.updatedAt); detail.textContent = reason + ' · ' + Math.max(1, Math.ceil(file.size / 1024)) + ' KB'; info.append(detail);
      link.href = '/api/admin/backups/' + encodeURIComponent(file.name); link.download = file.name; link.textContent = '下载';
      row.append(info, link); list.append(row);
    });
  }
  function render() {
    if (!state) return;
    const data = entries(), total = data.reduce((sum, entry) => sum + Number(entry.score), 0);
    $('#round-count').textContent = number(data.length);
    $('#best-score').textContent = data.length ? number(data[0].score) : '—';
    $('#best-player').textContent = data.length ? data[0].name : '等待首位挑战者';
    $('#average-score').textContent = data.length ? number(Math.round(total / data.length)) : '—';
    $('#best-tile').textContent = data.length ? number(Math.max(...data.map(entry => Number(entry.maxTile)))) : '—';
    $('#mode-caption').textContent = labels[mode];
    const durations = [...new Set(data.map(entry => Number(entry.duration)))].sort((a, b) => a - b);
    $('#duration-caption').textContent = durations.length ? (durations.length === 1 ? durations[0] + ' 秒挑战' : durations.length + ' 种挑战时长 · 混合统计') : '时长 —';
    renderDistribution(data); renderActivity(data); renderTable(); renderBackups();
  }
  function switchMode(next) {
    if (mode === next) return;
    const direction = next === 'duo' ? 1 : -1;
    mode = next; page = 0; $('#search-input').value = '';
    $('.tabs').classList.toggle('is-duo', mode === 'duo');
    document.querySelectorAll('.tab').forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-selected', active); button.tabIndex = active ? 0 : -1; });
    animations.forEach(animation => animation.cancel()); animations = [];
    content.dataset.mode = mode; content.setAttribute('aria-labelledby', 'tab-' + mode);
    render();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      [$('.metrics'), $('.charts'), $('.scores-panel')].forEach((element, index) => {
        animations.push(element.animate([{ opacity: .25, transform: 'translateX(' + direction * 12 + 'px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 340, delay: index * 35, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }));
      });
    }
  }

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#login-button'); button.disabled = true; loginError.textContent = '';
    try {
      session = await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: $('#username-input').value.trim(), password: $('#password-input').value }) });
      $('#password-input').value = '';
      await refresh(); if (state && session) showDashboard();
    } catch (error) { loginError.textContent = message(error); }
    finally { button.disabled = false; }
  });
  $('#toggle-password').addEventListener('click', () => {
    const input = $('#password-input'), visible = input.type === 'password';
    input.type = visible ? 'text' : 'password'; $('#toggle-password').setAttribute('aria-label', visible ? '隐藏密码' : '显示密码'); $('#toggle-password').setAttribute('aria-pressed', visible);
  });
  $('#refresh-button').addEventListener('click', () => refresh().catch(() => {}));
  $('#logout-button').addEventListener('click', async () => {
    if (busy) return;
    try { await request('/api/admin/logout', { method: 'POST', body: '{}' }); showLogin(); }
    catch (error) { status.textContent = message(error); }
  });
  document.querySelectorAll('.tab').forEach(button => {
    button.addEventListener('click', () => switchMode(button.dataset.mode));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'solo' : event.key === 'End' ? 'duo' : mode === 'solo' ? 'duo' : 'solo';
      switchMode(next); $('#tab-' + next).focus();
    });
  });
  $('#search-input').addEventListener('input', () => { page = 0; renderTable(); });
  $('#previous-page').addEventListener('click', () => { page -= 1; renderTable(); });
  $('#next-page').addEventListener('click', () => { page += 1; renderTable(); });

  function download(data, filename, type) {
    const blob = new Blob([data], { type }), href = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = href; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  $('#export-button').addEventListener('click', () => {
    const cell = value => '"' + String(value).replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""') + '"';
    const rows = [['名次', '昵称', '得分', '最高块', '时长（秒）', '提交时间'], ...entries().map((entry, index) => [index + 1, entry.name, entry.score, entry.maxTile, entry.duration, formatTime(entry.at)])];
    download('\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n'), '码上开玩-' + labels[mode] + '.csv', 'text/csv;charset=utf-8');
  });
  async function mutate(action) {
    if (busy || !session) return;
    busy = true;
    ['#backup-button', '#clear-button', '#restore-file', '#logout-button'].forEach(selector => { $(selector).disabled = true; });
    try { await action(); await refresh(); }
    catch (error) { status.textContent = message(error); }
    finally { busy = false; ['#backup-button', '#clear-button', '#restore-file', '#logout-button'].forEach(selector => { $(selector).disabled = false; }); }
  }
  $('#backup-button').addEventListener('click', () => mutate(async () => {
    const result = await request('/api/admin/backup', { method: 'POST', body: '{}' });
    download(JSON.stringify({ savedAt: new Date().toISOString(), data: result.data }, null, 2), result.file, 'application/json');
    status.textContent = '完整成绩已备份到服务器，并已发起下载。';
  }));
  $('#clear-button').addEventListener('click', () => {
    if (!state || !window.confirm('将清空单人和双人两个排行榜的全部成绩，系统会先在服务器自动备份。确定清空？')) return;
    mutate(async () => { await request('/api/admin/clear', { method: 'POST', body: '{}' }); page = 0; status.textContent = '两个排行榜已清空，原成绩可从服务器存档下载恢复。'; });
  });
  $('#restore-file').addEventListener('change', () => {
    const input = $('#restore-file'), file = input.files[0];
    if (!file) return;
    mutate(async () => {
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('invalid_backup');
        let snapshot;
        try { snapshot = JSON.parse(await file.text()); } catch (_) { throw new Error('invalid_backup'); }
        if (!snapshot.data || !['solo', 'duo'].every(key => Array.isArray(snapshot.data[key]))) throw new Error('invalid_backup');
        if (!window.confirm('将使用备份覆盖单人和双人两个排行榜，当前成绩会先自动留档。确定恢复？')) return;
        await request('/api/admin/restore', { method: 'POST', body: JSON.stringify({ data: snapshot.data }) });
        page = 0; status.textContent = '完整成绩已恢复，覆盖前的数据已自动留档。';
      } finally { input.value = ''; }
    });
  });
  showLogin();
  request('/api/admin/session').then(async value => { session = value; await refresh(); if (state && session) showDashboard(); }).catch(() => {});
  window.setInterval(() => { if (session && !document.hidden && !busy) refresh().catch(() => {}); }, 15000);
})();
