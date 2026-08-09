# Security and Privacy

## Authentication and authorization

Operator routes require a bearer token of at least 24 characters and compare it in constant time. It is stored only in browser `sessionStorage`. The app is single-owner; team roles are not implemented. Public schedule access uses a random 96-bit slug suffix, while booking management additionally requires a 256-bit token.

## Secrets

Google access/refresh tokens and recoverable manage tokens are encrypted with AES-256-GCM using `ENCRYPTION_KEY`. Manage-token verification uses SHA-256 hashes. `.env`, SQLite databases, backups, support bundles, and runtime data are gitignored. Rotate credentials by stopping the service, changing the key only after disconnecting Google/deleting encrypted records, updating OAuth secrets, restarting, and reconnecting.

## Web security

Responses set CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a restrictive Permissions Policy. APIs are same-origin and bearer-authenticated, so no cookie-CSRF surface exists. Request bodies are capped at 64 KiB. Static path resolution is constrained to `dist/`. Rate limits are per-process and therefore not a distributed control.

## Threat model

Primary risks are token theft, exposed `.env`/database backups, malicious public booking floods, cross-schedule double booking, OAuth callback forgery, and ambiguous remote mutations. Controls include PKCE/state expiry, encryption, a bounded in-process rate limiter, buffer-aware transactional overlap checks, deterministic event IDs, operator-triggered read-only reconciliation, ETags, audit logs, emergency stop, explicit provider errors, and no test-provider production path.

Residual risks: SQLite locking is per instance, so multiple replicas must not share the same calendar without a distributed lock; proxy/access logs must exclude request bodies; the operator token has full owner authority; and email invitation delivery depends on Google account settings/policy. Run behind TLS and a trusted reverse proxy in production.

## Privacy and retention

Stored PII is requester name/email and appointment timestamps. The complete operator export returns those records but excludes management tokens, token hashes, idempotency keys, and ETags. HAI excludes requester name/email by default. Local deletion requires a typed confirmation, acknowledgement that existing Google events remain, and a prior Google disconnect so the only local revoke credential cannot be orphaned. Support bundles exclude names/emails/tokens. There is no automated retention worker; define and execute a retention schedule before production use.

Report vulnerabilities privately to the repository owner. Do not open a public issue containing credentials or requester data.
