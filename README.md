# 港美股7日事件机会雷达

个人使用的事件驱动研究工具 MVP。系统聚焦最近7天的信息增量，围绕预期差、催化剂、市场验证、走势校验和模型迭代生成观察清单。

## 当前状态

这是第一阶段内测体验版：

- 零外部依赖 Node.js 后端
- 静态 Web 页面
- JSON 文件持久化数据层
- 机会榜、事件卡、评分详情、观察池、复盘、自定义行业、模型配置
- 个人动作记录：重点跟踪、模拟买入、模拟卖出、忽略
- 飞书个股查询 API 骨架
- 模型权重建议确认 API 骨架
- 手动事件录入台：录入事件后自动生成评分卡
- 行情快照录入：更新市场验证并重算相关评分
- 走势验证录入：手动更新 T+1、相对大盘、最大回撤并重算周复盘
- 官方披露采集：美股 SEC EDGAR、港股 HKEXnews
- 自动行情维护：Yahoo Chart 行情快照，计算涨跌幅、相对大盘和量比

运行后会自动生成本地数据文件：

```text
data/radar-db.json
```

该文件保存观察池、个人动作、自定义行业和模型建议确认状态，默认不提交到 Git。

## 运行

```bash
npm run dev
```

打开：

```text
http://localhost:7317
```

默认本地端口为 `7317`；如果该端口被占用，开发服务会自动尝试后续可用端口，并在终端打印最终访问地址。

## 测试

```bash
npm test
```

## 备份

Web 端右上角可以点击“备份数据”。

命令行备份：

```bash
npm run backup
```

备份文件会保存到：

```text
data/backups/
```

## 真实数据源采集

当前接入两个官方披露源：

- 美股：SEC EDGAR `data.sec.gov/submissions`
- 港股：HKEXnews 标题搜索和 active stock JSON

采集配置在：

```text
server/data-source-config.js
```

运行全部市场：

```bash
npm run collect
```

只采美股：

```bash
npm run collect -- --us --days=7
```

只采港股：

```bash
npm run collect -- --hk --days=7
```

SEC 建议设置更明确的 User-Agent：

```bash
set SEC_USER_AGENT=7D Event Radar your-email@example.com
```

Web 端也可以在“事件录入台”点击“采集美股+港股”。

## 自动行情维护

Web 端在“事件录入台”点击“自动刷新行情”。

命令行刷新全部跟踪股票：

```bash
npm run market
```

只刷新某只股票：

```bash
npm run market -- NVDA
```

行情源：

- 美股/港股：Yahoo Chart
- 美股基准：`QQQ`
- 港股基准：`^HSI`

系统会自动更新：

- 当前价格
- 涨跌幅
- 相对大盘收益
- 成交量
- 量比

更新后会自动重算相关事件卡的“市场验证”分。

## 飞书机器人

当前支持飞书群自定义机器人 Webhook：

1. 在飞书群里添加“自定义机器人”。
2. 复制机器人 Webhook 地址。
3. 在启动服务或命令前设置环境变量。

PowerShell 示例：

```powershell
$env:FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/你的token"
npm run dev
```

也可以使用本地配置文件，推荐正式使用时采用这种方式：

```bash
npm run config:init
```

然后编辑：

```text
.env.local
```

填入：

```text
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/你的token
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=你在事件订阅里设置的 Verification Token
```

`.env.local` 已被 `.gitignore` 忽略，不会提交。

测试机器人：

```powershell
$env:FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/你的token"
npm run feishu:test
```

推送每日榜：

```powershell
npm run feishu:daily
```

推送风险提醒：

```powershell
npm run feishu:risk
```

Web 端也可以在“事件录入台”的“飞书机器人”区域点击测试或推送。

也可以直接在 Web 端保存飞书配置：

```text
事件录入 → 飞书机器人 → 填写配置 → 保存飞书配置
```

保存后会写入本地 `.env.local`，并立即对当前服务生效，不需要重启。

注意：

- 不要把 Webhook URL 写入代码或提交到 Git。
- 如果飞书机器人开启了签名校验，当前版本需要先关闭签名校验，或后续增加签名支持。
- 飞书推送只发送 S/A 级观察卡片摘要，不发送买卖建议。

