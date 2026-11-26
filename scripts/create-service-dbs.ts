import dotenv from 'dotenv';
import path from 'path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function createServiceDbs() {
  const requiredSecrets = [
    { name: 'POSTGRES_PASSWORD', value: process.env.POSTGRES_PASSWORD },
    { name: 'NOTIFICATION_DB_PASSWORD', value: process.env.NOTIFICATION_DB_PASSWORD },
    { name: 'QUEUE_DB_PASSWORD', value: process.env.QUEUE_DB_PASSWORD },
    { name: 'INTERNAL_TOKEN', value: process.env.INTERNAL_TOKEN },
    { name: 'JWT_ACCESS_SECRET', value: process.env.JWT_ACCESS_SECRET },
    { name: 'JWT_REFRESH_SECRET', value: process.env.JWT_REFRESH_SECRET },
  ];

  for (const sec of requiredSecrets) {
    if (!sec.value || sec.value.trim() === '' || sec.value === 'CHANGE_ME') {
      console.error(`\n❌ [FATAL] Required secret ${sec.name} is missing, empty, or set to placeholder 'CHANGE_ME'.`);
      console.error(`👉 Please run 'npm run gen:env' or configure your .env file with secure cryptographically random secrets before starting containers.\n`);
      process.exit(1);
    }
  }

  const pgUser = process.env.POSTGRES_USER || process.env.DB_USER || 'postgres';
  const pgPassword = process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || '';
  const pgHost = process.env.DB_HOST || 'localhost';
  const pgPort = process.env.DB_PORT || 5432;

  const adminUrl =
    process.env.ADMIN_DATABASE_URL ||
    (process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/\/[^/]+$/, '/postgres') : null) ||
    `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/postgres`;

  const notifPassword = process.env.NOTIFICATION_DB_PASSWORD || '';
  const queuePassword = process.env.QUEUE_DB_PASSWORD || '';

  console.log('🔄 Connecting to PostgreSQL as admin to initialize service databases...');

  let client!: Client;
  let connected = false;
  let attempts = 0;
  const maxAttempts = 15;

  while (!connected && attempts < maxAttempts) {
    try {
      attempts++;
      client = new Client({ connectionString: adminUrl });
      await client.connect();
      connected = true;
    } catch (err: any) {
      if (attempts >= maxAttempts) {
        throw err;
      }
      console.log(`⏳ Waiting for PostgreSQL to accept connections (attempt ${attempts}/${maxAttempts})...`);
      await new Promise((res) => setTimeout(res, 2000));
    }
  }

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
