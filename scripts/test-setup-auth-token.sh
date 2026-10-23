#!/bin/sh
set -eu
umask 077

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/gutfeeling-setup-token.XXXXXX")
trap 'rm -rf "$test_root"' 0 HUP INT TERM

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

mode_of() {
	if stat -c '%a' "$1" >/dev/null 2>&1; then
		stat -c '%a' "$1"
	else
		stat -f '%Lp' "$1"
	fi
}

case_dir="$test_root/add"
mkdir "$case_dir"
cp "$repo_dir/setup-auth-token.sh" "$case_dir/setup-auth-token.sh"
printf '%s\n' 'SURREALDB_USER=root' 'SURREALDB_PASS=keep-this-value' > "$case_dir/.env"
chmod 644 "$case_dir/.env"
output=$(sh "$case_dir/setup-auth-token.sh")
token=$(sed -n 's/^ACCOUNT_SETUP_TOKEN=//p' "$case_dir/.env")
[ "${#token}" -eq 64 ] || fail "generated setup code is not 256-bit hex"
case "$token" in *[!0-9a-f]*) fail "generated setup code is not lowercase hex" ;; esac
case "$output" in *"$token"*) fail "generated setup code was printed" ;; esac
[ "$(mode_of "$case_dir/.env")" = 600 ] || fail "existing .env was not made private"
grep -qx 'SURREALDB_PASS=keep-this-value' "$case_dir/.env" || fail "database credentials changed"
[ "$(grep -c '^ACCOUNT_SETUP_TOKEN=' "$case_dir/.env")" -eq 1 ] || fail "setup code was not added exactly once"

case_dir="$test_root/already-configured"
mkdir "$case_dir"
cp "$repo_dir/setup-auth-token.sh" "$case_dir/setup-auth-token.sh"
printf '%s\n' 'SURREALDB_PASS=keep-this-value' "ACCOUNT_SETUP_TOKEN=$(printf '%064d' 0 | tr 0 a)" > "$case_dir/.env"
cp "$case_dir/.env" "$case_dir/original"
chmod 644 "$case_dir/.env"
output=$(sh "$case_dir/setup-auth-token.sh")
cmp -s "$case_dir/original" "$case_dir/.env" || fail "configured .env contents were changed"
[ "$(mode_of "$case_dir/.env")" = 600 ] || fail "configured .env was not made private"
case "$output" in *"$(sed -n 's/^ACCOUNT_SETUP_TOKEN=//p' "$case_dir/.env")"*) fail "existing setup code was printed" ;; esac

case_dir="$test_root/blank"
mkdir "$case_dir"
cp "$repo_dir/setup-auth-token.sh" "$case_dir/setup-auth-token.sh"
printf '%s\n' 'ACCOUNT_SETUP_TOKEN=' 'KEEP=unchanged' > "$case_dir/.env"
cp "$case_dir/.env" "$case_dir/original"
if sh "$case_dir/setup-auth-token.sh" >/dev/null 2>&1; then
	fail "blank setup-code entry was accepted"
fi
cmp -s "$case_dir/original" "$case_dir/.env" || fail "blank-entry failure changed file contents"
[ "$(mode_of "$case_dir/.env")" = 600 ] || fail "blank-entry .env was not made private"

printf '%s\n' "Account setup-code creation tests passed."