### 飞书群指令查询

如果要在群里输入指令并让机器人回复，需要使用“飞书自建应用”并配置事件订阅。

需要环境变量：

```powershell
$env:FEISHU_APP_ID="cli_xxx"
$env:FEISHU_APP_SECRET="xxx"
$env:FEISHU_VERIFICATION_TOKEN="你在事件订阅里设置的 Verification Token"
```

本地回调接口：

```text
POST /api/feishu/events
```

飞书事件订阅需要填写公网 HTTPS 地址，例如：

```text
https://你的公网域名/api/feishu/events
```

支持群指令：

```text
机会榜
风险
查 NVDA
NVDA
0700.HK
帮助
```

需要订阅的事件：

```text
im.message.receive_v1
```

说明：

- 自定义 Webhook 只能主动推送，不能接收群消息。
- 群指令查询必须走自建应用机器人。
- 本地开发需要公网回调地址或内网穿透。

## 小程序体验版

当前先提供一个手机端 Web 小程序入口：

```text
http://localhost:7317/mini
```

功能：

- 查看移动端机会榜
- 点击股票查看事件卡
- 输入代码查询个股

后续可继续升级为飞书小程序或微信小程序。

## Cloudflare Tunnel

用于把本地服务临时暴露成公网 HTTPS 地址，供飞书事件订阅回调使用。

先启动本地服务：

```powershell
npm run dev
```

另开一个 PowerShell：

```powershell
npm run tunnel
```

终端会输出类似：

```text
https://xxxx.trycloudflare.com
```

飞书事件订阅回调地址填写：

```text
https://xxxx.trycloudflare.com/api/feishu/events
```

注意：

- 这是临时 Tunnel，重启后地址可能变化。
- 适合本地测试飞书群指令。
- 正式长期使用建议部署到云服务器或配置 Cloudflare Named Tunnel。

## API

| API | 用途 |
| --- | --- |
| `GET /api/health` | 服务状态 |
| `GET /api/events` | 原始事件列表 |
| `POST /api/events` | 手动录入事件并自动评分 |
| `POST /api/import/events` | 批量导入事件 |
| `GET /api/market-snapshots` | 行情快照 |
| `POST /api/market-snapshots` | 更新行情快照并重算评分 |
| `GET /api/opportunities` | 7日机会榜 |
| `GET /api/opportunities/:id` | 个股事件卡 |
| `GET /api/stocks/:symbol/events` | 个股最近7天事件 |
| `GET /api/scores/:eventId` | 评分详情 |
| `GET /api/watchlist` | 观察池 |
| `POST /api/watchlist` | 加入观察池 |
| `GET /api/watchlist/:id/performance` | 走势验证 |
| `PUT /api/watchlist/:id/performance` | 更新走势验证 |
| `GET /api/reviews/weekly` | 周复盘 |
| `POST /api/reviews/weekly/regenerate` | 重算周复盘 |
| `GET /api/model/config` | 模型权重 |
| `POST /api/model/suggestions/:id/confirm` | 确认模型权重建议 |
| `GET /api/custom-industries` | 自定义行业 |
| `POST /api/custom-industries` | 新增自定义行业 |
| `PUT /api/custom-industries/:id` | 修改自定义行业 |
| `GET /api/personal-actions` | 个人动作记录 |
| `POST /api/personal-actions` | 新增个人动作 |
| `POST /api/feishu/query` | 飞书个股查询 |
| `GET /api/feishu/daily-preview` | 飞书每日榜单预览 |
| `GET /api/data-sources/config` | 查看采集股票配置 |
| `POST /api/collect/disclosures` | 触发 SEC/HKEX 官方披露采集 |
| `GET /api/ingestion-runs` | 查看采集记录 |

## 内测操作流

