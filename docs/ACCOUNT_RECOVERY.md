# Recover account sign-in without changing the encrypted diary

This runbook is for the self-hosted operator when the account sign-in password
has been lost. It removes only the account record and device sessions. It does
not change, decrypt, or delete the encrypted diary vault. Afterward, the
operator rotates the account setup code; the user creates the account with that
new code and still unlocks the diary with its vault passphrase or recovery
phrase.

If both vault keys are lost, this procedure cannot recover diary contents. Do
not continue unless you understand that distinction. If you can still unlock
the diary, first download an encrypted backup from Profile → Sicherheit and
keep it somewhere separate from the server.

## Docker Compose deployment

Run these commands from the repository directory on the server. They read only
the required single-line, unquoted values from the private `.env` (without
executing the file as shell code), stop Fiber to avoid concurrent sign-in
changes, and apply the narrowly scoped transaction in
[`account-reset.surql`](account-reset.surql). The query deliberately does not
mention `diary_vault` or any diary table.

```sh
set -eu
SURREALDB_USER=$(sh scripts/read-compose-env-value.sh SURREALDB_USER)
SURREALDB_PASS=$(sh scripts/read-compose-env-value.sh SURREALDB_PASS)
SURREAL_USER=$SURREALDB_USER
SURREAL_PASS=$SURREALDB_PASS
SURREAL_NAMESPACE=$(sh scripts/read-compose-env-value.sh SURREALDB_NAMESPACE main)
SURREAL_DATABASE=$(sh scripts/read-compose-env-value.sh SURREALDB_DATABASE main)
export SURREAL_USER SURREAL_PASS SURREAL_NAMESPACE SURREAL_DATABASE
target="${SURREAL_NAMESPACE}/${SURREAL_DATABASE}"
printf 'This deletes account sign-in and sessions only from %s.\n' "$target"
printf 'Type the exact namespace/database to continue: '
IFS= read -r confirmation
[ "$confirmation" = "$target" ] || { printf '%s\n' 'Target did not match; no changes made.' >&2; exit 1; }

docker-compose stop app
docker-compose exec -T \
  -e SURREAL_USER="$SURREAL_USER" -e SURREAL_PASS="$SURREAL_PASS" \
  -e SURREAL_NAMESPACE="$SURREAL_NAMESPACE" -e SURREAL_DATABASE="$SURREAL_DATABASE" \
  surrealdb /surreal db sql --endpoint http://localhost:8000 \
  --auth-level root --hide-welcome < docs/account-reset.surql
```

If any step fails, stop and inspect the result before retrying. If the SQL
transaction does not complete, keep the app stopped until you have confirmed
the account and sessions were not partially changed. Do not improvise by
deleting the database volume or the `diary_vault` record.

Before restarting Fiber, rotate the bootstrap code with
`sh rotate-auth-token.sh --after-account-reset`. It requires exactly one
non-empty token entry, atomically replaces only that value, keeps `.env`
private, and does not print the replacement secret. Then restart the app with
`docker-compose up -d app`.

After the app is available again, create the account using the new setup code
and a new account password. Then unlock the existing diary with the existing
vault passphrase or recovery phrase. Account sign-in only controls access to
ciphertext; it is not a substitute for either vault key. The bootstrap code
does not expire or self-delete after setup, so keep it private and rotate it
again if another account reset is ever needed.

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
