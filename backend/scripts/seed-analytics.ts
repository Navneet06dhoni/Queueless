import { pool } from '../src/db';
import { config } from '../src/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';

const SEED_TAG = '[seed_analytics]';

async function main() {
  if (config.NODE_ENV === 'production' || process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run seed:analytics in production environment!');
    process.exit(1);
  }

  console.log('🌱 Starting Analytics 30-Day Historical Seed...\n');

  // 1. Fetch first approved business
  const bizRes = await pool.query(
    `SELECT id, name, owner_id FROM businesses WHERE status = 'approved' ORDER BY created_at ASC LIMIT 1`
  );

  if (bizRes.rows.length === 0) {
    console.error('❌ No approved business found. Please run: npm --prefix backend run seed');
    process.exit(1);
  }

  const business = bizRes.rows[0];
  console.log(`🏥 Seeding history for business: ${business.name} (${business.id})`);

  // 2. Fetch or create a service
  let svcRes = await pool.query(
    `SELECT id FROM services WHERE business_id = $1 LIMIT 1`,
    [business.id]
  );
  let serviceId: string;
  if (svcRes.rows.length > 0) {
    serviceId = svcRes.rows[0].id;
  } else {
    const newSvc = await pool.query(
      `INSERT INTO services (business_id, name, duration_minutes, price)
       VALUES ($1, 'General Consultation', 30, 500)
       RETURNING id`,
      [business.id]
    );
    serviceId = newSvc.rows[0].id;
  }

  // 3. Ensure dedicated demo customers exist
  const passwordHash = await bcrypt.hash('DemoPass123', 10);
  const customerIds: string[] = [];

  for (let i = 1; i <= 15; i++) {
    const email = `analytics_customer_${i}@demo.queueless`;
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'customer')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [`Demo Patient ${i}`, email, passwordHash]
    );
    customerIds.push(userRes.rows[0].id);
  }

  const isQueueService = config.QUEUE_MODE === 'service';
  const queueDbUrl = process.env.QUEUE_DATABASE_URL;
  if (isQueueService && !queueDbUrl) {
    throw new Error('QUEUE_DATABASE_URL is required when QUEUE_MODE=service');
  }
  const queuePool = isQueueService && queueDbUrl ? new pool.constructor({ connectionString: queueDbUrl }) : null;

  // 4. Idempotently clean up previously seeded analytics data
  console.log('🧹 Cleaning up previous analytics seed data...');
  await pool.query(
    `DELETE FROM queue_history
     WHERE business_id = $1
       AND (walk_in_name LIKE '%' || $2 || '%'
            OR customer_id = ANY($3::uuid[]))`,
    [business.id, SEED_TAG, customerIds]
  );

  if (queuePool) {
    await queuePool.query(
      `DELETE FROM queue_history
       WHERE business_id = $1
         AND (walk_in_name LIKE '%' || $2 || '%'
              OR customer_id = ANY($3::uuid[]))`,
      [business.id, SEED_TAG, customerIds]
    );
    await queuePool.query(
      `INSERT INTO queue_settings (business_id, queue_open, updated_at)
       VALUES ($1, true, NOW())
       ON CONFLICT (business_id) DO UPDATE SET queue_open = true, updated_at = NOW()`,
      [business.id]
    );
  }

  await pool.query(
    `DELETE FROM appointments
     WHERE customer_id = ANY($1::uuid[])`,
    [customerIds]
  );

  await pool.query(
    `DELETE FROM slots
     WHERE service_id = $1
       AND start_time < NOW() - INTERVAL '1 hour'`,
    [serviceId]
  );

  // 5. Generate 30 days of realistic history
  console.log('⏳ Generating 30 days of realistic queue and appointment history...');
  const nowKolkata = DateTime.now().setZone(config.BUSINESS_TIMEZONE);

  let totalQueueEntries = 0;
  let totalAppointments = 0;

  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const currentDay = nowKolkata.minus({ days: dayOffset });
    const dayOfWeek = currentDay.weekday % 7; // 0 = Sun ... 6 = Sat

    // Slightly lighter on weekends (10-15 entries), 25-40 entries on weekdays
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const entriesCount = isWeekend
      ? Math.floor(10 + Math.random() * 6)
      : Math.floor(22 + Math.random() * 18);

    for (let ticket = 1; ticket <= entriesCount; ticket++) {
      // Peak hour weighting:
      // 45% between 10:00 - 12:00 IST
      // 35% between 16:00 - 18:00 IST
      // 20% other hours between 09:00 - 19:00
      let hour: number;
      const rand = Math.random();
      if (rand < 0.45) {
        hour = 10 + Math.floor(Math.random() * 2); // 10 or 11
      } else if (rand < 0.8) {
        hour = 16 + Math.floor(Math.random() * 2); // 16 or 17
      } else {
        const offHours = [9, 12, 13, 14, 15, 18];
        hour = offHours[Math.floor(Math.random() * offHours.length)];
      }

      const minute = Math.floor(Math.random() * 60);
      const second = Math.floor(Math.random() * 60);

      const joinedAt = currentDay
        .set({ hour, minute, second, millisecond: 0 })
        .toJSDate();

      // Source distribution: 40% walk-in, 35% online, 25% appointment
      const sourceRand = Math.random();
      let source: 'walk_in' | 'online' | 'appointment' = 'online';
      let customerId: string | null = null;
      let walkInName: string | null = null;
      let appointmentId: string | null = null;

      if (sourceRand < 0.4) {
        source = 'walk_in';
        walkInName = `Walk-in Guest ${ticket} ${SEED_TAG}`;
      } else if (sourceRand < 0.75) {
        source = 'online';
        customerId = customerIds[Math.floor(Math.random() * customerIds.length)];
      } else {
        source = 'appointment';
        customerId = customerIds[Math.floor(Math.random() * customerIds.length)];

        // Create matching slot and appointment
        const slotStart = new Date(joinedAt.getTime() + 5 * 60 * 1000);
        const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

        const slotRes = await pool.query(
          `INSERT INTO slots (service_id, start_time, end_time, status)
           VALUES ($1, $2, $3, 'booked')
           RETURNING id`,
          [serviceId, slotStart, slotEnd]
        );
        const slotId = slotRes.rows[0].id;

        // Appointment status: 85% completed, 10% no_show, 5% cancelled
        const apptStatusRand = Math.random();
        const apptStatus =
          apptStatusRand < 0.85
            ? 'completed'
            : apptStatusRand < 0.95
            ? 'no_show'
            : 'cancelled';

        const apptRes = await pool.query(
          `INSERT INTO appointments (slot_id, customer_id, status, created_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [slotId, customerId, apptStatus, joinedAt]
        );
        appointmentId = apptRes.rows[0].id;
        totalAppointments++;
      }

      // Realistic wait duration (peak hours longer 20-35m, normal 10-20m)
      const isPeakHour = (hour >= 10 && hour < 12) || (hour >= 16 && hour < 18);
      const actualWaitMinutes = isPeakHour
        ? Math.floor(18 + Math.random() * 16)
        : Math.floor(9 + Math.random() * 12);

      // Estimated wait minutes with some realistic noise (±3 to 7 mins)
      const noise = Math.floor((Math.random() - 0.5) * 10);
      const estimatedWaitMinutes = Math.max(5, actualWaitMinutes + noise);

      // Status: 88% completed, 8% skipped, 4% left
      const statusRand = Math.random();
      let status: 'completed' | 'skipped' | 'left' = 'completed';
      let calledAt: Date | null = null;
      let completedAt: Date | null = null;

      if (statusRand < 0.88) {
        status = 'completed';
        calledAt = new Date(joinedAt.getTime() + actualWaitMinutes * 60 * 1000);
        const serviceMinutes = Math.floor(12 + Math.random() * 15);
        completedAt = new Date(calledAt.getTime() + serviceMinutes * 60 * 1000);
      } else if (statusRand < 0.96) {
        status = 'skipped';
        calledAt = new Date(joinedAt.getTime() + actualWaitMinutes * 60 * 1000);
      } else {
        status = 'left';
      }

      const score = joinedAt.getTime();

      await pool.query(
        `INSERT INTO queue_history (
           business_id, customer_id, walk_in_name, ticket_number,
           source, appointment_id, score, joined_at, called_at,
           completed_at, status, estimated_wait_minutes
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          business.id,
          customerId,
          walkInName,
          ticket,
          source,
          appointmentId,
          score,
          joinedAt,
          calledAt,
          completedAt,
          status,
          estimatedWaitMinutes,
        ]
      );

      if (queuePool) {
        await queuePool.query(
          `INSERT INTO queue_history (
             business_id, customer_id, customer_name, walk_in_name, ticket_number,
             source, appointment_id, score, joined_at, called_at,
             completed_at, status, estimated_wait_minutes
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            business.id,
            customerId,
            walkInName,
            walkInName,
            ticket,
            source,
            appointmentId,
            score,
            joinedAt,
            calledAt,
            completedAt,
            status,
            estimatedWaitMinutes,
          ]
        );
      }

      totalQueueEntries++;
    }
  }

  // Also create a few free and booked future slots for slot utilization metrics
  for (let i = 1; i <= 20; i++) {
    const futureSlotStart = new Date(Date.now() + i * 45 * 60 * 1000);
    const futureSlotEnd = new Date(futureSlotStart.getTime() + 30 * 60 * 1000);
    const slotStatus = i % 3 === 0 ? 'booked' : 'free';

    await pool.query(
      `INSERT INTO slots (service_id, start_time, end_time, status)
       VALUES ($1, $2, $3, $4)`,
      [serviceId, futureSlotStart, futureSlotEnd, slotStatus]
    );
  }

  console.log('\n=============================================');
  console.log('✅ Analytics 30-Day Historical Seed Completed!');
  console.log(`📊 Generated Queue Entries: ${totalQueueEntries}`);
  console.log(`📅 Generated Appointments:  ${totalAppointments}`);
  console.log('=============================================\n');

  await pool.end();
  if (queuePool) {
    await queuePool.end();
  }
}

main().catch(async (err) => {
  console.error('❌ Analytics seed failed:', err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