1. 在“事件录入台”录入最近7天的新事件。
2. 系统自动生成事件卡、评分、等级和后续观察信号。
3. 在“7日机会榜”筛选 S/A/B 等级，默认按股票聚合展示。
4. 点击“详情”查看该股票近7天全部事件、来源链接和评分卡。
5. 将重点标的加入观察池，或记录个人动作。
6. 在“事件录入台”更新行情快照，系统会重算市场验证分。
7. 在“观察池”录入 T+1、相对大盘、最大回撤。
8. 在“复盘中心”查看自动重算后的周复盘。
9. 在“模型配置”确认或暂缓权重建议。

## 正式使用建议

- 每天先运行 `npm run collect`，再打开 Web 查看机会榜。
- 需要市场验证时运行 `npm run market`，或在 Web 点击“自动刷新行情”。
- 需要飞书提醒时，先设置 `FEISHU_WEBHOOK_URL`，再运行 `npm run feishu:daily`。
- 修改采集股票池请在“事件录入台”的采集池区域操作。
- 每周至少备份一次数据。
- 行情快照已支持自动刷新，手动录入保留为兜底。
- 当前数据源只覆盖官方披露，不包含实时新闻和完整行情。

## 评分说明

内测版评分引擎位于 `server/scoring.js`：

- 事件强度：由事件类型和来源可信度决定。
- 预期差：由是否为7日新增信息和事件方向决定。
- 催化剂：由催化日期和后续观察信号决定。
- 市场验证：由行情快照中的涨跌幅、相对大盘和量比决定。
- 产业趋势：由自定义行业关键词和股票池匹配决定。
- 估值支撑：内测版使用基础假设，后续接财务数据。
- 风险反证：由负向事件类型和自定义排除词决定。

## 数据层

当前使用轻量 JSON store，方便快速迭代：

- 启动时若没有 `data/radar-db.json`，自动用 `server/data.js` 初始化。
- API 写入会持久化到 JSON 文件。
- 测试通过 `RADAR_DB_PATH` 使用临时数据库，不污染本地数据。

后续可将 `server/store.js` 替换为 SQLite/PostgreSQL 实现，API 层无需大改。

## MVP 后续开发顺序

1. 接入持久化数据库。
1. 增加真实数据采集任务：HKEX、SEC、公司公告、新闻、行情。
2. 增加事件去重和实体识别。
3. 接入财务和估值数据，替换内测版基础估值假设。
4. 实现 T+1/T+3/T+5/T+10/T+20 定时验证。
5. 增加飞书机器人每日推送、风险提醒和个股查询。
6. 增加模型权重版本历史页面。

## 个人版提示

本系统为个人研究和复盘工具，所有内容仅用于信息整理、事件跟踪和模型验证。
## Broker OpenAPI

This app only stores read-only broker connection settings in this phase. Trading endpoints are intentionally disabled.

Futu:

1. Start Futu OpenD locally.
2. In Web, open `事件录入 -> 券商开放 API`.
3. Enable Futu and keep the default `127.0.0.1:11111` unless your OpenD uses another port.
4. Click `测试富途 OpenD`.

Tiger:

1. Prepare Tiger `Client ID`, `Account`, `License`, and the local private key file.
2. Fill the private key absolute path in Web.
3. Click `测试老虎配置`.

CLI checks:

```powershell
npm run brokers
npm run brokers -- futu
npm run brokers -- tiger
npm run brokers -- ibkr
npm run brokers -- chief
```

IBKR:

1. Start Trader Workstation or IB Gateway locally.
2. Enable API socket access in TWS / Gateway.
3. Use `127.0.0.1:7497` for paper mode, or your configured IBKR port.
4. Click `测试 IBKR`.

Chief Securities:

Chief Securities currently has no public OpenAPI document wired into this project. The app keeps an official-API-only placeholder and refuses App private API scraping.

## GitHub and Vercel

This project includes:

- `vercel.json` for Vercel routing.
- `api/index.js` as the Vercel serverless entry.
- `.github/workflows/test.yml` for GitHub Actions tests.

Deploy flow:

```powershell
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

Then import the GitHub repository in Vercel.

Vercel note: the current JSON store uses temporary storage on Vercel. It is fine for preview and internal demos, but production use should move persistence to a database such as Vercel Postgres, Supabase, Neon, or another managed database.
