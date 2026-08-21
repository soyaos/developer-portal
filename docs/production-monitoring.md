# SoyaOS Cloud Public Preview 生产监控与告警

本文是 `v0.2.0-preview.1` 的值班手册。目标是在不持有用户凭证、不写入生产数据的
前提下，持续发现公开入口不可用，并让 429、平台 5xx、延迟、Trace 写入失败和 Workers
AI 用量都能被定位和处置。

## 监控覆盖

| 信号 | 数据源 | 频率 / 保留 | 入口 |
|---|---|---|---|
| Portal、API、Cloud 别名、状态页和生产 E2E 路由门禁 | GitHub Actions `Monitor production` | 每 5 分钟 | [Actions](https://github.com/soyaos/developer-portal/actions/workflows/production-monitor.yml) |
| 请求量、错误率、CPU、执行时长 | Cloudflare Workers Metrics | 实时聚合 | Workers & Pages → `soyaos-developer-portal` → Metrics |
| 429、5xx、延迟和 token 数 | Workers Logs 结构化事件 | 100% 采样；按当前套餐保留 | Workers & Pages → `soyaos-developer-portal` → Observability |
| Worker、AI、D1 调用链 | Cloudflare Workers Traces | 100% 采样（Preview 低流量期） | 同上 → Traces |
| Trace / 用量元数据写入失败 | `soyaos.inference.metadata_write_failed` | 每次失败一条 | 同上 → Logs / Query Builder |
| Workers AI Neurons 和费用 | Cloudflare Workers AI Usage | 每日检查；故障时立即检查 | AI → Workers AI → Usage |

定时探测只执行八项公开只读合同，不登录、不创建 Key，也不发送真实推理请求。GitHub
Actions 的计划任务可能因平台繁忙而延迟，因此它是 Preview 告警，不是 SLA 探针。

## 一次性开启失败通知

计划任务失败通知会发送给创建或最后修改 cron 的 GitHub 用户。该用户需要完成一次个人
设置：

1. 打开 <https://github.com/settings/notifications>。
2. 找到 **System → Actions**。
3. 选择 **Email** 或 **On GitHub**。
4. 选择 **Only notify for failed workflows**，保存。
5. 打开仓库 <https://github.com/soyaos/developer-portal>，点击 **Watch → Custom**，确认
   **Actions** 已勾选。

以后如果计划任务被禁用并重新启用，执行该操作的用户会成为新的通知接收者。

## 日常查询

在 Cloudflare 的 `soyaos-developer-portal → Observability → Query Builder` 选择最近 5
分钟。结构化日志只包含以下白名单字段：`requestId`、公开模型别名、是否流式、HTTP
状态、结果分类、稳定错误码、耗时和 token 数；不包含租户 ID、API Key、Authorization、
prompt、response 或底层异常文本。

常用查询：

```text
event = "soyaos.inference.completed" AND statusCode >= 500
event = "soyaos.inference.completed" AND statusCode = 429
event = "soyaos.inference.completed" AND latencyMs > 30000
event = "soyaos.inference.metadata_write_failed"
```

分析一段时间的趋势时，把 `statusCode` 或 `errorCode` 加到 **Group By**，把 Visualization
设为 **Count**。要追查单次请求时，只使用响应返回的 `requestId` 查询，不让用户发送
API Key 或完整请求正文。

## 阈值与级别

| 级别 | 触发条件 | 第一动作 |
|---|---|---|
| P0 | 鉴权绕过、跨租户可见、完整 Key 或用户正文进入日志 | 立即停止开放注册和新 Key 创建，保全日志并启动凭证轮换 |
| P1 | 定时探测连续失败 2 次；或平台 5xx 比例连续 5 分钟超过 10% | 手动复跑探测，确认影响面；不能在 10 分钟恢复则回滚 |
| P1 | `metadata_write_failed` 在 5 分钟窗口内大于 0 | 检查 D1 和对应 `requestId`，验证 24 小时 Trace 与配额记录 |
| P1 | Workers AI 当日达到 10,000 Neurons，或出现非预期账单 | 暂停新增用户与 Key，检查模型和滥用流量 |
| P2 | 429 比例连续 5 分钟超过 30% | 按 `errorCode` 区分正常配额命中与容量 / 滥用问题 |
| P2 | 推理 `latencyMs` 的 p95 连续 5 分钟超过 30 秒 | 检查 Workers Traces 和 Workers AI 状态，记录基线变化 |
| 成本预警 | Workers AI 当日达到 8,000 Neurons | 当天停止扩大发布，核对调用量、token 和模型用量 |

`10,000 Neurons/日` 是 Workers AI 账号级免费分配，不是单个 Worker 独享；如果账号已在
付费计划，超过免费分配会按模型 Neuron 费率计费。上线前如修改内部预算，必须同步修改
本表，不能只改口头约定。

### API Key 创建成本熔断

`operational_flags.api_key_creation` 是独立的运行时开关。`enabled=0` 时，只有创建新 Key
的请求返回 `503 api_key_creation_paused` 和 `Retry-After: 300`；现有 Key 的查询、撤销、
Models 和 Chat 不受影响。开关记录不含凭证或用户数据，缺失或值异常时按关闭处理。

先查询再操作；production 使用根数据库，staging 使用独立环境：

```bash
cd /Users/zealot/workspace/soyaos/developer-portal
npx wrangler d1 execute soyaos-cloud-preview --remote --command \
  "SELECT name, enabled, updated_at, note FROM operational_flags WHERE name = 'api_key_creation'"
npx wrangler d1 execute DB --remote --env staging --command \
  "SELECT name, enabled, updated_at, note FROM operational_flags WHERE name = 'api_key_creation'"
```

达到 10,000 Neurons、出现非预期账单或 P0 凭证事件时，暂停 production 新 Key 创建：

```bash
npx wrangler d1 execute soyaos-cloud-preview --remote --command \
  "UPDATE operational_flags SET enabled = 0, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, note = 'workers_ai_cost_threshold' WHERE name = 'api_key_creation'"
```

命令必须显示一行更新；随后复跑 `SELECT` 确认 `enabled=0`。故障解除并完成成本复核后恢复：

```bash
npx wrangler d1 execute soyaos-cloud-preview --remote --command \
  "UPDATE operational_flags SET enabled = 1, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, note = 'restored_after_cost_review' WHERE name = 'api_key_creation'"
```

staging 演练使用同样 SQL，但数据库参数必须替换为 `DB --remote --env staging`。演练结束
必须查询确认 `enabled=1`；production 只查询默认值，不为演练短暂关闭。

## 告警处置

### 1. 定时公开探测失败

1. 打开失败的 [Monitor production](https://github.com/soyaos/developer-portal/actions/workflows/production-monitor.yml)，展开 **Run read-only production probe**，记下首个失败的检查名。
2. 在本地手动复跑：

   ```bash
   cd /Users/zealot/workspace/soyaos/developer-portal
   PREFLIGHT_RETRY_ATTEMPTS=3 PREFLIGHT_RETRY_DELAY_MS=2000 npm run preflight:production
   ```

3. 只有 `portal-home` 失败：查看 Worker deployment 和 Portal 路由。
4. 只有 `api-anonymous-contract` 失败：检查 API 自定义域、Worker 路由和鉴权入口；不要用
   用户 Key 验证。
5. `cloud-canonical-redirect` 或 `public-status-page` 失败：检查对应 Custom Domain 的 DNS、
   TLS 和路由。
6. 两次连续失败，按 P1 处理；若刚完成部署，先确认失败是否只发生在域名传播窗口。

### 2. 推理 5xx 或高延迟

1. 用上述结构化查询筛选时间窗口，复制一个 `requestId`。
2. 在 Traces 中查询该请求，判断时间消耗在 Worker、D1 还是 Workers AI binding。
3. 同时打开 Workers AI Usage / Status，确认是否为模型上游故障或账号用量异常。
4. 平台 5xx 超过 10% 且持续 5 分钟，停止扩大发布；10 分钟内无法恢复则执行发布回滚
   手册。不要因为上游错误而临时记录 prompt / response。

### 3. Trace 写入失败

1. 查询 `event = "soyaos.inference.metadata_write_failed"`，按 `phase` 分组。
2. 使用事件中的 `requestId` 检查 D1 `inference_reservations` 和 `request_traces`，不要查询
   或复制用户正文。
3. 确认 D1 可用性、迁移版本和 Worker 当前 deployment 一致。
4. 任意失败都按 P1 处理，因为这会影响配额结算和用户的 24 小时 Trace 合同。

### 4. 429 激增

1. 按 `errorCode` 分组：`rate_limit`、`concurrency_limit`、`daily_request_limit`、
   `daily_token_limit` 是用户配额命中，不等同平台故障。
2. 检查是否集中在异常 IP / 自动化调用；不得把租户 ID 或 Key 加进长期日志。
3. 如果 429 来自大范围正常用户，停止扩大发布并评估容量；Preview 期间不临时提高单用户
   合同配额。

## 手动验证命令

在 GitHub 上立即运行并等待结果：

```bash
gh workflow run production-monitor.yml --repo soyaos/developer-portal
gh run list --repo soyaos/developer-portal --workflow production-monitor.yml --limit 3
```

通过标准：八项检查全部通过，输出 `result: "pass"`，并且整个任务不读取 GitHub Secrets。

## 事实来源

- [Cloudflare Workers Logs 与结构化字段](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Cloudflare Observability Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/)
- [Cloudflare Workers Metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/)
- [Cloudflare Workers Traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Cloudflare Workers AI 定价与 Neurons](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [GitHub Actions 计划任务与通知](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)
