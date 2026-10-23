#!/bin/sh
set -eu
umask 077

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/gutfeeling-auth-token.XXXXXX")
trap 'rm -rf "$test_root"' 0 HUP INT TERM

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

new_case() {
	case_dir="$test_root/$1"
	mkdir "$case_dir"
	cp "$repo_dir/rotate-auth-token.sh" "$case_dir/rotate-auth-token.sh"
}

new_case valid
printf '%s\n' '# keep this comment' 'SURREALDB_PASS=unchanged-db-password' \
	'ACCOUNT_SETUP_TOKEN=old-setup-code' 'CUSTOM=value' > "$case_dir/.env"
chmod 644 "$case_dir/.env"
output=$(sh "$case_dir/rotate-auth-token.sh" --after-account-reset)
token=$(sed -n 's/^ACCOUNT_SETUP_TOKEN=//p' "$case_dir/.env")
[ "${#token}" -eq 64 ] || fail "replacement setup code is not 256-bit hex"
case "$token" in *[!0-9a-f]*) fail "replacement setup code is not lowercase hex" ;; esac
case "$output" in *"$token"*) fail "replacement setup code was printed" ;; esac
grep -qx '# keep this comment' "$case_dir/.env" || fail "comment was changed"
grep -qx 'SURREALDB_PASS=unchanged-db-password' "$case_dir/.env" || fail "database password was changed"
grep -qx 'CUSTOM=value' "$case_dir/.env" || fail "unrelated setting was changed"
if stat -c '%a' "$case_dir/.env" >/dev/null 2>&1; then
	mode=$(stat -c '%a' "$case_dir/.env")
else
	mode=$(stat -f '%Lp' "$case_dir/.env")
fi
[ "$mode" = 600 ] || fail ".env permissions are not 600"
[ -z "$(find "$case_dir" -maxdepth 1 -name '.env.rotate.*' -print -quit)" ] || fail "temporary file was left behind"

new_case duplicates
printf '%s\n' 'ACCOUNT_SETUP_TOKEN=first' 'ACCOUNT_SETUP_TOKEN=second' 'KEEP=unchanged' > "$case_dir/.env"
cp "$case_dir/.env" "$case_dir/original"
if sh "$case_dir/rotate-auth-token.sh" --after-account-reset >/dev/null 2>&1; then
	fail "duplicate setup-code entries were accepted"
fi
cmp -s "$case_dir/original" "$case_dir/.env" || fail "duplicate-entry failure changed .env"

new_case blank
printf '%s\n' 'ACCOUNT_SETUP_TOKEN=' 'KEEP=unchanged' > "$case_dir/.env"
cp "$case_dir/.env" "$case_dir/original"
if sh "$case_dir/rotate-auth-token.sh" --after-account-reset >/dev/null 2>&1; then
	fail "blank setup-code entry was accepted"
fi
cmp -s "$case_dir/original" "$case_dir/.env" || fail "blank-entry failure changed .env"

new_case symlink
printf '%s\n' 'ACCOUNT_SETUP_TOKEN=old' > "$case_dir/env-target"
ln -s env-target "$case_dir/.env"
if sh "$case_dir/rotate-auth-token.sh" --after-account-reset >/dev/null 2>&1; then
	fail "symlinked .env was accepted"
fi
grep -qx 'ACCOUNT_SETUP_TOKEN=old' "$case_dir/env-target" || fail "symlink target was changed"

printf '%s\n' "Account setup token rotation tests passed."
