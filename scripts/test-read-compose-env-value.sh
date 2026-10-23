#!/bin/sh
set -eu
umask 077

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/gutfeeling-env-reader.XXXXXX")
trap 'rm -rf "$test_root"' 0 HUP INT TERM
mkdir "$test_root/scripts"
cp "$repo_dir/scripts/read-compose-env-value.sh" "$test_root/scripts/read-compose-env-value.sh"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

printf '%s\n' 'SURREALDB_USER=root' 'SURREALDB_PASS=abc123' 'ACCOUNT_SETUP_TOKEN=bootstrap123456789012345678901234' > "$test_root/.env"
[ "$(cd "$test_root" && sh scripts/read-compose-env-value.sh SURREALDB_USER)" = root ] || fail "user value was not read"
[ "$(cd "$test_root" && sh scripts/read-compose-env-value.sh ACCOUNT_SETUP_TOKEN)" = bootstrap123456789012345678901234 ] || fail "setup token was not read"
[ "$(cd "$test_root" && sh scripts/read-compose-env-value.sh SURREALDB_NAMESPACE main)" = main ] || fail "missing optional value did not use its default"

printf '%s\n' 'SURREALDB_PASS=$(touch should-not-execute)' > "$test_root/.env"
value=$(cd "$test_root" && sh scripts/read-compose-env-value.sh SURREALDB_PASS)
[ "$value" = '$(touch should-not-execute)' ] || fail "value was modified"
[ ! -e "$test_root/should-not-execute" ] || fail ".env value was executed as shell code"

printf '%s\n' 'SURREALDB_PASS=first' 'SURREALDB_PASS=second' > "$test_root/.env"
if (cd "$test_root" && sh scripts/read-compose-env-value.sh SURREALDB_PASS) >/dev/null 2>&1; then
	fail "duplicate values were accepted"
fi

printf '%s\n' 'SURREALDB_PASS="quoted"' > "$test_root/.env"
if (cd "$test_root" && sh scripts/read-compose-env-value.sh SURREALDB_PASS) >/dev/null 2>&1; then
	fail "quoted values were accepted"
fi

printf '%s\n' 'SURREALDB_PASS=abc123' > "$test_root/env-target"
mv "$test_root/.env" "$test_root/quoted-env"
ln -s env-target "$test_root/.env"
if (cd "$test_root" && sh scripts/read-compose-env-value.sh SURREALDB_PASS) >/dev/null 2>&1; then
	fail "symlinked .env was accepted"
fi

printf '%s\n' "Compose environment reader tests passed."
