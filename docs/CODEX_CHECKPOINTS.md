# Codex Checkpoints

## Current resume checkpoint

- Branch: `main`
- Starting commit: `c7c0d71`
- Product code and required documentation: production-hardening revision implemented in the working tree
- Last verified baseline: check, 31 Node tests plus extension tests, build, runtime audit, Windows setup/launcher, gzip, and HAI round-trip pass
- Release state: commit pending after the 2026-08-09 final verification pass
- External blocks: Google OAuth/Calendar needs owner credentials/consent; ngrok endpoint is active elsewhere; shared Docker daemon times out; current in-app Browser webview will not attach

Resume by reading `docs/CRITICAL_PATH.md`, `docs/GOAL_COMPLETION_MATRIX.md`, and `docs/FINAL_VERIFICATION_REPORT.md`, then run `npm ci && npm run check && npm test && npm run build && npm audit --omit=dev`.
