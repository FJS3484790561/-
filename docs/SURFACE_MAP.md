# Surface Map

SURFACE_MAP_STATUS: DRAFT

| surface_id | Surface | Users / roles | MVP scope | UI_REQUIRED | Auth / permissions | Boundary | Verification |
|---|---|---|---|---|---|---|---|
| user-web | User web app | Registered household user | Workbench, works, credits, account/help, purchase | YES | Email session; own data only | Browser to app API | Core flow, responsive, keyboard, states |
| admin-web | Admin console | Single administrator | Provider configuration and necessary inspection | YES | Separate admin session | Browser to admin API | Auth boundary, redaction, failures |
| app-api | Application API | User/admin server | Auth, generation, credits, works, orders, provider registry | NO | Server authorization | Unified app routes | Contract, auth, failures, redaction |

DECISION: User and admin are separate web experiences; API is the server runtime boundary. User confirmed scope; architecture remains proposed.

SURFACE_MAP_APPROVED: YES
