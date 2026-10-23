#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"

if [ "$#" -ne 1 ] || [ "$1" != "--after-account-reset" ]; then
	printf '%s\n' "Usage: sh rotate-auth-token.sh --after-account-reset" >&2
	printf '%s\n' "Use only after removing the old account record from the database." >&2
	exit 2
fi

if [ ! -f .env ] || [ -L .env ]; then
	printf '%s\n' "A regular, private .env file is required; symlinks are not accepted." >&2
	exit 1
fi

token_lines=$(grep -c '^ACCOUNT_SETUP_TOKEN=' .env || true)
if [ "$token_lines" -ne 1 ] || ! grep -q '^ACCOUNT_SETUP_TOKEN=.' .env; then
	printf '%s\n' "Expected exactly one non-empty ACCOUNT_SETUP_TOKEN entry; .env was not changed." >&2
	exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
	printf '%s\n' "OpenSSL is required to rotate the account setup code." >&2
	exit 1
fi

new_token=$(openssl rand -hex 32)
temporary_file=$(mktemp .env.rotate.XXXXXX)
trap 'rm -f "$temporary_file"' 0 HUP INT TERM
if ! printf '%s\n' "$new_token" | awk '
	NR == FNR { replacement = $0; next }
	/^ACCOUNT_SETUP_TOKEN=/ {
		count++
		if (count == 1) print "ACCOUNT_SETUP_TOKEN=" replacement
		next
	}
	{ print }
	END { if (count != 1) exit 42 }
' - .env > "$temporary_file"; then
	printf '%s\n' "Could not safely update the setup code; .env was not changed." >&2
	exit 1
fi

if [ "$(grep -c '^ACCOUNT_SETUP_TOKEN=.' "$temporary_file" || true)" -ne 1 ]; then
	printf '%s\n' "The replacement setup code failed validation; .env was not changed." >&2
	exit 1
fi
chmod 600 "$temporary_file"
mv -f "$temporary_file" .env
trap - 0 HUP INT TERM
printf '%s\n' "Rotated ACCOUNT_SETUP_TOKEN in .env. The new secret was not printed."
printf '%s\n' "Read it only from the private file when registering the replacement account."
