# 码上开玩｜双人协作 2048

活动现场版 2048，默认单人 30 秒、双人 45 秒。支持方向键、可选 WASD、触屏滑动、独立排行榜、在线共享成绩和工作人员后台。

公开榜各显示前五名；提交成绩后返回该模式的完整名次。后台可以查看、搜索和导出完整成绩。

## 访问地址

- 游戏：<https://mskw2048.chemistryplsmodel.com>
- 后台：<https://mskw2048.chemistryplsmodel.com/admin>

## 本地测试

需要 Node.js 20+，无第三方运行依赖。在项目目录打开 PowerShell：

```powershell
npm run check
npm test
npm run admin:setup -- "$HOME/.config/mskw2048-local.env"
```

按提示设置测试账号密码。账号使用字母、数字、下划线（3–32 位），密码为 12–256 位，输入时隐藏。脚本只保存 scrypt 哈希，不保存明文。

在同一窗口加载账号配置，启动本地服务：

```powershell
Get-Content "$HOME/.config/mskw2048-local.env" | ForEach-Object {
  if ($_ -match '^(ADMIN_USERNAME|ADMIN_PASSWORD_HASH)=(.*)$') {
    Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2].Trim("'")
  }
}
$env:NODE_ENV="development"
$env:PORT="3010"
$env:HOST="127.0.0.1"
$env:DATA_DIR="$PWD/data-local"
node server.js
```

游戏：<http://127.0.0.1:3010/>，后台：<http://127.0.0.1:3010/admin>。用刚设置的账号密码登录。停止时按 Ctrl+C。

本地使用单独成绩目录，避免和正式数据混淆。HTTP 本地测试必须使用开发模式；生产模式会启用 Secure Cookie，只通过 HTTPS 登录。

## 游戏判定

- 只有发生位移或合并的方向输入才生成一个新的 2 或 4。
- 无效输入不会生成方块、加分或提前结束本局。
- 棋盘填满但仍有可合并数字时继续；完全无法移动时结束。
- 倒计时在当前移动动画完成后结束，避免动画中途截断成绩。
- 进行中锁定模式、时长和设置；保留“结束本局”，确认后中止并进入成绩页。
- 关闭成绩弹窗后，仍可通过“保存上一局成绩”提交。
- WASD 默认关闭。开启后单人使用四个方向；双人分别使用 W/S 和 A/D。

## 更新现有腾讯云服务器

当前部署使用 Ubuntu、Node.js 20、PM2 和 Nginx；代码在 `/var/www/2048`，成绩在 `/var/lib/mskw2048`，PM2 进程名为 `mskw2048`。

```bash
cd /var/www/2048
git pull --ff-only origin master
npm run check
npm run admin:setup
```

在终端输入你自己的账号密码。脚本默认更新 `$HOME/.config/mskw2048.env`，保留原来的端口和成绩目录，移除旧管理员密钥配置。密码不要发到聊天或提交到 Git。

```bash
set -a
source "$HOME/.config/mskw2048.env"
set +a
pm2 restart mskw2048 --update-env
pm2 save
curl -fsS http://127.0.0.1:3108/api/health
```

刷新后台后即可使用账号密码登录。旧 `ADMIN_TOKEN` 不再用于鉴权。忘记密码时重新运行设置脚本，再加载配置并重启服务即可。更新不会清空成绩。

### 首次部署

安装 Node.js 20+、Nginx、PM2 后：

```bash
sudo mkdir -p /var/www/2048 /var/lib/mskw2048
sudo chown "$USER":"$USER" /var/www/2048 /var/lib/mskw2048
git clone https://github.com/globe01/mskw-2048.git /var/www/2048
cd /var/www/2048
npm run check
npm run admin:setup
set -a
source "$HOME/.config/mskw2048.env"
set +a
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

执行 `pm2 startup` 输出的 sudo 命令。默认配置使用生产模式、端口 3108、监听 127.0.0.1、成绩目录 /var/lib/mskw2048。环境文件仅当前用户可读写。

### DNS、Nginx 与腾讯云 SSL

在 DNSPod 添加 A 记录：主机记录 `mskw2048`，记录值为当前服务器公网 IP。安全组放行 TCP 80、443；SSH 22 按自己的管理需要设置。

[Nginx HTTP 示例](nginx/2048.conf) 代理到 127.0.0.1:3108。现有服务器使用 `/etc/nginx/sites-available/mskw2048.conf`，保留其他站点配置。

使用腾讯云下载的 Nginx 证书，不需要 Certbot。建议证书路径：

```text
/etc/nginx/ssl/mskw2048/fullchain.crt
/etc/nginx/ssl/mskw2048/private.key
```

证书目录 root:root、700；私钥 600，证书 644。Nginx 的 443 配置引用这两个文件，80 重定向到 HTTPS。腾讯云证书到期前需续期并替换文件。

在本网站的 HTTPS server 块中，将上传上限设置为 `client_max_body_size 8m;`，支持后台恢复完整备份。修改后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 后台与数据

后台包括模式切换动画、成绩概览、分数分布、参与节奏、完整排名搜索和分页、CSV 导出，以及：

- 双榜完整 JSON 备份并下载；
- 清空前自动备份，恢复前自动留档；
- 最近 30 份服务器存档下载；
- 每 15 秒自动刷新，可见页面才发起请求。

图表根据真实成绩生成，空榜显示空状态。时长混用时会明确提示混合统计。服务器每种模式最多保留 10000 条记录。

登录使用 8 小时 HttpOnly、SameSite Cookie，修改操作校验 CSRF。退出、服务重启、会话到期后需要重新登录。同一来源连续 10 次登录失败会被限流，15 分钟窗口结束后可重试。

成绩保存在 `DATA_DIR/leaderboard.json`，备份在 `DATA_DIR/backups/`。不要提交真实环境配置、成绩或备份到 Git。

## 活动前验收

1. `npm run check` 和 `npm test` 通过。
2. 电脑和手机分别提交成绩，确认共享同一榜单。
3. 测试默认时长、方向键、WASD 和触屏滑动。
4. 快速连续按键，确认输入不被固定时间间隔吞掉。
5. 测试无效方向、棋盘无法移动、主动结束以及关闭弹窗后再次保存成绩。
6. 后台测试登录、单双人切换、搜索、导出、备份、清空和恢复。
7. 正式活动前备份并清空测试成绩，保留本地离线包备用。

## API

```text
GET  /api/health
GET  /api/leaderboard
POST /api/scores
POST /api/admin/login
GET  /api/admin/session
POST /api/admin/logout
GET  /api/admin/summary
GET  /api/admin/backups
GET  /api/admin/backups/<filename>
POST /api/admin/backup
POST /api/admin/clear
POST /api/admin/restore
```

管理员接口使用会话鉴权，写操作需要 `X-CSRF-Token`。公开接口只返回各模式前五名。

## 上游来源与许可证

本项目 Fork 自 [Gabriele Cirulli/2048](https://github.com/gabrielecirulli/2048)，上游采用 MIT License。原作者版权声明和完整许可证保留在 [LICENSE.txt](LICENSE.txt)：

```text
Copyright (c) 2014 Gabriele Cirulli
```

上游棋盘模型和移动合并顺序保留在 `js/tile.js`、`js/grid.js` 等文件中。首页加载的 `upstream-tile.js`、`upstream-grid.js` 与上游实现保持一致。动画按上游 HTMLActuator 的分层方式实现：外层方块使用 100ms transform 过渡，内层使用 appear / pop CSS 动画。活动 UI、计时、协作、触屏、排行榜和后台是本项目新增内容，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
