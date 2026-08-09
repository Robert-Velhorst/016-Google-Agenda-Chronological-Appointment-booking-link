# Final verification report

Evidence recorded on 2026-08-09 for branch `main`.

## Automated and local acceptance

| Check | Result |
| --- | --- |
| `npm run check` | PASS: syntax for 25 JavaScript files, manifest, and icons |
| `npm test` | PASS: 31 Node tests plus the content-script suite |
| `npm run build` | PASS: Vite 8 build; 226.94 kB JS (69.96 kB gzip), 13.78 kB CSS |
| `npm audit --omit=dev` | PASS: 0 vulnerabilities |
| Windows 11 setup | PASS: existing `.env` preserved, clean `npm ci`, build, three migrations, and doctor |
| Windows launcher/runtime | PASS: `/healthz` returned `ok`; hashed assets returned immutable caching and `content-encoding: gzip` |
| HAI compatibility | PASS: real local companion proxy returned one owner-scoped read-only item with cursor; requester PII excluded |
| GitHub Actions | PASS: run `31286138998` for implementation commit `d131bed` |
| Requested in-app Browser | BLOCKED: installed/discoverable, but its webview repeatedly timed out while attaching after documented reconnect |

## Production controls verified

- Buffer-aware Google and local conflict windows; pending/confirmed reservations also hide public slots.
- Short SQLite reservation transactions; provider calls stay outside the lock; an added booking lookup index supports conflict queries.
- Deterministic event IDs, idempotent retries, ETags, provider pagination/timeouts, refresh deduplication, and transient-refresh preservation.
- Bounded operator reconciliation: found events become confirmed, definitive 404s release unchanged reservations, and transient failures remain unresolved.
- Admin/HAI redaction of management tokens, hashes, idempotency keys, and ETags; HAI requester PII is opt-in and off by default.
- Complete export is not capped at the 500-row admin display limit. Google must be disconnected before deleting the local revoke credential.
- Bounded in-process rate-limit memory, strict production URL/origin/boolean configuration, safe malformed-path/date errors, static gzip/caching, and a reduced runtime dependency set.
- The extension now parses combined hour/minute labels and reacts to live text and duration-attribute changes.
- The ngrok launcher derives the real temporary HTTPS URL, aligns production/OAuth configuration, verifies local and public health, and cleans up exact child processes on failure.

## External acceptance still blocked

- Live Google OAuth consent, FreeBusy, event/attendee/reminder delivery, reschedule, and cancellation require owner-provided credentials and a disposable calendar.
- The shared Docker daemon timed out on read/build operations while unrelated user containers were active. Docker Desktop and those containers were not disrupted.
- ngrok 3.39.8 is installed and configured, but the account endpoint is already online elsewhere (`ERR_NGROK_334`). The unrelated endpoint was not stopped or pooled.
- Current rendered desktop/mobile QA cannot be re-certified until the requested in-app Browser webview attaches. Earlier screenshots are not reused as proof for this revision.

No blocked item is presented as passed or production-live.
