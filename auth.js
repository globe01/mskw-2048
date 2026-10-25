'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'mskw_admin';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

function createAuth({ username, passwordHash, secure = true }) {
  const sessions = new Map();
  const attempts = new Map();
  const parts = String(passwordHash || '').split('$');
  const configured = Boolean(username && parts[0] === 'scrypt' && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2]));
  const salt = configured ? parts[1] : '00000000000000000000000000000000';
  const expected = configured ? Buffer.from(parts[2], 'hex') : Buffer.alloc(64);

  function session(req) {
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)mskw_admin=([a-f0-9]{64})(?:;|$)/);
    if (!match) return null;
    const value = sessions.get(match[1]);
    if (!value || value.expiresAt <= Date.now()) { sessions.delete(match[1]); return null; }
    return { ...value, id: match[1] };
  }
  function cookie(res, id, maxAge) {
    res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }
  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host === req.headers.host; } catch (_) { return false; }
  }
  function canMutate(req, value) {
    return sameOrigin(req) && Boolean(value && req.headers['x-csrf-token'] === value.csrf);
  }
  async function login(req, res, body) {
    if (!configured) return { status: 503, error: 'admin_not_configured' };
    if (!sameOrigin(req)) return { status: 403, error: 'invalid_origin' };
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string' || body.username.length > 64 || body.password.length > 256) return { status: 400, error: 'invalid_credentials' };
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const remote = req.socket.remoteAddress || '';
    // Only trust the single Nginx proxy on this machine, never arbitrary client headers.
    const ip = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ? String(req.headers['x-real-ip'] || remote) : remote;
    const record = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
    if (record.count >= 10) return { status: 429, error: 'login_rate_limited' };
    if (attempts.size >= 2000 && !attempts.has(ip)) return { status: 429, error: 'login_rate_limited' };
    record.count += 1;
    attempts.set(ip, record);
    const actual = await scrypt(body.password, salt, 64);
    if (!crypto.timingSafeEqual(actual, expected) || body.username !== username) return { status: 401, error: 'invalid_credentials' };
    attempts.delete(ip);
    for (const [id, value] of sessions) if (value.expiresAt <= now) sessions.delete(id);
    const old = session(req);
    if (old) sessions.delete(old.id);
    if (sessions.size >= 256) sessions.delete(sessions.keys().next().value);
    const id = crypto.randomBytes(32).toString('hex');
    const value = { username, csrf: crypto.randomBytes(32).toString('hex'), expiresAt: now + SESSION_MS };
    sessions.set(id, value);
    cookie(res, id, SESSION_MS / 1000);
    return { status: 200, ...value };
  }
  function logout(req, res) {
    const value = session(req);
    if (value) sessions.delete(value.id);
    cookie(res, '', 0);
  }
  return { session, login, logout, canMutate };
}

module.exports = { createAuth, hashPassword };
