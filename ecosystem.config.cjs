module.exports = {
  apps: [{
    name: 'mskw2048',
    script: './server.js',
    cwd: '/var/www/2048',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '256M',
    env: { NODE_ENV: 'production', PORT: 3108, HOST: '127.0.0.1' }
  }]
};
