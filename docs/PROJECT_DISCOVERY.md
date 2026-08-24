# Project Discovery

PROJECT_DISCOVERY_STATUS: DRAFT

## Problem and outcome
- FACT: Ordinary households need a low-effort way to preview interior design changes from a real room photo. Evidence: user request and supplied requirements reference.
- DECISION: Paid self-service AI interior design web app for ordinary household users.
- DECISION: One comparable design result from one uploaded photo without requiring AI expertise.

## MVP
- DECISION: Email/password account, password reset, 3 free generations, photo upload, preset room/style/renovation choices, fixed preference toggles, one result per generation, before/after slider, download, cross-device works library, one-time credit packs, and basic admin provider configuration.
- DECISION: 1 credit = 1 generation; 10 RMB = 12 credits; 30 RMB = 45 credits; 100 RMB = 200 credits; all credits expire after 12 months; no default refund for purchased credits subject to applicable requirements.
- DECISION: Workbench-first UI with balanced Claymorphism.
- DECISION: Non-goals are custom prompts, camera capture, batch generation, subscriptions, promotions, teams, multi-role operations, full provider matrix, and user API keys.

## Happy path
1. Register/sign in; new users receive 3 credits.
2. Upload JPEG/PNG and choose room, style, strength, and fixed preferences.
3. Submit one generation; validate input and credit state; return one result or actionable failure.
4. Compare original/result with a draggable slider; download or save.
5. Buy a pack when needed; record the credit lot and expiry.

## Risks
- IMPLEMENTATION_CHOICE: 100 RMB / 200 credits may be uneconomic; validate provider cost and payment fees.
- FACT: Payment, privacy, content and retention duties depend on jurisdiction/providers; review before launch.
- IMPLEMENTATION_CHOICE: Current Vite screen is prototype-only and uses mock generation.

PROJECT_DISCOVERY_APPROVED: NO

