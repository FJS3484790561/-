# UI Lock

UI_LOCK_VERSION: 1.0
UI_LOCK_STATUS: DRAFT
UI_LOCK_APPROVED: YES

## Locked visual rules
- Balanced Claymorphism: pale warm/pink/lilac background, soft candy accents, large rounded surfaces, combined inner/outer shadows, generous whitespace.
- Rose/pink is the primary action color; mint represents original-photo/upload state; lilac represents generated-result state; amber represents notices.
- Rounded Chinese-friendly UI typography with explicit control text; no dark high-contrast theme, hard-edge shadow, or sharp-corner control.
- Room imagery remains clear and unfiltered; visual softness must not reduce image inspection.

## Locked structure and interaction conventions
- App shell: brand and primary navigation at top; workbench is the first screen.
- Workbench: left parameter panel, right original/result area; mobile collapses to one column.
- Parameters: room type, design style, renovation strength, and fixed preference toggles.
- Success state: original and generated result remain visible, followed by a draggable before/after comparison block.
- Actions: generate, replace photo, download, save work; unavailable actions are visibly disabled.
- Feedback: generation loading, validation errors, failure recovery, success, and credit notice are explicit.

## Responsive and accessibility rules
- Support desktop, tablet, and 320-390px mobile without horizontal overflow.
- Primary targets are at least 44px; all inputs have labels; icon buttons have accessible names.
- Keyboard focus is visible; status changes use live-region-equivalent announcements; status is not color-only.
- Reduced-motion mode removes spring movement while preserving state and hierarchy.

## Allowed in-range fixes
- Accessibility, browser compatibility, and defect fixes with evidence.

## Change permission
Visual or structural changes require `UI_CHANGE_PERMISSION` and a changelog entry, or a requirements Change that reopens confirmation.

## Changelog
| Version | Date | Change | Approval / evidence |
|---|---|---|---|
| 1.0 | 2026-08-25 | Initial locked candidate from confirmed prototype direction | Awaiting user approval |
## Classification ledger

Every material statement in this artifact must be classified and supported:

| ID | Classification: FACT / DECISION / IMPLEMENTATION_CHOICE | Statement | Evidence / approval / rationale | Status |
|---|---|---|---|---|
| F-001 | FACT | Prototype has been checked at desktop and 390px mobile widths. | Playwright evidence from local preview. | CONFIRMED |
| D-001 | DECISION | Balanced Claymorphism and workbench-first structure are the visual baseline. | User confirmations in discovery. | CONFIRMED |
| I-001 | IMPLEMENTATION_CHOICE | Keep accessibility and image clarity above decorative style rules. | Necessary for a usable design tool; reversible within UI Lock change process. | PROPOSED |
