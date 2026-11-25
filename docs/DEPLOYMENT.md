# GutFeeling deployment and recovery

GutFeeling serves one personal diary per installation and supports sign-in from several devices. Use separate installations and database storage for separate diaries. The [security plan](../SECURITY_AND_E2EE_PLAN.md) records the privacy boundaries and release gates.

## Start or update

From this checkout, the existing database credentials are already in the private `.env`. For an existing SurrealDB 3.x volume, make an encrypted backup first, then stop Fiber and SurrealDB before the first update that switches the database to its non-root user. The ownership migration must run while SurrealDB is stopped:

```sh
docker-compose stop app surrealdb
```

Start or update the stack from the repository root with:

```sh
docker-compose --parallel 1 up -d --build --wait
docker-compose ps
curl -fsS http://localhost:3000/health
```

This machine has the standalone `docker-compose` client; if your Docker installation provides the Compose plugin, use `docker compose` in its place. `--parallel 1` builds the Go app and ML image one at a time to keep peak memory lower. For a **new, empty** database volume only, first run `sh setup-local-env.sh --new`. Never run that setup for an existing volume. If a build is still OOM-killed, increase Docker's memory allocation. Check `docker-compose logs --tail=100 app surrealdb ml-service` if services fail their health checks. The app log identifies startup stages such as configuration, database authentication, or schema setup.

