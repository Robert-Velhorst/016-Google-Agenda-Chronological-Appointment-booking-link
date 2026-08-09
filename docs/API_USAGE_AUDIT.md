# API Usage Audit

| Method and route | Caller | Auth/secret boundary | External effect |
| --- | --- | --- | --- |
| `GET /healthz` | Container/load balancer | Public, minimal response | None |
| `GET /readyz` | Load balancer/operator | Public, minimal response | Verifies connected state only |
| `GET /oauth/google/callback` | Google OAuth redirect | PKCE and one-time state | Stores encrypted refresh/access tokens |
| `GET /api/public/schedules/:slug` | Requester UI | Unlisted slug | None |
| `GET /api/public/schedules/:slug/slots` | Requester UI | Rate limited | Google FreeBusy read |
| `POST /api/public/schedules/:slug/book` | Requester UI | Rate limited; `Idempotency-Key` required | Google event create |
| `POST /api/public/bookings/:id/manage` | Manage UI | Manage token in JSON body | None |
| `POST /api/public/bookings/:id/reschedule` | Manage UI | Manage token in JSON body | Google event update |
| `POST /api/public/bookings/:id/cancel` | Manage UI | Manage token in JSON body | Google event delete |
| `GET /api/admin/status` | Operator UI/doctor | Bearer token | None |
| `GET, POST /api/admin/schedules` | Operator UI | Bearer token, owner scoped | Local read/create |
| `PATCH /api/admin/schedules/:id/status` | Operator UI | Bearer token, owner scoped | Google calendar verify on activation |
| `GET /api/admin/bookings` | Operator UI | Bearer token, owner scoped | None |
| `GET /api/admin/audit` | Operator UI | Bearer token, owner scoped | None |
| `POST /api/admin/google/start` | Operator UI | Bearer token | Creates OAuth authorization URL |
| `POST /api/admin/google/disconnect` | Operator UI | Bearer token | Revokes token best-effort, removes local connection |
| `POST /api/admin/emergency-stop` | Operator UI | Bearer token | Stops/resumes public mutations |
| `POST /api/admin/reconcile` | Operator UI | Bearer token | Read-only Google lookup repairs old uncertain reservations |
| `GET /api/admin/export` | Operator UI | Bearer token | Downloads local JSON export |
| `DELETE /api/admin/data` | Operator UI | Bearer token plus explicit phrase/ack | Deletes local product data, not Google events |

All routes are consumed by the shipped UI, health tooling, or OAuth redirect. There are no undocumented production mock routes. The fake calendar provider is importable only from `test/`.
