'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { createAuth, hashPassword } = require('../auth');

test('账号会话、CSRF、限流与完整成绩备份恢复', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mskw-admin-test-'));
  const password = 'test-only-password-2048';
  const passwordHash = await hashPassword(password);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', NODE_ENV: 'production', DATA_DIR: directory, ADMIN_USERNAME: 'eventadmin', ADMIN_PASSWORD_HASH: passwordHash },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    server.kill();
    if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 10000);
    server.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    server.once('error', reject);
  });
  let cookie, csrf;
  const call = (route, options = {}) => fetch(base + route, options);
  const post = (route, body, headers = {}) => call(route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...headers }, body: JSON.stringify(body) });

  await t.test('匿名请求及旧密钥不能读取后台，配置不公开', async () => {
    assert.equal((await call('/api/admin/summary')).status, 401);
    assert.equal((await call('/api/admin/summary', { headers: { 'X-Admin-Token': 'legacy' } })).status, 401);
    for (const route of ['/auth.js', '/.env', '/data/leaderboard.json', '/scripts/set-admin.js']) assert.equal((await call(route)).status, 404);
    assert.equal((await call('/api/health')).status, 200);
    assert.equal((await post('/api/scores', { mode: 'solo', name: '公开玩家', score: 128, maxTile: 32, duration: 30 })).status, 201);
  });
  await t.test('错误密码拒绝；正确登录返回受保护的 cookie，会话中无密码', async () => {
    assert.equal((await post('/api/admin/login', { username: 'eventadmin', password: 'incorrect' })).status, 401);
    assert.equal((await post('/api/admin/login', { username: 'eventadmin', password }, { Origin: 'https://other.example' })).status, 403);
    const response = await post('/api/admin/login', { username: 'eventadmin', password });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Secure/);
    cookie = setCookie.split(';')[0];
    const body = await response.json(); csrf = body.csrf;
    assert.equal(body.username, 'eventadmin'); assert.equal(body.password, undefined); assert.equal(body.passwordHash, undefined);
    assert.equal((await call('/api/admin/summary', { headers: { Cookie: cookie } })).status, 200);
  });
  await t.test('跨站请求、缺少 CSRF 的写入不生效', async () => {
    assert.equal((await post('/api/admin/clear', {}, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await post('/api/admin/clear', {}, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await post('/api/admin/clear', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    const summary = await (await call('/api/admin/summary', { headers: { Cookie: cookie } })).json();
    assert.equal(summary.data.solo.length, 1);
  });
  await t.test('分包传输的中文昵称保持完整', async () => {
    const payload = Buffer.from(JSON.stringify({ mode: 'duo', name: '码上开玩', score: 64, maxTile: 16, duration: 45 }));
    const cut = payload.indexOf(Buffer.from('码')) + 1;
    await new Promise((resolve, reject) => {
      const req = http.request(base + '/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => { try { assert.equal(res.statusCode, 201); assert.equal(JSON.parse(body).entries[0].name, '码上开玩'); resolve(); } catch (error) { reject(error); } });
      });
      req.on('error', reject); req.write(payload.subarray(0, cut));
      setTimeout(() => req.end(payload.subarray(cut)), 15);
    });
  });
  await t.test('大于 16KB 的完整备份可恢复，坏文件不会清空数据', async () => {
    const data = { solo: Array.from({ length: 240 }, (_, i) => ({ name: '玩家' + i, score: i * 4, maxTile: 32, duration: 30, at: Date.now() + i })), duo: [{ name: '=1+1', score: 240, maxTile: 64, duration: 45, at: Date.now() }] };
    assert.ok(JSON.stringify({ data }).length > 16384);
    assert.equal((await post('/api/admin/restore', { data })).status, 200);
    const backup = await (await post('/api/admin/backup', {})).json();
    assert.equal(backup.data.solo.length, 240);
    const download = await call('/api/admin/backups/' + backup.file, { headers: { Cookie: cookie } });
    assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal((await download.json()).data.duo.length, 1);
    assert.equal((await call('/api/admin/backups/' + backup.file)).status, 401);
    assert.equal((await post('/api/admin/restore', { data: { solo: 'bad', duo: [] } })).status, 400);
    const summary = await (await call('/api/admin/summary', { headers: { Cookie: cookie } })).json();
    assert.equal(summary.data.solo.length, 240);
    assert.equal((await post('/api/admin/clear', {})).status, 200);
    const cleared = await (await call('/api/admin/summary', { headers: { Cookie: cookie } })).json();
    assert.equal(cleared.data.solo.length, 0);
    assert.ok(cleared.backups.some(file => file.name.includes('before-clear')));
    assert.equal((await post('/api/admin/restore', { data: backup.data })).status, 200);
  });
  await t.test('新旧成绩统一按最高块、总分、提交时间排序并返回完整名次', async () => {
    const entry = (name, maxTile, score, at) => ({ name, maxTile, score, at, duration: 30 });
    const records = [entry('高总分小块', 64, 5000, 1), entry('同分较晚', 128, 500, 30), entry('同分较早', 128, 500, 20), entry('大块低分', 256, 100, 40), entry('同块较低分', 128, 400, 10), entry('小块', 32, 10000, 2)];
    assert.equal((await post('/api/admin/restore', { data: { solo: records, duo: records } })).status, 200);
    const expected = ['大块低分', '同分较早', '同分较晚', '同块较低分', '高总分小块', '小块'];
    const summary = await (await call('/api/admin/summary', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(summary.data.solo.map(value => value.name), expected);
    assert.deepEqual(summary.data.duo.map(value => value.name), expected);
    const publicData = await (await call('/api/leaderboard')).json();
    assert.deepEqual(publicData.solo.map(value => value.name), expected.slice(0, 5));
    const result = await (await post('/api/scores', { mode: 'solo', name: '新挑战者', maxTile: 512, score: 4, duration: 30 })).json();
    assert.equal(result.rank, 1); assert.equal(result.total, 7);
    assert.equal(result.entries[0].name, '新挑战者');
    const backup = await (await post('/api/admin/backup', {})).json();
    assert.equal(backup.data.solo[0].name, '新挑战者');
  });
  await t.test('退出使旧 cookie 失效；多次登录失败后限流', async () => {
    assert.equal((await post('/api/admin/logout', {})).status, 200);
    assert.equal((await call('/api/admin/summary', { headers: { Cookie: cookie } })).status, 401);
    cookie = null;
    for (let i = 0; i < 10; i += 1) assert.equal((await post('/api/admin/login', { username: 'eventadmin', password: 'wrong' })).status, 401);
    assert.equal((await post('/api/admin/login', { username: 'eventadmin', password })).status, 429);
  });
});

test('会话到期与未配置账号时拒绝登录', async () => {
  const hash = await hashPassword('test-only-password-2048');
  const auth = createAuth({ username: 'eventadmin', passwordHash: hash, secure: false });
  const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  let setCookie;
  const res = { setHeader(name, value) { setCookie = value; } };
  assert.equal((await createAuth({}).login(req, res, {})).status, 503);
  await auth.login(req, res, { username: 'eventadmin', password: 'test-only-password-2048' });
  req.headers.cookie = setCookie.split(';')[0];
  assert.ok(auth.session(req));
  const original = Date.now;
  try { Date.now = () => original() + 9 * 60 * 60 * 1000; assert.equal(auth.session(req), null); }
  finally { Date.now = original; }
});

