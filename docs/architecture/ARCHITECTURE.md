# Architecture

ARCHITECTURE_STATUS: DRAFT
ARCHITECTURE_APPROVED: NO

## Runtime and modules
- IMPLEMENTATION_CHOICE: React + Vite prototype; production framework/runtime remains to be approved with Comet Change.
- Modules: web UI, app API, auth/session, credit ledger, generation orchestration, provider registry/adapters, works, orders, admin, storage.

## Interfaces
- POST /api/generate is the unified generation boundary.
- Browser never calls upstream providers and never receives secrets.
- Server owns validation, auth, credit mutations, order state, provider selection, and persistence.
- Provider adapters own upstream URL/auth/response parsing.

## Security/failure
Encrypt provider secrets; use short-lived HttpOnly SameSite sessions; redact logs/responses; validate image/request size, timeout, concurrency, upstream output; map failures to safe user messages. Production needs persistent storage, HTTPS, SSRF controls, rate limits, and privacy/content review.

## Prototype boundary
Current Vite app has no authoritative auth, credit, payment, provider, or persistence behavior.

