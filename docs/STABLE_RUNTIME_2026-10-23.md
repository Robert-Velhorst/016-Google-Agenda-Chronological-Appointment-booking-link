# Stable runtime upgrade — 23 October 2026

## Targets and implementation

- Node 26.12.1, npm 12.2.1, Python 3.15.1 for native builds.
- All seven original direct npm declarations pinned to audited current stable versions; better-sqlite3 13.0.3 and node-gyp 13.1.0 added for a reproducible native build.
- Application engine SQLite 3.54.1 from the official amalgamation, with archive and source SHA3-256 checks. Node still embeds 3.54.0 internally; this change replaces the application's active engine, not Node's embedded copy.
- Preserve the driver's 36 compile definitions. Reject an unexpected driver, toolchain or source hash. Verify the rebuilt binary before removing the eight exact obsolete prebuild files inside this checkout's driver.
- Before any application database directory is created, probe the actual engine in memory and reject an older version.
- Preserve existing schema migrations, WAL, foreign keys, short transactions, encrypted records and VACUUM INTO backups. New regression fixtures exercise an original-schema database created by Node SQLite 3.54.0, a 3.54.1 upgrade, rollback, committed audit entry and backup integrity. All fixture data is synthetic.
- Production images pin official Node/Python base digests; runtime copies only the qualified addon and runtime JavaScript, excluding old prebuilds and original bundled SQLite sources.

## Verification boundaries

Local clean installation with npm lifecycle scripts disabled passed; npm audit reports zero vulnerabilities. Syntax checks and the seven package-policy regression cases pass. After RAM recovered above the build guard, the local native compilation and actual runtime probe passed. The full local application suite passed 41 tests and the content-script checks. Both hosted Windows and Linux builds also compiled the current engine, passed all 41 tests, built the frontend and reported zero dependency vulnerabilities.

The draft CI compiles and tests on Windows and Linux, builds the installed production image, and verifies actual engine/source/binary identity without network, as UID/GID 1000 on a read-only filesystem. The complete all-severity Trivy inventory must match the built image, include Alpine 3.24.3 and all three direct production packages at their exact versions, and contain no reported or modified findings. Raw reports are retained. This is a package vulnerability policy, not proof that every embedded native component is current or secure.

No operator database, OAuth account, deployment, provider configuration or billing is changed by these checks. A real database upgrade requires an operator backup and a separate deployment action. Google account and Hetzner acceptance remain unverified.

## Primary sources

- https://nodejs.org/en/download/current
- https://sqlite.org/download.html
- https://registry.npmjs.org/better-sqlite3/latest
- https://registry.npmjs.org/node-gyp/latest
- https://github.com/aquasecurity/trivy/releases/tag/v0.76.1

## First image scan and follow-up

The first installed-image scan at source head 72ca8eb found 13 vulnerabilities under the unused `/usr/local/lib/node_modules/npm` tree; Alpine packages had zero reported findings. The application and HAI connector launch directly with Node. The follow-up removes package-manager launchers and npm/Yarn dependency trees only from the newly built runtime images, retaining npm in build stages. The installed runtime probe now requires those trees to be absent. The first raw scan is retained as failing evidence; a new full hosted image build/probe/scan must qualify the follow-up. No finding is ignored.
