#!/bin/sh
set -e

# Idempotently initialize service roles and databases if passwords are provided via environment variables
if [ -n "$NOTIFICATION_DB_PASSWORD" ] && [ -n "$QUEUE_DB_PASSWORD" ]; then
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${NOTIFICATION_DB_USER:-notification_user}') THEN
      CREATE ROLE ${NOTIFICATION_DB_USER:-notification_user} WITH LOGIN PASSWORD '${NOTIFICATION_DB_PASSWORD}';
    ELSE
      ALTER ROLE ${NOTIFICATION_DB_USER:-notification_user} WITH PASSWORD '${NOTIFICATION_DB_PASSWORD}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${QUEUE_DB_USER:-queue_user}') THEN
      CREATE ROLE ${QUEUE_DB_USER:-queue_user} WITH LOGIN PASSWORD '${QUEUE_DB_PASSWORD}';
    ELSE
      ALTER ROLE ${QUEUE_DB_USER:-queue_user} WITH PASSWORD '${QUEUE_DB_PASSWORD}';
    END IF;
  END
  \$\$;

  SELECT 'CREATE DATABASE notification_db OWNER ${NOTIFICATION_DB_USER:-notification_user}'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'notification_db')\gexec

  SELECT 'CREATE DATABASE notification_test OWNER ${NOTIFICATION_DB_USER:-notification_user}'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'notification_test')\gexec

  SELECT 'CREATE DATABASE queue_db OWNER ${QUEUE_DB_USER:-queue_user}'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'queue_db')\gexec

  SELECT 'CREATE DATABASE queue_test OWNER ${QUEUE_DB_USER:-queue_user}'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'queue_test')\gexec

  GRANT ALL PRIVILEGES ON DATABASE notification_db TO ${NOTIFICATION_DB_USER:-notification_user};
  GRANT ALL PRIVILEGES ON DATABASE notification_test TO ${NOTIFICATION_DB_USER:-notification_user};
  GRANT ALL PRIVILEGES ON DATABASE queue_db TO ${QUEUE_DB_USER:-queue_user};
  GRANT ALL PRIVILEGES ON DATABASE queue_test TO ${QUEUE_DB_USER:-queue_user};

  SELECT 'CREATE DATABASE queueless_test'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'queueless_test')\gexec

  REVOKE ALL PRIVILEGES ON DATABASE queueless FROM ${NOTIFICATION_DB_USER:-notification_user}, ${QUEUE_DB_USER:-queue_user};
  REVOKE ALL PRIVILEGES ON DATABASE queueless_test FROM ${NOTIFICATION_DB_USER:-notification_user}, ${QUEUE_DB_USER:-queue_user};
EOSQL
fi
