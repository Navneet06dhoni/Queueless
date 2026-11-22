import { Client } from 'pg';

async function createServiceDbs() {
  const adminUrl = process.env.ADMIN_DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5432/postgres';
  console.log('🔄 Connecting to PostgreSQL as admin to initialize service databases...');

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    // 1. Role
    const userRes = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'notification_user'`);
    if (userRes.rows.length === 0) {
      console.log('👤 Creating role notification_user...');
      await client.query(`CREATE ROLE notification_user WITH LOGIN PASSWORD 'notification_password'`);
    } else {
      console.log('✅ Role notification_user already exists');
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

    // 4. Permissions
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE notification_db TO notification_user`);
    await client.query(`GRANT ALL PRIVILEGES ON DATABASE notification_test TO notification_user`);
    await client.query(`REVOKE ALL ON DATABASE queueless FROM notification_user`).catch(() => {});
    await client.query(`REVOKE ALL ON DATABASE queueless_test FROM notification_user`).catch(() => {});

    console.log('✨ Service databases and roles initialized successfully!');
  } finally {
    await client.end();
  }
}

createServiceDbs().catch((err) => {
  console.error('❌ Failed to create service databases:', err.message);
  process.exit(1);
});
