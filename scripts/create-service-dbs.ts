import { Client } from 'pg';

async function createServiceDbs() {
  const adminUrl =
    process.env.ADMIN_DATABASE_URL ||
    (process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/\/[^/]+$/, '/postgres') : null) ||
    (process.env.DB_HOST
      ? `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgrespassword'}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/postgres`
      : 'postgresql://postgres:postgrespassword@localhost:5432/postgres');

  const notifPassword = process.env.NOTIFICATION_DB_PASSWORD || 'notification_password';
  const queuePassword = process.env.QUEUE_DB_PASSWORD || 'queue_password';

  console.log('🔄 Connecting to PostgreSQL as admin to initialize service databases...');

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    // 1. Role notification_user
    const userRes = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'notification_user'`);
    if (userRes.rows.length === 0) {
      console.log('👤 Creating role notification_user...');
      await client.query(`CREATE ROLE notification_user WITH LOGIN PASSWORD '${notifPassword}'`);
    } else {
      console.log('✅ Role notification_user already exists, updating password...');
      await client.query(`ALTER ROLE notification_user WITH PASSWORD '${notifPassword}'`);
    }

    // 2. Database notification_db
    const dbRes = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'notification_db'`);
    if (dbRes.rows.length === 0) {
      console.log('📦 Creating database notification_db...');
      await client.query(`CREATE DATABASE notification_db OWNER notification_user`);
    } else {
      console.log('✅ Database notification_db already exists');
    }

    // 3. Database notification_test
    const testDbRes = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'notification_test'`);
    if (testDbRes.rows.length === 0) {
      console.log('📦 Creating test database notification_test...');
      await client.query(`CREATE DATABASE notification_test OWNER notification_user`);
    } else {
      console.log('✅ Database notification_test already exists');
    }

    // 4. Role queue_user
    const queueUserRes = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'queue_user'`);
    if (queueUserRes.rows.length === 0) {
      console.log('👤 Creating role queue_user...');
      await client.query(`CREATE ROLE queue_user WITH LOGIN PASSWORD '${queuePassword}'`);
    } else {
      console.log('✅ Role queue_user already exists, updating password...');
      await client.query(`ALTER ROLE queue_user WITH PASSWORD '${queuePassword}'`);
    }

    // 5. Database queue_db
    const queueDbRes = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'queue_db'`);
    if (queueDbRes.rows.length === 0) {
      console.log('📦 Creating database queue_db...');
      await client.query(`CREATE DATABASE queue_db OWNER queue_user`);
    } else {
      console.log('✅ Database queue_db already exists');
    }

    // 6. Database queue_test
    const queueTestDbRes = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'queue_test'`);
    if (queueTestDbRes.rows.length === 0) {
      console.log('📦 Creating test database queue_test...');
      await client.query(`CREATE DATABASE queue_test OWNER queue_user`);
    } else {
      console.log('✅ Database queue_test already exists');
    }

    // 7. Permissions
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE notification_db TO notification_user`);
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE notification_test TO notification_user`);
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE queue_db TO queue_user`);
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE queue_test TO queue_user`);
    await client.query(`REVOKE ALL ON DATABASE queueless FROM notification_user, queue_user`).catch(() => {});
    await client.query(`REVOKE ALL ON DATABASE queueless_test FROM notification_user, queue_user`).catch(() => {});

    console.log('✨ Service databases and roles initialized successfully!');
  } finally {
    await client.end();
  }
}

createServiceDbs().catch((err) => {
  console.error('❌ Failed to create service databases:', err.message);
  process.exit(1);
});
