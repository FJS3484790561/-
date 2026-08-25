# Outcome

为工作台建立可供前端调用的统一 AI 室内设计生成契约。用户上传合规图片并选择已确认的设计参数后，系统创建一次生成任务，返回可追踪的状态，最终提供一张生成结果图；浏览器不直接接触上游 Provider 或任何密钥。

# Scope

- 提供统一的 `POST /api/generate` 生成入口和任务状态查询边界。
- 校验 JPEG/PNG 文件、请求参数和必要的尺寸/体积限制，并返回可理解的校验错误。
- 固化房间类型、设计风格、改造强度和固定偏好的参数契约；一次请求只生成一个方案。
- 提供 Provider registry 和适配器边界，支持管理员后续接入 Provider；本 Change 使用可替换的开发期 Provider/测试替身验证契约。
- 支持生成中、成功、参数错误、Provider 失败、超时和不可用等状态，并映射为稳定的安全错误结构。
- 生成成功时返回原图引用与效果图引用，供工作台展示 Before/After 对比滑块。

# Non-goals

- 不实现额度账本、扣除、过期、充值或支付订单。
- 不实现作品持久化、跨设备作品库、真实图片对象存储或邮件服务。
- 不实现管理员页面、真实 Provider 凭据配置或具体上游 Provider 集成。
- 不开放自由文字提示词、直接拍照、批量生成或多结果生成。

# Acceptance examples

- 合法 JPEG/PNG 和合法参数可以创建一个生成任务，并返回稳定的任务标识。
- 非法格式、超限文件、缺失或非法参数不会调用 Provider，并返回字段级可理解错误。
- 任务可观察地经历 `queued/running/succeeded/failed` 状态；成功只产生一个结果。
- Provider 失败、超时或不可用时，任务进入失败状态并返回不泄露上游凭据和内部细节的安全错误；不会伪造成功结果。
- 成功结果同时包含原图和效果图引用，失败结果不包含可误认为有效的效果图。
- 认证边界由现有会话基础承接；未登录请求不能创建生成任务。
- 自动化测试覆盖契约、校验、状态转换、Provider 失败/超时和响应脱敏。

# Constraints and invariants

- FACT: 项目已确认首版只支持 JPEG/PNG，一次生成一个方案。
- FACT: 浏览器不能调用上游 Provider，服务端负责验证、编排和错误映射。
- DECISION: 生成采用异步任务模型；提交后先返回任务标识，前端读取状态，避免长请求阻塞工作台。
- IMPLEMENTATION_CHOICE: 任务状态存储和开发期 Provider 使用可替换的本地实现，生产持久化和真实 Provider 留给后续 Change。
- 本 Change 不建立额度扣除规则；生成失败不得在本 Change 中触发任何额度副作用。

# Decisions

- 入口：`POST /api/generate`，另有任务状态查询边界。
- 交互：异步提交、状态查询、成功显示原图与效果图。
- 结果：每次请求最多一个方案。
- Provider：通过 registry/adapter 隔离，浏览器永不获得 Provider Token。

# Open questions

- [blocking] CONFIRM: 是否确认本 Change 采用上述范围，并采用“提交后异步生成、前端显示生成状态”的交互？

# Verification expectations

- 运行项目既有测试、lint 和 build。
- 增加服务层/API 契约测试，验证成功、校验失败、未登录、Provider 失败和超时路径。
- 通过 Runtime 检查和独立只读 Verifier 逐项验收。
