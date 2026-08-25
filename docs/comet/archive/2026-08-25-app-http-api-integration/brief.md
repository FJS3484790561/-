# Outcome

提供一个可本地运行和自动化验证的同源 HTTP API，将浏览器 Surface 连接到现有认证、生成、作品、额度、订单和管理员 Provider 服务。

# Scope

- 使用 Node HTTP 运行时提供 `/api` 路由和 JSON 请求/响应边界。
- 提供注册、登录、退出、会话查询和密码找回接口。
- 通过 HttpOnly、SameSite 会话 Cookie 认证浏览器请求。
- 提供生成创建/查询、作品创建/查询、额度余额、订单创建/查询接口。
- 提供管理员 Provider 配置与审计接口，并验证管理员权限。
- 保留支付 Provider 回调适配边界，但不接入真实支付平台。

# Non-goals

- 不实现浏览器页面；由后续用户端和管理员端子 Change 完成。
- 不引入生产数据库、真实邮件、真实支付或真实图像 Provider。
- 不配置服务器、域名、HTTPS 证书或生产凭据。

# Acceptance examples

- A1: 本地 HTTP Server 可启动、响应 `/api/health`，并对未知路由返回安全的 JSON `NOT_FOUND`。
- A2: 注册、登录、会话查询、退出和密码找回路由调用现有 AuthService；登录成功设置 HttpOnly、SameSite Cookie，未认证请求返回 `UNAUTHORIZED`。
- A3: 已认证用户可通过 HTTP 创建和查询生成任务；图片和参数进入现有 GenerationService，任务所有权隔离保持有效。
- A4: 已认证用户可查询额度、创建/查询订单、创建/列表/读取作品；其他用户不能读取其订单或作品。
- A5: 管理员 Provider 路由调用现有 AdminProviderService；普通用户和未登录用户不能读取或修改 Provider 配置，公开响应不包含密钥明文。
- A6: API 统一限制 JSON 请求大小、校验 Content-Type、返回安全错误，不向响应或日志暴露会话令牌、密码、Provider 密钥、支付签名或内部异常。
- A7: 自动化测试覆盖健康检查、认证 Cookie、用户隔离、生成、作品、额度、订单、管理员权限、请求限制和错误脱敏；test、lint、build、typecheck 全部通过。

# Constraints and invariants

- 现有服务模块仍是业务规则唯一来源，HTTP 层不得复制或绕过额度、支付、认证和管理员权限规则。
- Cookie 在生产模式必须带 `Secure`；本地测试允许关闭 Secure，但仍要求 HttpOnly 和 SameSite=Lax。
- 会话令牌只通过 Cookie 进入服务，不得写入 URL、JSON 响应、日志或持久化文档。
- 当前 Store 仍为内存实现，进程重启丢失数据是已知限制。

# Decisions

- 使用 Node 内置 HTTP 和 Web Request/Response API，避免为薄适配层增加框架依赖。
- 浏览器上传通过受限 JSON base64 载荷进入现有图片校验边界；生产对象存储和 multipart 由后续生产化工作处理。
- 子 Change 使用 worktree，完成后 merge 到 `comet/cross-surface-qa-release-readiness`。

# Open questions

- 无。范围由已确认 Supervisor Shape 严格派生。

# Verification expectations

- npm test
- npm run lint
- npm run build
- npm run typecheck
- 新的独立只读 Verifier 逐项核对 A1-A7，特别检查 Cookie、安全错误和密钥脱敏。
