#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"

if [ "$#" -ne 1 ] || [ "$1" != "--new" ]; then
	printf '%s\n' "Usage: sh setup-local-env.sh --new" >&2
	printf '%s\n' "Use --new only with a new, empty SurrealDB volume." >&2
	printf '%s\n' "For an existing database, create .env with its current credentials." >&2
	exit 2
fi

if [ -e .env ] || [ -L .env ]; then
	if grep -q '^SURREALDB_PASS=.' .env 2>/dev/null; then
		printf '%s\n' "Keeping existing .env; no secrets were changed."
		exit 0
	fi
	printf '%s\n' "An .env file already exists but has no SURREALDB_PASS." >&2
	printf '%s\n' "Add a unique password or move that file aside, then retry." >&2
	exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
	printf '%s\n' "OpenSSL is required to generate a private database password." >&2
	exit 1
fi

database_password=$(openssl rand -hex 32)
umask 077
{
	printf '%s\n' "# Generated locally; do not commit or share this file."
	printf '%s\n' "SURREALDB_USER=root"
	printf 'SURREALDB_PASS=%s\n' "$database_password"
} > .env

printf '%s\n' "Created .env with a random database password (file permissions are private)."
printf '%s\n' "Start the local stack with: docker-compose up --build"
