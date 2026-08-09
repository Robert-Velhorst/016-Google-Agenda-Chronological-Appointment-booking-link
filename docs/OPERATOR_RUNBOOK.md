# Operator Runbook

## Start and readiness

1. Configure `.env` from `.env.example`; never commit it.
2. Run `npm ci && npm run build && npm run migrate && npm run doctor`.
3. Start with `npm start` or `docker compose up --build` behind HTTPS.
4. `/healthz` proves the process responds. `/readyz` returns 200 only when Google is connected and emergency stop is off.
5. Sign in, connect Google, create a draft, activate it, copy its public link, and perform a real booking before publishing the link.

## Emergency stop

Settings → “Stop new bookings” blocks slot search and booking confirmation. It does not delete or alter existing Google events. Resume only after provider/overlap issues are understood.

## Provider incident

- Do not tell requesters a booking succeeded unless the app shows confirmed.
- For retryable Google 429/5xx errors, retain the same browser attempt so the same idempotency key is reused.
- For an ambiguous event older than the configured reconciliation age, use **Reconcile uncertain bookings**. It only looks up deterministic event IDs: a found event is confirmed, a definitive 404 releases the local reservation, and transient provider failures remain unresolved.
- Reconnect Google when status is invalid/revoked; activation and public writes fail closed meanwhile.

## Backup and restore

Stop the app, run `npm run backup -- ./backups/booking-YYYY-MM-DD.sqlite`, and copy the resulting file to encrypted storage. Restore only while stopped: validate the backup with `node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);console.log(d.prepare('pragma integrity_check').get());d.close()" <backup>`, preserve the current database, copy the validated backup to `DATABASE_PATH`, then run `npm run migrate && npm run doctor`.

## Release/rollback

Build and test the commit, back up data, deploy one instance, complete health/readiness and a real low-risk booking, then expand. Roll back the application image only after checking migration compatibility. Migrations are additive in v2.0.0; there is no destructive automatic rollback.

## Support bundle

Run `npm run support:bundle`. Review the JSON before sharing. It contains runtime/config flags, migrations, counts, and non-PII audit action names; it excludes tokens and requester identities.