The one-shot `surrealdb-volume-owner` service changes existing volume files to UID/GID 65532 once, then SurrealDB runs with no Linux capabilities as that non-root user. The migration changes filesystem ownership only, not database contents. Its image has no network connection and only receives the database volume. The pinned SurrealDB 3.x image uses root-owned new named volumes; the official [SurrealDB Docker guide](https://surrealdb.com/docs/running/docker) documents that behavior and the newer image's non-root volume ownership.

On `docker compose stop` or container replacement, Fiber handles `SIGTERM`, stops accepting requests, drains bounded requests and closes live-query subscriptions before the shared database client. Compose allows 35 seconds for this cleanup. Give the same grace period to any other process supervisor; the longest application request deadline is 25 seconds.

Open http://localhost:3000. If no account exists yet, copy `ACCOUNT_SETUP_TOKEN` from the local `.env` into the first account setup form, then choose a pseudonym, account password, and separate vault passphrase. Save the displayed vault recovery phrase securely. Keep `.env` private. If an existing installation needs a bootstrap code, `sh setup-auth-token.sh` adds one without replacing its database credentials.

Before an upgrade, download an encrypted backup in **Profil → Sicherheit** and verify recovery in a separate empty instance. Keep the old image or source revision available. Rebuild with the same Compose project name and `.env` to retain the existing volume. After updating, confirm health, sign in, unlock an existing entry, and save a test correction. For a rollback, first check database format compatibility with the previous version. `docker compose down` stops the stack and preserves the volume.

## HTTPS for another device

The optional Caddy profile terminates HTTPS and proxies to Fiber on a private Docker network. Set a public DNS name that points directly to this host, allow inbound TCP ports 80 and 443 (and UDP 443 for HTTP/3), then set these two values in the private `.env`:

```dotenv
APP_DOMAIN=diary.example.net
APP_URL=https://diary.example.net
```

Start the remote profile:

```sh
docker-compose --parallel 1 --profile remote up -d --build --wait
docker-compose logs --tail=100 caddy
curl -fsS https://diary.example.net/health
```

Caddy obtains and renews the certificate when the hostname is configured and reachable on ports 80/443; see [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https). Its reverse proxy ignores client-supplied `X-Forwarded-*` values by default, then sets them from the connecting client; see [Caddy's forwarded-header behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers). Keep the app's own published port bound to loopback and SurrealDB on its internal network. Fiber trusts forwarded client-IP headers only from Caddy's fixed address on the private proxy network; requests from other peers cannot spoof the login rate-limit address. If the default `172.31.254.0/24` subnet overlaps with an existing LAN or VPN, change `APP_NETWORK_SUBNET`, `APP_NETWORK_PROXY_IP`, and `APP_NETWORK_APP_IP` together in `.env` to a free private range.

Verify the public certificate and HSTS header, then sign in from a second device, unlock the vault, revoke that device from **Profil → Sicherheit**, and confirm it loses access after its next session check. The Caddy config was validated and its local TLS proxy smoke test returned the app health response with HSTS. Public certificate issuance and second-device sign-in still require a public hostname and reachable ports. Do not put a CDN or another proxy in front without configuring its trusted-proxy ranges and checking its forwarded-header behavior.

When devices save at the same time, independent diary records and fields merge automatically after local decryption. If both devices changed the same field, the app keeps the current server copy and asks you to unlock and enter the unsaved change again. A network connection is required to synchronize; the app does not keep a plaintext offline diary copy.

## Recover access

- **Account password lost.** Use the one-time sign-in recovery code if configured. For operator recovery, use the [account recovery runbook](ACCOUNT_RECOVERY.md). The vault stays protected by its own credentials.
- **Vault passphrase lost.** Unlock with the vault recovery phrase and replace the vault credentials in **Profil → Sicherheit**.
- **Host or database lost.** Start a clean installation, create a new account, and use **Verschlüsselte Sicherung wiederherstellen** before creating a vault. The backup needs a vault credential from the time it was exported.
- **Both vault credentials lost.** Recovery requires access to a previously exported backup and its matching credential, or an already unlocked device that can still export or replace credentials.

When sharing a doctor report, review what is included. PDFs and copied reports contain readable health data outside the vault.

## Delete an account and diary

In **Profil → Sicherheit**, enter the current account password and type `LÖSCHEN`. The app removes the account, all device sessions, the encrypted vault, and any remaining legacy diary rows from primary SurrealDB storage in one transaction. A pending vault save checks that the account still exists, so it cannot recreate the diary after deletion. The browser locks the local vault and returns to sign-in when deletion succeeds.

This does not erase encrypted backups downloaded to devices, readable doctor reports, database snapshots, host-level backups, or copies held in reverse-proxy and hosting logs. The operator must apply the documented retention and deletion process to those copies. Confirm that any backup is no longer needed before deleting it; the app cannot recover data after its primary vault and every backup are gone.

## Release gates

**Verification update (2026-11-25):** local `go test -race ./...`, `go test ./...`, and `go vet ./...` passed. The ML service passed 110 tests and 52 subtests, including CPU BERT. PyPI and OSV audits reported no known vulnerabilities in the production and development Python locks; npm audits reported zero vulnerabilities, and `govulncheck` reported no reachable Go vulnerabilities. The frontend passed 70 unit tests; production Vite and Slidev builds passed. Compose rebuilt the app and ML images and reported the app, SurrealDB 3.3.0, and CPU-only ML service healthy; `http://localhost:3000/health` returned `{"database":"ok","status":"ok"}`. Hosted CI passed all 67 Playwright browser tests against disposable namespaces, including separate-device encrypted-vault sync, backup restore, session revocation, accessibility, 200-recipe search, diary editing/concurrent changes, ciphertext-only storage, 320/390px capture targets, and logout/browser-Back locking. The HealthKit app also generated and built as an unsigned iOS Simulator app. These checks do not include public DNS/certificate issuance, distribution signing, a physical iPhone HealthKit run, or a physical second-device sync.

Hosted GitHub Actions [CI run 53](https://github.com/etiiiR/allergene_check/actions/runs/45647249144) and [workflow-lint run 20](https://github.com/etiiiR/allergene_check/actions/runs/45647249060) passed on commit `cef9fe9`. The six jobs passed Go race/static/vulnerability checks; frontend tests, audits and production build; Python audits and tests including CPU BERT; the complete Compose smoke test including non-root SurrealDB and legacy-volume migration; four live SurrealDB integration tests; all 67 Playwright tests; and an unsigned iOS Simulator build generated with XcodeGen. The frontend suite includes lock-race checks for unlock, setup, restore and credential rotation, plus logout/browser-Back locking.

These checks make the self-hosted MVP reviewable; they do not certify a live deployment or establish clinical validity. The GitHub API still reports `main` as unprotected, so no successful status checks are required before changes reach it. Before entering real health data remotely, configure a public DNS name and HTTPS certificate, test sign-in and sync on a physical second device, perform a recovery drill on the target host, test supported devices and assistive technology, sign the iOS app and test the HealthKit permission/sync flow on an iPhone, and obtain an independent security review. Real-user usability research also remains open. See the [iOS guide](../mobile/ios/README.md), the [UX study](../UX_THEME_STUDY.md) and the [security plan](../SECURITY_AND_E2EE_PLAN.md).
