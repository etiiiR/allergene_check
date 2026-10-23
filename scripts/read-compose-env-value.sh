#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
	printf '%s\n' "Usage: sh scripts/read-compose-env-value.sh KEY [DEFAULT]" >&2
	exit 2
fi
key=$1
default=${2-}
case "$key" in
	SURREALDB_USER | SURREALDB_PASS | SURREALDB_NAMESPACE | SURREALDB_DATABASE | ACCOUNT_SETUP_TOKEN) ;;
	*)
		printf '%s\n' "Unsupported Compose environment key." >&2
		exit 2
		;;
esac

if [ ! -f .env ] || [ -L .env ]; then
	printf '%s\n' "A regular .env file is required." >&2
	exit 1
fi

count=$(awk -v key="$key" 'index($0, key "=") == 1 { count++ } END { print count + 0 }' .env)
if [ "$count" -eq 0 ] && [ "$#" -eq 2 ]; then
	value=$default
elif [ "$count" -ne 1 ]; then
	printf 'Expected exactly one %s entry in .env.\n' "$key" >&2
	exit 1
else
	value=$(awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2) }' .env)
fi

if [ -z "$value" ]; then
	printf '%s must not be empty.\n' "$key" >&2
	exit 1
fi
carriage_return=$(printf '\r')
case "$value" in
	*"$carriage_return"* | \"* | *\" | \'* | *\')
		printf '%s must be a single-line, unquoted value in .env.\n' "$key" >&2
		exit 1
		;;
esac

printf '%s' "$value"
