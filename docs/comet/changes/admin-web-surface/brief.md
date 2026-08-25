# Outcome

完成付费 MVP 的独立管理员网页 Surface：预置管理员可登录并通过本地 HTTP API 查看、创建、更新、启停 Provider 配置和查看审计记录，普通用户无法访问。

# Scope

- 新增独立管理员登录与会话恢复界面，使用现有邮箱密码认证和 HttpOnly Cookie。
- 新增 Provider 配置列表、空状态、创建与编辑表单、启用/停用操作。
- 新增单个 Provider 的审计记录视图。
- 接入 `/api/admin/providers*` HTTP API，并覆盖 401、403、404、验证错误与服务错误状态。
- 保持 UI Lock 的粘土拟态视觉，同时采用适合管理操作的紧凑、可扫描布局。

# Non-goals

- 不实现用户工作台、作品、额度或充值页面。
- 不展示、回填或导出 Provider API 密钥明文；编辑时仅允许提交新密钥。
- 不接入真实 Provider、生产密钥管理、数据库、服务器、域名或部署。
- 不新增管理员自助注册或前端角色提升机制。

# Acceptance examples

- A1: 未登录用户看到管理员登录界面；普通用户登录后访问控制台得到明确无权限状态，不能读取或修改 Provider 配置。
- A2: 服务器内部预置管理员登录后可查看 Provider 列表与空状态，并可创建、编辑、启用和停用配置；页面状态与 HTTP API 响应一致。
- A3: Provider 表单验证名称、端点、模型和密钥要求；保存中、成功、验证失败、冲突和服务错误状态明确且可恢复。
- A4: 所有列表、详情、表单和审计响应只展示 `apiKeyConfigured` 与掩码，不展示、记录或回填密钥明文。
- A5: 管理员可查看单个 Provider 的脱敏审计记录；请求体中的 sessionToken/providerId 不能覆盖 Cookie 或路径身份。
- A6: 管理员页面在桌面和 320-390px 移动视口无横向溢出、文字裁切或主要控件重叠；焦点可见，表单和图标按钮具有可理解名称。
- A7: 管理员端自动化测试、lint、build、typecheck/语法检查通过，并提供权限、脱敏及桌面/移动浏览器验证证据。

# Constraints and invariants

- 严格继承 Supervisor `cross-surface-qa-release-readiness` 的 A3、A4、A5 范围。
- 管理员账号只能由服务器内部 `provisionAdmin` 预置，公开注册保留管理员邮箱并返回安全冲突结果。
- Cookie 身份和服务端授权是唯一权限依据，前端路由隐藏不能替代服务端 401/403。
- Provider 密钥仅在创建/轮换时输入，不写入日志、文档、截图、Git、构建产物或 Comet 状态。
- 当前内存 Store 与本地 Provider 不代表生产配置能力。

# Decisions

- 管理员网页与用户网页是独立体验，但复用同一 HTTP API 与已锁定视觉语言。
- 管理控制台优先采用紧凑表格/列表、明确状态和模态/表单工具，不使用营销页面结构。
- UI_CHANGE_PERMISSION: APPROVED；用户已批准新增缺失管理员页面及页面结构。
- 本子 Change 由已确认 Supervisor Shape 严格派生，无新增用户可见决策。

# Open questions

- 无。目标、范围、关键决定、验收项和非目标均继承已确认 Supervisor 与 UI Lock。

# Verification expectations

- npm test
- npm run lint
- npm run build
- npm run typecheck
- 使用本地 HTTP Server 验证未登录、普通用户和管理员三类权限路径。
- 使用 Playwright 检查 Provider 创建/编辑/启停/审计、错误状态、桌面和移动布局、键盘焦点与控制台错误。
- 对源码、构建产物和页面输出执行敏感信息检查。
- 独立只读 Verifier 逐项核对 A1-A7。
