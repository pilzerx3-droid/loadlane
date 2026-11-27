#!/bin/sh
# Runs once, when the PostgreSQL data volume is created (pnpm infra:reset recreates it).
# Creates the login role the application connects with. It must never own tables and must not
# bypass row-level security: the owner role (POSTGRES_USER) only runs migrations.
# Migration 0002 grants this role its table privileges and the RLS policies apply to it.
# Local development only: production roles are created by whoever operates the database.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE loadlane_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
SQL
