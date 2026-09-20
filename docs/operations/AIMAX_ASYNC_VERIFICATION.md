# AImAX asynchronous Provider verification

FACT: User supplied AImAX gpt-image-2.5 asynchronous task documentation.
DECISION: Continue the user-authorized Provider fix and deployment.
IMPLEMENTATION_CHOICE: Sunburst, auto aspect ratio, 1k default; original photo via 600-second COS signed GET URL. No style reference is sent.

- PASS local-code: 125/125 automated tests, lint, build, git diff --check.
- PASS browser: user desktop/mobile/minimum-mobile checks; admin desktop/mobile/minimum-mobile, successful save and failed retry with retained key.
- PASS connection: Git-bundled E:/Program Files/Git/usr/bin/ssh.exe established verified-host public-key connection; Windows OpenSSH failures do not prove a server authentication problem.
- PENDING server: deploy and compare SHA-256 file hashes.
- PENDING real-business: owner-held AImAX key has not been used in a real image request during this verification. Mock tests establish protocol behavior only.

Polling submits once, handles HTTP-200 failed status as failure, requires valid works asset_url, and has a bounded deadline. A timeout cannot cancel a remotely accepted task; check supplier task history before resubmitting. Admin test jobs are in memory; a service restart loses their polling state.

