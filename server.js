#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { createAuth } = require('./auth');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const auth = createAuth({ username: process.env.ADMIN_USERNAME, passwordHash: process.env.ADMIN_PASSWORD_HASH, secure: process.env.NODE_ENV === 'production' });
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MODES = new Set(['solo', 'duo']);
const PUBLIC_ENTRIES = 5;
const MAX_ENTRIES = 10_000;
const MAX_BODY = 16 * 1024;
const rate = new Map();

function emptyData() { return { solo: [], duo: [] }; }
function safeData(value) {
  const source = value && typeof value === 'object' ? value : {};
  const clean = emptyData();
  for (const mode of MODES) {
    clean[mode] = Array.isArray(source[mode]) ? source[mode].filter(isValidEntry).sort(compare).slice(0, MAX_ENTRIES) : [];
  }
  return clean;
}
function isValidEntry(entry) {
  return entry && typeof entry.name === 'string' && Number.isFinite(Number(entry.score)) && Number.isFinite(Number(entry.maxTile)) && Number.isFinite(Number(entry.duration)) && Number.isFinite(Number(entry.at));
}
function compare(a, b) { return Number(b.score) - Number(a.score) || Number(b.maxTile) - Number(a.maxTile) || Number(a.at) - Number(b.at); }
function publicData(data) { return { solo: data.solo.slice(0, PUBLIC_ENTRIES), duo: data.duo.slice(0, PUBLIC_ENTRIES) }; }
function readData() {
  try { return safeData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (_) { return emptyData(); }
}
function writeData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(safeData(data), null, 2), 'utf8');
  fs.renameSync(temp, DATA_FILE);
}
function backup(data, reason) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `${stamp}-${reason}.json`);
  fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), data: safeData(data) }, null, 2), 'utf8');
  return file;
}
function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter(name => name.endsWith('.json')).map(name => {
      const file = path.join(BACKUP_DIR, name); const stat = fs.statSync(file);
      return { name, size: stat.size, updatedAt: stat.mtime.toISOString() };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
  } catch (_) { return []; }
}
function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function noContent(res) { res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); res.end(); }
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let exceeded = false;
    req.on('data', chunk => {
      if (exceeded) return;
      size += chunk.length;
      if (size > limit) { exceeded = true; chunks.length = 0; reject(new Error('body_too_large')); }
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (exceeded) return;
      try {
        // Decode after concatenation so Chinese characters split across packets survive.
        const body = Buffer.concat(chunks).toString('utf8');
        const value = body ? JSON.parse(body) : {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch (_) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}
function rateLimited(ip) {
  const now = Date.now(); const record = rate.get(ip) || { count: 0, at: now };
  if (now - record.at > 60_000) { record.count = 0; record.at = now; }
  record.count += 1; rate.set(ip, record); return record.count > 30;
}
function validScore(body) {
  const mode = body.mode;
  const name = String(body.name || '匿名玩家').trim().slice(0, 12);
  const score = Number(body.score); const maxTile = Number(body.maxTile); const duration = Number(body.duration);
  if (!MODES.has(mode) || !name || !Number.isInteger(score) || score < 0 || score > 10_000_000 || !Number.isInteger(maxTile) || maxTile < 0 || maxTile > 1_048_576 || !Number.isInteger(duration) || duration < 5 || duration > 180) return null;
  return { mode, name, score, maxTile, duration, at: Date.now(), id: crypto.randomUUID() };
}
function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname === '/admin' ? '/admin.html' : pathname;
  const publicFiles = new Set(['/index.html', '/styles.css', '/app.js', '/admin.html', '/admin.css', '/admin.js', '/favicon.svg', '/upstream-tile.js', '/upstream-grid.js', '/manifest.webmanifest', '/sw.js']);
  if (!publicFiles.has(requested)) return json(res, 404, { error: 'not_found' });
  const file = path.resolve(ROOT, `.${requested}`);
  const rootPrefix = `${path.resolve(ROOT)}${path.sep}`;
  if (!file.startsWith(rootPrefix) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not_found' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
  const noCache = ['.html', '.js', '.css'].includes(path.extname(file));
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true); const pathname = parsed.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (pathname.startsWith('/api/admin/')) {
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      try {
        const result = await auth.login(req, res, await readBody(req));
        const { status, ...body } = result;
        return json(res, status, body);
      } catch (_) { return json(res, 400, { error: 'invalid_json' }); }
    }
    const session = auth.session(req);
    if (!session) return json(res, 401, { error: 'admin_required' });
    if (req.method !== 'GET' && !auth.canMutate(req, session)) return json(res, 403, { error: 'invalid_csrf' });
    if (pathname === '/api/admin/session' && req.method === 'GET') return json(res, 200, { username: session.username, csrf: session.csrf, expiresAt: session.expiresAt });
    if (pathname === '/api/admin/logout' && req.method === 'POST') { auth.logout(req, res); return json(res, 200, { ok: true }); }
    if (pathname === '/api/admin/summary' && req.method === 'GET') return json(res, 200, { ok: true, serverTime: new Date().toISOString(), data: readData(), backups: listBackups() });
    if (pathname === '/api/admin/backups' && req.method === 'GET') return json(res, 200, { backups: listBackups() });
    if (pathname.startsWith('/api/admin/backups/') && req.method === 'GET') {
      const name = pathname.slice('/api/admin/backups/'.length);
      if (!/^[a-zA-Z0-9_.-]+\.json$/.test(name)) return json(res, 400, { error: 'invalid_backup' });
      const file = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not_found' });
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    if (pathname === '/api/admin/backup' && req.method === 'POST') {
      try { const data = readData(); const file = backup(data, 'manual'); return json(res, 200, { ok: true, file: path.basename(file), data }); }
      catch (_) { return json(res, 500, { error: 'backup_failed' }); }
    }
    if (pathname === '/api/admin/clear' && req.method === 'POST') {
      try { const data = readData(); const file = backup(data, 'before-clear'); writeData(emptyData()); return json(res, 200, { ok: true, file: path.basename(file), data: emptyData() }); }
      catch (_) { return json(res, 500, { error: 'clear_failed' }); }
    }
    if (pathname === '/api/admin/restore' && req.method === 'POST') {
      try {
        const body = await readBody(req, 8 * 1024 * 1024);
        if (!body.data || ![...MODES].every(mode => Array.isArray(body.data[mode]) && body.data[mode].length <= MAX_ENTRIES && body.data[mode].every(isValidEntry))) return json(res, 400, { error: 'invalid_backup' });
        const restored = safeData(body.data);
        backup(readData(), 'before-restore'); writeData(restored);
        return json(res, 200, { ok: true, data: restored });
      } catch (error) { return json(res, 400, { error: error.message }); }
    }
    return json(res, 404, { error: 'not_found' });
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }); return res.end(); }
  if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, service: '2048', time: new Date().toISOString() });
  if (pathname === '/api/leaderboard' && req.method === 'GET') {
    const data = readData(); const mode = parsed.query.mode;
    if (mode && !MODES.has(mode)) return json(res, 400, { error: 'invalid_mode' });
    return json(res, 200, mode ? { mode, entries: data[mode].slice(0, PUBLIC_ENTRIES) } : publicData(data));
  }
  if (pathname === '/api/scores' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown'; if (rateLimited(ip)) return json(res, 429, { error: 'rate_limited' });
    try {
      const entry = validScore(await readBody(req)); if (!entry) return json(res, 400, { error: 'invalid_score' });
      const data = readData(); data[entry.mode].push(entry); data[entry.mode].sort(compare); data[entry.mode] = data[entry.mode].slice(0, MAX_ENTRIES); writeData(data);
      const rank = data[entry.mode].findIndex(item => item.id === entry.id) + 1;
      return json(res, 201, { mode: entry.mode, entries: data[entry.mode].slice(0, PUBLIC_ENTRIES), rank, total: data[entry.mode].length, accepted: rank > 0 });
    } catch (error) { return json(res, error.message === 'body_too_large' ? 413 : 400, { error: error.message }); }
  }
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  return noContent(res);
});

server.listen(PORT, HOST, () => { fs.mkdirSync(DATA_DIR, { recursive: true }); if (!fs.existsSync(DATA_FILE)) writeData(emptyData()); console.log(`2048 server listening on http://${HOST}:${server.address().port}`); });
