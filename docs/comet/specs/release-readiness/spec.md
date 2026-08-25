# Cross-surface release readiness

## Integrated surfaces

The local paid-MVP baseline provides user authentication and password recovery, the design workbench, simulated generation with a keyboard-operable before/after comparison, works and credit/order entry points, and an administrator surface at `/admin`. Browser flows use the existing HTTP API boundary and preserve server-side authentication, credit, order, and administrator authorization rules.

## Responsive and accessible behavior

The user and administrator surfaces remain usable at desktop, 390px, and 320px widths without horizontal overflow, clipped essential text, or overlapping primary controls. Interactive controls expose understandable names and visible focus. The before/after control supports pointer and keyboard input and keeps both comparison labels readable.

## Security boundaries

Anonymous, normal-user, and administrator capabilities remain separated according to the existing service contracts. Public responses, user-visible errors, source files, logs, screenshots, and frontend build output do not expose test secrets, merchant credentials, Provider keys, or production configuration.

## Verification and reporting

Automated tests, lint, build, JavaScript syntax/module checking, combined browser QA, permission checks, and sensitive-data checks are recorded without suppressing failures. The readiness report distinguishes locally implemented and verified capabilities from outstanding production database, hosting, domain, real payment, real Provider, email delivery, and secret-management work.

## Release boundary

This capability produces QA evidence and a readiness assessment only. It does not deploy, push remotely, configure a domain, execute a real payment, write production credentials, or grant release approval.
