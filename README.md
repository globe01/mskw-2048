# 码上开玩｜双人协作 2048

活动现场版 2048。默认单人 30 秒、双人 45 秒，支持键盘、移动端触屏滑动、合并动画、独立排行榜、在线共享成绩和工作人员管理后台。

## 游戏判定

- 只有真正发生位移或合并的方向输入才算有效移动，才会生成一个新的 2 或 4。
- 无效方向输入会被忽略，不会扣时间、加分或提前结束本局。
- 每次有效移动完成后检查棋盘：仍有空格或相邻同数字时继续；棋盘填满且不存在任何可合并数字时，立即显示“棋盘已满”并结束本局。
- 倒计时在一次移动动画完成后结束，避免动画中途截断成绩。
- 计时期间模式、时长和排行榜管理锁定；“结束本局”按钮保留，但必须确认后才会中止，并进入成绩页保存当前成绩。

## 访问地址

- 游戏：`https://mskw2048.chemistryplsmodel.com`
- 管理后台：`https://mskw2048.chemistryplsmodel.com/admin`

## 本地测试

在项目目录打开 PowerShell：

```powershell
$env:PORT="3000"
$env:HOST="127.0.0.1"
$env:ADMIN_TOKEN="local-test-token"
node server.js
```

然后打开：

```text
http://127.0.0.1:3000
http://127.0.0.1:3000/admin
```

后台测试密钥为 `local-test-token`。本地测试通过后再上传服务器。

## DNS 解析

在腾讯云 DNSPod 为 `chemistryplsmodel.com` 添加：

```text
主机记录：mskw2048
记录类型：A
记录值：49.233.209.190
线路：默认
TTL：600
```

解析结果应为：

```text
mskw2048.chemistryplsmodel.com -> 49.233.209.190
```

## 腾讯云服务器部署

服务器使用 Ubuntu、Node.js 20、Nginx 和 PM2。2 核 2GB 足够承载活动现场的静态页面和排行榜请求。

### 安装环境

```bash
sudo apt update
sudo apt install -y curl nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 创建目录

```bash
sudo mkdir -p /var/www/2048
sudo chown -R "$USER":"$USER" /var/www/2048
```

### 上传文件

上传以下文件和目录：

```text
index.html
favicon.svg
styles.css
app.js
server.js
admin.html
admin.css
admin.js
package.json
ecosystem.config.cjs
.env.example
README.md
nginx/
```

不要上传真实 `.env`、测试排行榜或备份文件。

### 设置密钥

```bash
cd /var/www/2048
mkdir -p data/backups
cp .env.example .env
openssl rand -hex 32
nano .env
```

`.env` 内容：

```env
PORT=3000
HOST=127.0.0.1
ADMIN_TOKEN=填写刚才生成的随机密钥
```

### 启动服务

```bash
cd /var/www/2048
set -a
source .env
set +a
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 startup
```

执行 `pm2 startup` 后，复制并执行它输出的 `sudo` 命令。

检查：

```bash
pm2 status
curl http://127.0.0.1:3000/api/health
```

### 配置 Nginx

```bash
sudo cp /var/www/2048/nginx/2048.conf /etc/nginx/sites-available/2048.conf
sudo ln -sf /etc/nginx/sites-available/2048.conf /etc/nginx/sites-enabled/2048.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 配置 HTTPS

```bash
sudo certbot --nginx -d mskw2048.chemistryplsmodel.com
sudo certbot renew --dry-run
```

## 管理后台

后台提供：

- 服务健康状态。
- 单人、双人排行榜查看。
- 手动备份。
- 自动备份后清空。
- 上传 JSON 备份恢复。
- 恢复前自动备份当前榜单。

排行榜保存于：

```text
data/leaderboard.json
data/backups/
```

## 活动前验收

1. 用电脑打开游戏地址。
2. 用两台手机同时打开游戏地址。
3. 分别提交单人、双人测试成绩。
4. 确认不同设备看到同一排行榜。
5. 打开 `/admin`，确认服务状态正常。
6. 测试备份、清空和恢复。
7. 正式开始前清空测试数据。
8. 保留本地 `index.html` 和项目压缩包作为离线备用。

## API

```text
GET  /api/health
GET  /api/leaderboard
POST /api/scores
GET  /api/admin/summary
GET  /api/admin/backups
POST /api/admin/backup
POST /api/admin/clear
POST /api/admin/restore
```

管理员接口需要请求头 `X-Admin-Token`。服务器会校验模式、昵称、分数、最高块和时长，每种模式只保留前五名。
## Upstream source and license

This repository is forked from Gabriele Cirulli/2048. The original MIT-licensed implementation is retained in the js/, style/, and meta/ directories while the activity UI and server features are implemented in the files at the repository root.

The Ma Shang Kai Wan interface, timed solo/co-op modes, touch controls, leaderboards, score submission, and admin console are project additions.
