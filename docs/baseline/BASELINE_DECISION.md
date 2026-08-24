# Baseline Decision

BASELINE_DECISION_STATUS: APPROVED

## Decision
- Kind: `NO_BASELINE`
- Repository URL: N/A
- Fixed tag / commit: N/A
- Reason: 从空项目开始，避免未审计的外部代码和许可证约束。

## Authorization
- User allowed external repository search: NO
- User approved adoption: N/A

## Notes
- A framework starter or ordinary dependency is not a repository baseline.
- Do not search, clone, copy, or adopt an external repository without the applicable user authorization.

BASELINE_DECISION_APPROVED: YES
## Classification ledger

Every material statement in this artifact must be classified and supported:

| ID | Classification: FACT / DECISION / IMPLEMENTATION_CHOICE | Statement | Evidence / approval / rationale | Status |
|---|---|---|---|---|
| F-001 | FACT | 当前项目目录没有现有代码仓库基线。 | Evidence: workspace inspection on 2026-08-25. | CONFIRMED |
| D-001 | DECISION | 采用 `NO_BASELINE`，不搜索、克隆或复制外部仓库。 | User approval: 2026-08-25, “可以”。 | CONFIRMED |
| I-001 | IMPLEMENTATION_CHOICE | 使用 React + Vite 作为空项目技术 bootstrap。 | 可逆、依赖边界清晰，且适合当前 UI prototype。 | PROPOSED |

