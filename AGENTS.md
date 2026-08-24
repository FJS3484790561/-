# AI Dev Workflow Project Rules

This project uses the `ai-dev-workflow` control plane before Comet Native handoff.

## Lifecycle

- User-approved artifacts are gates; do not silently approve scope, UI, baseline, architecture, roadmap, or release.
- During discovery, `docs/comet/runtime.json` is the temporary planning state and `docs/comet/CURRENT_STATE.md` is its projection. Formal business rules wait until the post-handoff Comet Runtime enters Build; pre-Comet code must be bootstrap or explicitly marked prototype-only.
- After explicit Comet Native handoff, Comet Runtime and the active Change are the only lifecycle authority.
- Evidence is required for verification; use `PASS`, `FAIL`, `N/A` with a reason, or `WAIVED` with approver and rationale. Preserve `FACT`, `DECISION`, and `IMPLEMENTATION_CHOICE` in formal documents.
- Keep secrets out of source, documents, prompts, logs, Git, screenshots, and Comet state.

## Project-specific notes

- Baseline: `NO_BASELINE`, confirmed by the user on 2026-08-25.
- Discovery is being conducted under AI Dev Workflow; pre-Comet UI work must remain `prototype-only`.
- Do not add production authentication, payments, provider calls, persistence, or authoritative quota rules before Comet Build for an approved Change.
- Do not use external repositories as a project foundation without a new explicit approval.

