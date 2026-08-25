# Project Specification

PROJECT_SPEC_STATUS: DRAFT
PROJECT_SPEC_APPROVED: YES

## Confirmed scope
- Email/password auth and email password reset.
- 3 free credits; 1 credit produces 1 generation.
- JPEG/PNG upload; room, style, renovation strength, and fixed preference controls.
- One result per request; original/result side-by-side and draggable before/after slider.
- Download and cross-device works library.
- Packs: 10 RMB/12 credits, 30 RMB/45 credits, 100 RMB/200 credits.
- Free and purchased credits expire after 12 months; no default purchased-credit refund subject to applicable requirements.
- Admin-only provider configuration; tokens never reach users.

## Non-goals
Custom prompt, camera capture, batch generation, subscriptions, promotions, teams, multi-role operations, full provider matrix, user API keys.

## Acceptance
- User completes the core flow on desktop and 320-390px mobile.
- Empty, loading, validation error, provider failure, success, insufficient/expired credit, and disabled states are understandable.
- Production credit state is server-authoritative; secrets are encrypted and redacted.

## Evidence boundary
Current React + Vite UI is prototype-only and not production acceptance evidence.
