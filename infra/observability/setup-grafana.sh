#!/bin/sh
# Grafana's setup job. First it refuses to continue unless the two passwords are
# set, so Grafana never starts with a default password. Then it creates (or
# updates) the Postgres role Grafana reads with. Safe to run again,
# on a fresh database and on one that already has the role: every run sets the
# password from the environment and grants SELECT on the tables and views that
# exist then, so a table added by a later migration is covered by the next run.
#
# The password is read from the environment by psql itself (\getenv), so it is
# on no command line, and statement logging is turned off for this session so
# it cannot reach the server's log even if a statement fails.
set -eu

fail=0
for name in GRAFANA_ADMIN_PASSWORD GRAFANA_DB_PASSWORD; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "ERROR: $name is not set. Set it in .env to use the observability profile (see .env.example)." >&2
    fail=1
  fi
done
[ "$fail" = 0 ] || exit 1

: "${GRAFANA_DB_USER:=grafana_reader}"

psql --host postgres --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --no-psqlrc --quiet --set ON_ERROR_STOP=1 <<'SQL'
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
\getenv pw GRAFANA_DB_PASSWORD
\getenv reader GRAFANA_DB_USER
\getenv db POSTGRES_DB

SELECT format('CREATE ROLE %I LOGIN', :'reader')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'reader') \gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'reader', :'pw') \gexec
-- Defence in depth: this role's sessions are read-only and cannot run long.
SELECT format('ALTER ROLE %I SET default_transaction_read_only = on', :'reader') \gexec
SELECT format('ALTER ROLE %I SET statement_timeout = ''15s''', :'reader') \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'reader') \gexec
SELECT format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', :'reader') \gexec
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'reader') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'reader') \gexec
-- Tables and views alike: Visits, events, the views, content, contact messages.
SELECT format('GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I', :'reader') \gexec
SQL
echo "grafana reader role is ready"
