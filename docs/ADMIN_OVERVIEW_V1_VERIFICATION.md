# 管理员总体数据 V1 — 本地验收

日期：2026-09-08。用户已批准开发，并于本地验收完成后另行批准部署；部署结果仍须以服务器证据为准。

## 实现范围

- 新增只读 `GET /api/admin/overview`，未登录 401、普通用户 403、未连接 SQLite 503。
- 管理员页面展示用户、生成任务、生成成功率、作品、点数、兑换码、Provider 和存储对象八类数据。
- 支持加载、失败重试、手动刷新；管理员修改 Provider 或创建兑换码后自动刷新。
- SQLite 聚合查询使用一致的只读事务快照，不将历史作品的图片 JSON、账号资料或密钥返回给浏览器；没有数据库迁移。

## 统计口径

- 今日及近 7 日按北京时间；近 7 日包含今天和前 6 个自然日，截至查询时刻。
- 用户总量包含管理员；作品数量为当前保存记录，不是累计保存次数。
- 成功率为成功 /（成功 + 失败），排队/运行中任务不计入分母；无完成任务时显示横线。
- 生成任务包含主生成和二次修改；不把 Provider 保存测试当作用户生成任务。
- 可用点数排除过期、已消耗和预留额度；累计发放来自 grant 流水。
- 兑换次数不是去重用户总数；剩余名额为各兑换码剩余次数之和。
- 存储统计仅来自应用存储元数据，不表示整个 COS 桶真实用量或账单；支付收入未纳入。
- 查询仍需扫描相关 JSON 字段。已测试多 MB 历史作品不扩大 API 响应，但未进行生产规模性能测试。

## 验证证据

验证执行：completed。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 完整本地测试 | PASS | `npm test`：89/89，0 failed |
| 代码规范 | PASS | `npm run lint`：退出码 0 |
| 生产构建 | PASS | `npm run build`：退出码 0，1817 modules |
| 定向 API /统计 | PASS | 16/16，覆盖鉴权、空库、数据库不可用、近 7 日边界、过期点数、刷新、脱敏和只读 |
| 浏览器本地回归 | PASS | `npm run qa:browser`：用户端桌面/390px/320px；管理端普通用户 403、桌面/390px/320px |
| 总览交互 | PASS | 8 张卡片、SQLite 真实计数、刷新加载态、500 重试、兑换码创建后刷新 |
| 服务端生产数据 | BLOCKED | 本轮未部署或访问生产服务器，不能声称生产验收通过 |
| 发布 | BLOCKED | 部署已获批准但尚未完成；本次不触碰 DNS、支付及 `.comet` |

浏览器检查使用隔离的临时 SQLite 与本地 Provider stub，不调用真实 Provider、不操作生产账户。截图位于 `artifacts/admin-overview/`，包含测试环境数据，不是生产截图。

## 修改文件

- `server/admin-overview-service.js`
- `server/admin-overview-service.test.js`
- `server/app-api.js`
- `server/app-api.test.js`
- `server/app-runtime.js`
- `src/AdminApp.jsx`
- `src/admin-api.js`
- `src/admin-styles.css`
- `tests/admin-surface.playwright.mjs`
- 本报告

## 下一步

生成独立部署提交；连接服务器后确认当前版本，备份数据库及上传文件，保留 `.env.production` 与密钥并准备旧版本回滚。部署完成后执行健康检查、管理员总览接口鉴权和页面验证；本地通过不代表服务器已更新，原有临时文件及 Comet 历史均保留。
