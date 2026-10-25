#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { Writable } = require('stream');
const { hashPassword } = require('../auth');
async function main() {
  const file = path.resolve(process.argv[2] || path.join(os.homedir(), '.config', 'mskw2048.env'));
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  rl.on('SIGINT', () => { rl.close(); process.stdout.write('\n'); process.exit(130); });
  const ask = question => new Promise(resolve => rl.question(question, resolve));
  try {
    const username = (await ask('管理员账号（字母、数字、下划线，3–32 位）：')).trim();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) throw new Error('账号格式不正确。');
    process.stdout.write('设置密码（至少 12 位，输入不显示）：');
    muted = true;
    const password = await ask('');
    process.stdout.write('\n再次输入密码：');
    const confirmation = await ask('');
    process.stdout.write('\n');
    muted = false;
    if (password.length < 12 || password.length > 256 || /^\s+$/.test(password)) throw new Error('密码需要 12–256 位。');
    if (password !== confirmation) throw new Error('两次输入的密码不一致，未修改配置。');
    const hash = await hashPassword(password);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'NODE_ENV=production\nPORT=3108\nHOST=127.0.0.1\nDATA_DIR=/var/lib/mskw2048\n';
    const lines = existing.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?ADMIN_(?:TOKEN|USERNAME|PASSWORD_HASH)=/.test(line));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    lines.push("ADMIN_USERNAME='" + username + "'", "ADMIN_PASSWORD_HASH='" + hash + "'", '');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, lines.join('\n'), { mode: 0o600 });
    fs.renameSync(temporary, file);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
    console.log('账号已配置：' + username + '\n配置文件：' + file + '\n加载此文件并重启服务后生效，原端口与成绩目录保持不变。');
  } finally { rl.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

