# Provider 图片编辑协议核对

状态：本地协议已实现；真实 Provider 能力与价格尚未验证；禁止据此部署。

## 已批准的产品要求

- 正式 MVP 必须把用户上传的原房间照片发送给 Provider。
- 输出应尽量保留原房间几何结构、相机视角、门窗、墙体和主要固定结构。
- `927b125` 的纯文字生图请求仅保留为历史原型证据，不再作为正式 MVP 协议。

## 本地采用的兼容协议

- 方法：`POST`
- 端点：由管理员填写明确支持图片编辑的端点，通常形如 `/v1/images/edits`
- 编码：`multipart/form-data`，边界由运行时生成，应用不手工设置 `Content-Type`
- 字段：
  - `model`：管理员配置的图片编辑模型
  - `image`：用户原始 JPEG 或 PNG 文件
  - `prompt`：空间、风格、强度、偏好及结构保留约束
  - `size`：`1024x1024`
  - `n`：`1`
  - `response_format`：`url`
- 可接受返回：`data[0].url` 或 `data[0].b64_json`
- 请求次数：一次，不自动重试
- 超时：30 秒

管理员保存门禁使用同一种 multipart 图片编辑协议和一张内置非敏感测试图。只有返回内容能验证为 JPEG/PNG 时才保存配置；失败时保留旧配置。

## 失败和额度行为

- 上游非 2xx：`PROVIDER_HTTP_ERROR`，记录脱敏 HTTP 状态。
- 超时：`PROVIDER_TIMEOUT`。
- 非 JSON、缺失图片或图片无效：`INVALID_PROVIDER_RESPONSE`。
- 正式生成失败释放额度，成功才结算 1 点；不自动重复请求。
- 日志只记录 trace ID、阶段、Provider/模型、安全错误码和 HTTP 状态，不记录密钥、请求头、原图、结果图或响应正文。

## 尚未核实的外部事实

以下项目必须从 Provider 的正式文档或经过授权的真实测试确认，当前均为 `BLOCKED`：

- `coderapi.vip` 是否提供可用的图片编辑端点，而不只是 `/v1/images/generations`。
- `gpt-image-2` 是否在该中转站支持图片文件输入和上述字段。
- 支持的原图格式、文件大小、尺寸、透明度、mask 和多图限制。
- `response_format`、返回 URL 有效期及 base64 行为。
- 单次编辑的实际价格、失败请求是否计费、限速和并发规则。
- 内容安全拒绝、429、5xx、超时及供应商错误体的稳定契约。

在上述能力至少通过一次受控真实编辑测试之前，不得把 `REAL-IMAGE-EDIT-PROVIDER` 标记为通过，也不得部署或执行真实扣点验证。

## 供应商公开资料核查（2026-08-27）

只读访问 `https://coderapi.vip/api/pricing` 得到以下供应商公开数据：

- `gpt-image-2` 的公开描述为“用于图片生成和编辑类任务”。
- 该模型公开的 `supported_endpoint_types` 只有 `image-generation`。
- 公开记录没有给出 `/v1/images/edits`、multipart 字段、原图限制、返回 URL 时效或数据留存说明。
- `quota_type: 1`、`model_price: 1` 和分组倍率属于平台内部计费数据；公开页面没有提供足以换算单次编辑人民币成本的完整公式。
- `grok-imagine-image-2.0` 同样只公开为 `image-generation`，不能作为图片编辑能力证据。

因此，“模型描述提到编辑”不足以证明当前网关实现了兼容的图片编辑端点。真实 Provider 验收继续为 `BLOCKED`。
