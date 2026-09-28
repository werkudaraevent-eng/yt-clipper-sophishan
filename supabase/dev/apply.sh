#!/bin/sh
# Apply the auth stub and every migration, in order, to $DATABASE_URL.
set -eu
dir="$(cd "$(dirname "$0")/.." && pwd)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$dir/dev/auth_stub.sql"
for f in "$dir"/migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
