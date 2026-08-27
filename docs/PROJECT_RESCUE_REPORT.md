# 项目救援报告

审计日期：2026-08-27

当前最完整实现位于本 worktree，分支为 `codex/paid-mvp-recovery`（来源：`comet/production-generation-provider`），基线 HEAD 为 `672163c580d1b8a0c96008b0f8d6570804f1666c`。Provider、生成服务、管理员 UI/API、HTTP、持久化和浏览器测试改动均保留为未提交工作区修改。

目标分支 `comet/production-paid-mvp-launch` 当前仍停在同一基线，尚未合并这些改动。未发现本地可核实的生产部署版本记录，无法判断服务器与本地一致。

已实现或已有本地证据包括 Provider 管理员配置与密钥脱敏、保存前测试门禁、生成与额度事务路径、持久化/API、管理员及用户页面和浏览器测试。真实 Provider 凭据、生产网络、COS、部署、邮箱全流程、额度码、支付及本轮独立 Runtime 验证仍待真实环境验证。

需要重点复核的业务风险：未配置 Provider 时不得以本地回显冒充成功；endpoint 必须执行 HTTPS、凭据 URL、DNS 和私网地址校验；Provider 测试必须验证真实图片内容；请求超时应能取消底层网络请求。

Comet Change 保持原样，未 Archive、未重派 Verifier、未修改 Runtime。救援整合仅建立本地分支并保留审计确认的业务改动、测试和本报告。
