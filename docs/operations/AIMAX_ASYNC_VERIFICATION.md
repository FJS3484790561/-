# AImAX asynchronous Provider verification

FACT: User supplied AImAX gpt-image-2.5 asynchronous task documentation.
DECISION: Continue the user-authorized Provider fix and deployment.
IMPLEMENTATION_CHOICE: Sunburst, auto aspect ratio, 1k default; original photo via 600-second COS signed GET URL. No style reference is sent.

- PASS local-code: 125/125 automated tests, lint, build, git diff --check.
- PASS browser: user desktop/mobile/minimum-mobile checks; admin desktop/mobile/minimum-mobile, successful save and failed retry with retained key.
- PASS connection: Git-bundled E:/Program Files/Git/usr/bin/ssh.exe established verified-host public-key connection; Windows OpenSSH failures do not prove a server authentication problem.
- PASS server: API active and public tunnel health HTTP 200 ready. Deployed index-BqI9s_rh.js and AdminApp-CHoHxN_j.js; SHA-256 of index.html, aimax-provider.js and app-runtime.js match local build. Rollback backup: /home/ubuntu/ai-interior-backups/aimax-1789912054000; previous web root: /var/www/ai-interior-app.previous-aimax-1789912054000.
- PENDING real-business: owner-held AImAX key has not been used in a real image request during this verification. Mock tests establish protocol behavior only.

Polling submits once, handles HTTP-200 failed status as failure, requires valid works asset_url, and has a bounded deadline. A timeout cannot cancel a remotely accepted task; check supplier task history before resubmitting. Admin test jobs are in memory; a service restart loses their polling state.

## 2026-09-20 base endpoint regression fix

FACT: Trace provider_test_442100a2-487a-497e-870d-ab934a832b45 selected multipart-image-edit and received HTTP 404, Invalid URL (POST /v1). The AImAX detector previously required the complete generations path.
DECISION: Continue the user's authorized Provider repair and deployment under the previously approved Lite recovery; preserve historical Comet state.
IMPLEMENTATION_CHOICE: Recognize the exact HTTPS AImAX host with root, /v1, or /v1/images/generations (optional trailing slash); normalize submission to /v1/images/generations. Other hosts, models, paths, credentials, query strings and fragments are not rewritten.

- PASS local-code: node --test 132/132; ESLint and git diff --check. Tests cover all six accepted URL spellings through the admin test flow, one POST plus authenticated polling, and formal generation from /v1.
- PASS server: deployed aimax-provider.js SHA-256 3d24c86999a20f3dcaa214fbc804696b3b98b16bb2ac5450890d032a5757d1a0 matches local. Server module recognizes /v1 and resolves the complete generations endpoint. API active; public health returned HTTP 200 ready.
- N/A browser/build: backend-only module change; no frontend artifact changed.
- PENDING real-business: no new paid AImAX task submitted in this verification; owner must retry the failed new Provider form. Mock success is not real image-generation acceptance.
- PASS rollback: prior module saved at /home/ubuntu/ai-interior-backups/aimax-endpoint-20260920/aimax-provider.js; restore that file and restart ai-interior-api if needed. No database or secret configuration changed.
