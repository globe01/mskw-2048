# 码上开玩｜双人协作 2048

活动现场版 2048。默认单人 30 秒、双人 45 秒，支持键盘、可选 WASD、移动端触屏滑动、合并动画、独立排行榜、在线共享成绩和工作人员管理后台。

公开排行榜展示每种模式前五名；成绩提交后会返回本模式完整名次（例如“当前第 28 名”），工作人员后台可查看完整成绩记录。

操作设置中的 WASD 开关默认关闭。开启后，单人模式可用 W/A/S/D 控制四个方向；双人模式对应为甲 W/S 控制上下、乙 A/D 控制左右。游戏进行中设置会自动锁定，避免现场误触。

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
upstream-tile.js
upstream-grid.js
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

管理员接口需要请求头 `X-Admin-Token`。服务器会校验模式、昵称、分数、最高块和时长；公开接口只返回前五名，服务器按模式保留最多 10000 条完整成绩，后台可查看全部记录。

## 上游来源与许可证

本项目 Fork 自 [Gabriele Cirulli/2048](https://github.com/gabrielecirulli/2048)，上游项目采用 MIT License。原作者版权声明和完整许可证文本保留在仓库根目录的 [`LICENSE.txt`](LICENSE.txt) 中：

```text
Copyright (c) 2014 Gabriele Cirulli
```

上游棋盘模型和移动合并顺序保留在 `js/tile.js`、`js/grid.js` 等文件中。为适配当前服务器的静态文件白名单，首页运行时加载根目录的 `upstream-tile.js` 和 `upstream-grid.js`，两份文件与 `js/` 中的上游实现保持一致。移动、生成和合并动画也按上游 `HTMLActuator` 的分层方式实现：外层方块使用 100ms transform 过渡，内层使用 `appear` / `pop` CSS 动画，避免活动版自制 Web Animations 造成的卡顿。活动版页面通过 `app.js` 接入计时、双人分工、触屏、排行榜和后台功能。当前页面的 UI、活动规则、服务器接口和品牌图标属于本项目新增内容。详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 本地测试

### 1. 检查代码

```powershell
npm run check
node --check admin.js
```

### 2. 启动本地服务

```powershell
$env:PORT="3010"
$env:HOST="127.0.0.1"
$env:ADMIN_TOKEN="local-test-token"
node server.js
```

### 3. 打开页面

游戏：<http://127.0.0.1:3010/>

管理后台：<http://127.0.0.1:3010/admin>

### 4. 现场功能验收

- 单人模式：确认默认 30 秒，四个方向键和触屏滑动都能移动。
- 双人模式：确认默认 45 秒，上下键与左右键分别由两名参与者控制。
- 快速连续按键：确认输入不会被吞掉，棋盘仍按顺序响应。
- 无效方向：确认不会生成新块、加分或提前结束。
- 棋盘判定：填满但仍可合并时继续，完全无法移动时结束。
- 结束本局：确认需要二次确认，结束后仍能保存成绩。
- 成绩弹窗：关闭弹窗后点击“保存上一局成绩”仍可提交。
- 排行榜：分别测试单人榜和双人榜，再测试备份、清空和恢复。
- 手机端：在同一局中测试左右、上下滑动以及横竖屏尺寸变化。

### 5. 接口检查

```powershell
Invoke-WebRequest http://127.0.0.1:3010/api/health
Invoke-WebRequest http://127.0.0.1:3010/api/leaderboard
```

停止服务时，在运行 `node server.js` 的窗口按 `Ctrl+C`。
