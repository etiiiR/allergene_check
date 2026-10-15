#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"

if [ ! -f .env ] || [ -L .env ]; then
	printf '%s\n' "Create or copy .env first. This helper never overwrites it." >&2
	exit 1
fi
if grep -q '^ACCOUNT_SETUP_TOKEN=.' .env; then
	printf '%s\n' "A one-time account setup code is already configured; leaving .env unchanged."
	exit 0
fi
if grep -q '^ACCOUNT_SETUP_TOKEN=' .env; then
	printf '%s\n' "ACCOUNT_SETUP_TOKEN exists but is blank. Set it manually; the file was not changed." >&2
	exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
	printf '%s\n' "OpenSSL is required to generate the one-time setup code." >&2
	exit 1
fi

account_setup_token=$(openssl rand -hex 32)
umask 077
printf 'ACCOUNT_SETUP_TOKEN=%s\n' "$account_setup_token" >> .env
printf '%s\n' "Added a random one-time account setup code to the private .env file."
