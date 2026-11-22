-- Idempotent initialization of microservices databases and roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'notification_user') THEN
    CREATE ROLE notification_user WITH LOGIN PASSWORD 'notification_password';
  END IF;
END
$$;

SELECT 'CREATE DATABASE notification_db OWNER notification_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'notification_db')\gexec

SELECT 'CREATE DATABASE notification_test OWNER notification_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'notification_test')\gexec

GRANT ALL PRIVILEGES ON DATABASE notification_db TO notification_user;
GRANT ALL PRIVILEGES ON DATABASE notification_test TO notification_user;

REVOKE ALL PRIVILEGES ON DATABASE queueless FROM notification_user;
REVOKE ALL PRIVILEGES ON DATABASE queueless_test FROM notification_user;
