# Recover account sign-in without changing the encrypted diary

This runbook is for the self-hosted operator when the account sign-in password
has been lost. It removes only the account record and device sessions. It does
not change, decrypt, or delete the encrypted diary vault. Afterward, the user
must create the account again with the existing setup code and still unlock the
diary with its vault passphrase or recovery phrase.

If both vault keys are lost, this procedure cannot recover diary contents. Do
not continue unless you understand that distinction. If you can still unlock
the diary, first download an encrypted backup from Profile → Sicherheit and
keep it somewhere separate from the server.

## Docker Compose deployment

Run these commands from the repository directory on the server. They load the
existing private `.env` values into the shell, stop Fiber to avoid concurrent
sign-in changes, and apply the narrowly scoped transaction in
[`account-reset.surql`](account-reset.surql). The query deliberately does not
mention `diary_vault` or any diary table.

```sh
set -eu
set -a
. ./.env
set +a
: "${SURREALDB_USER:?Missing SURREALDB_USER in .env}"
: "${SURREALDB_PASS:?Missing SURREALDB_PASS in .env}"
export SURREAL_USER="$SURREALDB_USER"
export SURREAL_PASS="$SURREALDB_PASS"
export SURREAL_NAMESPACE="${SURREALDB_NAMESPACE:-main}"
export SURREAL_DATABASE="${SURREALDB_DATABASE:-main}"

docker compose stop app
docker compose exec -T \
  -e SURREAL_USER="$SURREAL_USER" -e SURREAL_PASS="$SURREAL_PASS" \
  -e SURREAL_NAMESPACE="$SURREAL_NAMESPACE" -e SURREAL_DATABASE="$SURREAL_DATABASE" \
  surrealdb /surreal db sql --endpoint http://localhost:8000 \
  --auth-level root --hide-welcome < docs/account-reset.surql
docker compose up -d app
```

If any step fails, stop and inspect the result before retrying. If the SQL
transaction does not complete, keep the app stopped until you have confirmed
the account and sessions were not partially changed. Do not improvise by
deleting the database volume or the `diary_vault` record.

After the app is available again, open it and create a new account with the
setup code in `.env`. Use a new account password. Then unlock the existing diary
with the existing vault passphrase or recovery phrase. Account sign-in only
controls access to ciphertext; it is not a substitute for either vault key.

If the setup code is unavailable, generate a new high-entropy value, update
`ACCOUNT_SETUP_TOKEN` in `.env`, and restart the app before creating the
account. Keep `.env` private (`chmod 600 .env`) and never paste its secrets into
support messages or source control.

This is an operator procedure, not self-service password recovery. Test it
against a disposable database before relying on it for a production deployment.
After recovery, confirm that the encrypted vault revision and ciphertext are
still present and that the diary opens only with the correct vault key.

The integration test executes this exact query file, verifies that all
account sessions and the account record are removed, and checks that a separate
vault ciphertext sentinel and revision are unchanged. Run it only against a
disposable namespace and database whose names end in `_test` or `_tests`:

```sh
SURREALDB_NAMESPACE=gutfeeling_test SURREALDB_DATABASE=gutfeeling_test \
  RUN_INTEGRATION_TESTS=1 go test -run TestAccountAndHashedDeviceSessionsPersistInSurrealDB -count=1
```
