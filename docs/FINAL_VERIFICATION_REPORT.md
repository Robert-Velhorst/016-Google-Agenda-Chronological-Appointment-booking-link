# Final verification report

Evidence recorded on 2026-08-09 for branch `main`.

## Automated and local acceptance

| Check | Result |
| --- | --- |
| `npm run check` | PASS: JavaScript syntax, manifest, and extension icons |
| `npm test` | PASS: 20 backend/API/policy/provider tests plus the content-script suite |
| `npm run build` | PASS: Vite 8 production build; 225.32 kB JS (69.55 kB gzip), 13.78 kB CSS |
| `npm audit --audit-level=high` | PASS: 0 vulnerabilities |
| Windows 11 setup | PASS: fresh `npm ci`, secure `.env` creation, build, two migrations, and doctor |
| Windows launcher | PASS: `start-windows.cmd` served `GET /healthz` with `{"status":"ok"}` |
| Compose parsing | PASS: base stack and HAI overlay with explicit production variables |
| Browser QA | PASS in the requested Codex in-app Browser; desktop slot selection and mobile step progression, no console warnings/errors |
| HAI API | PASS: separate bearer authentication, owner-scoped cursor pagination, and secret-exclusion tests |

## Browser evidence and reference comparison

The public booking page now uses the reference's white/cobalt three-step structure, calendar month grid, chronological time column, details/review card, manage-booking strip, and compact mobile stepper. The desktop flow updates the booking summary after selecting a time. At the mobile breakpoint only the current step is rendered, and both Next transitions were exercised. This progressive behavior is an intentional accessibility and small-screen simplification.

The Browser's standard screenshot call tiled desktop frames incorrectly; a clean developer-protocol capture proved the rendered mobile state. DOM snapshots, page identity, interaction state, and console logs remained healthy.

## Production controls verified in code/tests

- Provider network timeouts, Google event pagination, refresh deduplication, and fail-closed result limits.
- Short SQLite reservation transactions with provider calls outside transactions and deterministic reconciliation after ambiguous responses.
- Cross-schedule overlap prevention, safe idempotent retry, ETag-aware updates/deletes, and emergency-stop reschedule protection.
- HSTS on HTTPS, strict public-origin validation, dedicated HAI credentials, bounded feed pagination, and no management/OAuth secrets in HAI items.
- Read-only container root, dropped capabilities, no-new-privileges, bounded processes/CPU/memory, writable owned data volume, and reduced Docker context.

## External acceptance still blocked

- Live Google OAuth consent, FreeBusy, event/attendee/reminder delivery, reschedule, and cancellation require owner-provided Google OAuth credentials and a disposable test calendar. The application reports provider-not-ready until that is completed.
- Docker Compose files parse, but the local Docker daemon timed out on both the image build and a trivial container run while unrelated user containers were active. Docker Desktop was not restarted because that would disrupt those services.
- ngrok 3.39.8 is installed and its configuration validates, but the account's configured endpoint is already online elsewhere (`ERR_NGROK_334`). The unrelated endpoint was not stopped and traffic was not pooled into this test app.

No blocked item is presented as passed or production-live.
