# GutFeeling deployment and recovery

GutFeeling serves one personal diary per installation and supports sign-in from several devices. Use separate installations and database storage for separate diaries. The [security plan](../SECURITY_AND_E2EE_PLAN.md) records the privacy boundaries and release gates.

## Start or update

From this checkout, the existing database credentials are already in the private `.env`. Start the stack from the repository root with:

```sh
docker-compose --parallel 1 up -d --build --wait
docker-compose ps
curl -fsS http://localhost:3000/health
```

This machine has the standalone `docker-compose` client; if your Docker installation provides the Compose plugin, use `docker compose` in its place. `--parallel 1` builds the Go app and ML image one at a time to keep peak memory lower. For a **new, empty** database volume only, first run `sh setup-local-env.sh --new`. Never run that setup for an existing volume. If a build is still OOM-killed, increase Docker's memory allocation. Check `docker-compose logs --tail=100 app surrealdb ml-service` if services fail their health checks. The app log identifies startup stages such as configuration, database authentication, or schema setup.

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

## Release gates

**Local verification update (2026-11-25):** the latest source passed `go test -race ./...` in a Linux container (209.7 seconds), `go test ./...`, and `go vet ./...`. The ML service passed all 110 tests and 52 subtests, including CPU BERT (17.68 seconds). PyPI and OSV audits reported no known vulnerabilities in the production and development Python locks; the npm audits reported zero vulnerabilities, and `govulncheck` reported no reachable Go vulnerabilities. The frontend passed 64 unit tests; the production Vite and Slidev builds passed. `docker-compose --parallel 1 up -d --build --wait` rebuilt the app and ML images; Compose reported the app, SurrealDB 3.3.0, and CPU-only ML service healthy. A health request from inside the app container returned `{"database":"ok","status":"ok"}`. The current Go suite also covers the exact `APP_DOMAIN`/`APP_URL` match and trusted-proxy behavior. All 66 Playwright browser tests passed against three disposable in-memory namespaces, including separate-device encrypted-vault sync, encrypted-backup restore, session revocation, accessibility checks, 200-recipe search, diary editing/concurrent changes, ciphertext-only storage, and 320/390px capture targets. Earlier isolated checks covered a SurrealDB restart, local Caddy TLS with HSTS, the bundled CPU BERT endpoint, and four live SurrealDB integration tests. These local checks do not include public DNS/certificate issuance or a physical second-device run.

These checks make the local self-hosted MVP reviewable; they do not establish clinical validation or certify a live deployment. The optional Caddy route is local-TLS-smoke-tested, but a public certificate and second-device sign-in still require the user's DNS name and network. Before entering real health data remotely, perform a recovery drill on that host, test supported devices and assistive technology, and obtain an independent security review. The iOS HealthKit wrapper also needs a signed device build. The latest hosted GitHub Actions attempt, [run 29](https://github.com/etiiiR/allergene_check/actions/runs/45621149227), is marked failed and has zero jobs in the API response; runs 27 and 28 had the same outcome. There is no hosted test result. Inspect the run page and repository Actions settings, resolve why jobs are not being created, then rerun CI and require its checks before production. See the [iOS guide](../mobile/ios/README.md), the [UX study](../UX_THEME_STUDY.md) and the [security plan](../SECURITY_AND_E2EE_PLAN.md).
