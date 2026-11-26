import { Client } from 'pg';

async function copyNotifications() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
  const destUrl = process.env.DEST_DATABASE_URL || process.env.NOTIFICATION_DATABASE_URL;

  if (!sourceUrl || !destUrl) {
    throw new Error('SOURCE_DATABASE_URL (or DATABASE_URL) and DEST_DATABASE_URL (or NOTIFICATION_DATABASE_URL) are required');
  }

  console.log('📦 Starting one-off idempotent copy of notifications from monolith to notification_db...');
  console.log(`   Source: ${sourceUrl.split('@')[1]}`);
  console.log(`   Destination: ${destUrl.split('@')[1]}`);

  const sourceClient = new Client({ connectionString: sourceUrl });
  const destClient = new Client({ connectionString: destUrl });

  await sourceClient.connect();
  await destClient.connect();

  try {
    // 1. Check source count
    const srcCountRes = await sourceClient.query(`SELECT COUNT(*)::int as count FROM notifications`);
    const sourceCount = srcCountRes.rows[0].count;
    console.log(`📊 Source notifications row count: ${sourceCount}`);

    if (sourceCount === 0) {
      console.log('ℹ️ Source notifications table is empty. Nothing to copy.');
    } else {
      // 2. Fetch rows
      const rowsRes = await sourceClient.query(`
        SELECT id, user_id, type, title, message, data, dedupe_key, status, email_status, email_attempts, last_error, read_at, created_at
        FROM notifications
        ORDER BY created_at ASC
      `);

      let copiedCount = 0;
      for (const row of rowsRes.rows) {
        const insertRes = await destClient.query(`
          INSERT INTO notifications (
            id, user_id, type, title, message, data, dedupe_key, status, email_status, email_attempts, last_error, read_at, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `, [
          row.id,
          row.user_id,
          row.type,
          row.title,
          row.message,
          row.data ? JSON.stringify(row.data) : null,
          row.dedupe_key,
          row.status,
          row.email_status,
          row.email_attempts,
          row.last_error,
          row.read_at,
          row.created_at,
        ]);

        if (insertRes.rows.length > 0) {
          copiedCount++;
        }
      }

      console.log(`📥 Processed ${rowsRes.rows.length} rows. Inserted ${copiedCount} new rows into destination.`);
    }

    // 3. Check destination count
    const destCountRes = await destClient.query(`SELECT COUNT(*)::int as count FROM notifications`);
    const destCount = destCountRes.rows[0].count;
    console.log(`📊 Destination notification_db row count: ${destCount}`);
    console.log('✅ One-off idempotent copy completed successfully (source table untouched).');
  } finally {
    await sourceClient.end();
    await destClient.end();
  }
}

copyNotifications().catch((err) => {
  console.error('❌ Error during notifications copy:', err.message);
  process.exit(1);
});
