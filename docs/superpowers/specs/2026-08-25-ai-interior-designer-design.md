# AI 室内设计师 Design

Status: DRAFT. This design records confirmed discovery decisions and proposed implementation boundaries. It does not authorize production business implementation.

## Product

AI 室内设计师 helps ordinary household users preview an interior design change from one real room photo. The first release is a paid self-service web app with a workbench-first flow.

The user uploads a photo, selects room, style, renovation strength, and fixed preference toggles, then generates one result. The result is shown beside the original and in a draggable before/after comparison. The user can download or save it to a cross-device works library.

## Commercial rules

- 1 credit equals 1 generation opportunity.
- Registration grants 3 credits.
- 10 RMB grants 12 credits; 30 RMB grants 45 credits; 100 RMB grants 200 credits.
- Free and purchased credits expire 12 months after issuance/purchase.
- Credits are tracked in lots and the earliest-expiring lot is consumed first.
- Generation failure does not consume a credit.
- Purchased credits have no default refund policy, subject to payment-provider and applicable legal requirements.

## Visual direction

Balanced Claymorphism: soft candy accents, large rounded surfaces, combined inner/outer shadows, generous spacing, clear photo/result hierarchy, and accessible focus/reduced-motion behavior. The current React + Vite screen is prototype-only visual evidence.

## Scope exclusions

No custom prompt text, camera capture, batch generation, subscriptions, promotions, teams, multi-role operations, user-managed API keys, or full provider matrix in the chargeable MVP.

## Architecture summary

The browser talks only to the app API. The app API owns auth, validation, credit state, generation orchestration, works, orders, and admin authorization. A provider registry selects server-side adapters. Storage is independent from routes and UI. Secrets never return to the browser.

## Open risks

The 100 RMB pack's unit economics need validation. Payment, AI content, privacy, and data-retention requirements need jurisdiction/provider review before release. Live provider and payment integrations remain outside the prototype.

## Approval

PROJECT_SPEC_APPROVED: YES
UI_STYLE_CONFIRMED: YES
UI_LOCK_APPROVED: YES
ARCHITECTURE_APPROVED: YES
ROADMAP_APPROVED: YES
