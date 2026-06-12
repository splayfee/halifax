#!/usr/bin/env bash
# Run the integration suite against every supported database, one engine at a time.
#
# Expects the containers from docker-compose.test.yml to be up (except sqlite, which is
# embedded). Pass a space-separated subset to run only some engines:
#
#   ./scripts/integration-matrix.sh                 # all engines
#   ./scripts/integration-matrix.sh postgres mongodb # just these two
#
# Each engine gets its own HALIFAX_DB + DATABASE_URL; globalSetup runs `prisma generate`
# and `prisma db push` for the selected schema before the suite executes.
set -euo pipefail

cd "$(dirname "$0")/.."

# MongoDB is intentionally absent: Prisma 7 does not yet support it (coming soon in v7). The
# schema + ObjectId-aware suite are forward-ready; add `mongodb` here once Prisma 7 supports it.
ALL=(postgres mysql mariadb mssql cockroachdb sqlite)
DBS=("${@:-}")
if [[ -z "${DBS[*]}" ]]; then
  DBS=("${ALL[@]}")
fi

export REDIS_URL="redis://localhost:6379"

url_for() {
  case "$1" in
    postgres)    echo "postgresql://postgres:postgres@localhost:5432/halifax_test" ;;
    mysql)       echo "mysql://root:root@127.0.0.1:3306/halifax_test" ;;
    mariadb)     echo "mysql://root:root@127.0.0.1:3307/halifax_test" ;;
    mssql)       echo "sqlserver://localhost:1433;database=halifax_test;user=sa;password=Halifax_test1;encrypt=true;trustServerCertificate=true" ;;
    # CockroachDB insecure mode ships a `defaultdb`; use it so we need no CREATE DATABASE step.
    cockroachdb) echo "postgresql://root@localhost:26257/defaultdb?sslmode=disable" ;;
    mongodb)     echo "mongodb://localhost:27017/halifax_test?replicaSet=rs0&directConnection=true" ;;
    sqlite)      mkdir -p tests/integration/.tmp; echo "file:$PWD/tests/integration/.tmp/sqlite-test.db" ;;
    *) echo "unknown db: $1" >&2; exit 1 ;;
  esac
}

declare -a PASSED=()
declare -a FAILED=()

for db in "${DBS[@]}"; do
  echo ""
  echo "============================================================"
  echo "  Integration suite → ${db}"
  echo "============================================================"
  export HALIFAX_DB="$db"
  export DATABASE_URL="$(url_for "$db")"
  if pnpm exec vitest run --config vitest.integration.config.ts; then
    PASSED+=("$db")
  else
    FAILED+=("$db")
  fi
done

echo ""
echo "============================================================"
echo "  Matrix summary"
echo "============================================================"
echo "  PASSED: ${PASSED[*]:-(none)}"
echo "  FAILED: ${FAILED[*]:-(none)}"
[[ ${#FAILED[@]} -eq 0 ]]
