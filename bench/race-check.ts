import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

export async function checkRaceAppointments(expectedCount = 20): Promise<{ count: number; passed: boolean; message: string }> {
  const tokens = JSON.parse(fs.readFileSync('bench/tokens.json', 'utf8'));
  const slotIds = tokens.slots.slice(0, expectedCount).map((s: any) => s.id);

  const connectionString =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.POSTGRES_USER || 'postgres'}:${process.env.POSTGRES_PASSWORD || 'postgres'}@localhost:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'queueless'}`;

  const client = new Client({ connectionString });

  try {
    await client.connect();
    const res = await client.query(
      `SELECT count(*) as count FROM appointments WHERE slot_id = ANY($1) AND status != 'cancelled'`,
      [slotIds]
    );

    const count = parseInt(res.rows[0].count, 10);
    const passed = count === expectedCount;
    const message = `Found ${count} active appointments in DB for the ${expectedCount} raced slots (expected exactly ${expectedCount}).`;
    return { count, passed, message };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('race-check.ts')) {
  const expected = parseInt(process.argv[2] || '20', 10);
  checkRaceAppointments(expected)
    .then((result) => {
      console.log(result.message);
      if (!result.passed) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Error checking DB appointments:', err);
      process.exit(1);
    });
}
