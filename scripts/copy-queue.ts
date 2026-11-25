import { Pool } from 'pg';

const sourceDbUrl =
  process.env.SOURCE_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgrespassword@localhost:5432/queueless';

const targetDbUrl =
  process.env.QUEUE_DATABASE_URL ||
  'postgresql://queue_user:queue_password@localhost:5432/queue_db';

async function copyQueueData() {
  console.log('🔄 Starting Queue Data Migration from Monolith to Queue Service DB...');
  console.log(`   Source DB: ${sourceDbUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`   Target DB: ${targetDbUrl.replace(/:[^:@]+@/, ':***@')}\n`);

  const sourcePool = new Pool({ connectionString: sourceDbUrl });
  const targetPool = new Pool({ connectionString: targetDbUrl });

  try {
    // 1. Copy businesses.queue_open -> queue_settings
    console.log('📋 Migrating business queue settings...');
    const bizRes = await sourcePool.query(`SELECT id, queue_open FROM businesses`);
    let settingsCount = 0;
    for (const biz of bizRes.rows) {
      await targetPool.query(
        `INSERT INTO queue_settings (business_id, queue_open, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (business_id) DO UPDATE SET queue_open = EXCLUDED.queue_open, updated_at = NOW()`,
        [biz.id, biz.queue_open ?? true]
      );
      settingsCount++;
    }
    console.log(`   ✅ Synced settings for ${settingsCount} businesses.`);

    // 2. Fetch source queue_history with user names & emails joined
    const sourceCountRes = await sourcePool.query(`SELECT COUNT(*) FROM queue_history`);
    const initialTargetCountRes = await targetPool.query(`SELECT COUNT(*) FROM queue_history`);
    const sourceTotal = parseInt(sourceCountRes.rows[0].count, 10);
    const targetBefore = parseInt(initialTargetCountRes.rows[0].count, 10);

    console.log(`\n📊 Source queue_history row count: ${sourceTotal}`);
    console.log(`📊 Target queue_history initial count: ${targetBefore}`);

    const historyRows = await sourcePool.query(`
      SELECT 
        q.id,
        q.business_id,
        q.customer_id,
        u.name AS customer_name,
        u.email AS customer_email,
        q.walk_in_name,
        q.ticket_number,
        q.source,
        q.appointment_id,
        q.score,
        q.joined_at,
        q.called_at,
        q.completed_at,
        q.status,
        q.estimated_wait_minutes
      FROM queue_history q
      LEFT JOIN users u ON q.customer_id = u.id
      ORDER BY q.joined_at ASC
    `);

    let insertedCount = 0;
    for (const row of historyRows.rows) {
      // Fallback customer_name to walk_in_name if walk-in
      const custName = row.customer_name || row.walk_in_name || null;
      const custEmail = row.customer_email || null;

      const insRes = await targetPool.query(
        `INSERT INTO queue_history (
          id, business_id, customer_id, customer_name, customer_email,
          walk_in_name, ticket_number, source, appointment_id, score,
          joined_at, called_at, completed_at, status, estimated_wait_minutes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.business_id,
          row.customer_id,
          custName,
          custEmail,
          row.walk_in_name,
          row.ticket_number,
          row.source,
          row.appointment_id,
          row.score,
          row.joined_at,
          row.called_at,
          row.completed_at,
          row.status,
          row.estimated_wait_minutes,
        ]
      );
      if (insRes.rowCount && insRes.rowCount > 0) {
        insertedCount++;
      }
    }

    const finalTargetCountRes = await targetPool.query(`SELECT COUNT(*) FROM queue_history`);
    const targetAfter = parseInt(finalTargetCountRes.rows[0].count, 10);

    console.log(`\n=============================================`);
    console.log(`✅ Copy Queue Summary:`);
    console.log(`   Source rows:     ${sourceTotal}`);
    console.log(`   Target before:   ${targetBefore}`);
    console.log(`   Newly inserted:  ${insertedCount}`);
    console.log(`   Target after:    ${targetAfter}`);
    console.log(`=============================================\n`);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

copyQueueData().catch((err) => {
  console.error('❌ Copy queue failed:', err);
  process.exit(1);
});
