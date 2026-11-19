import { DateTime } from 'luxon';
import { pool, query, withTransaction } from './index';
import { hashPassword } from '../modules/auth/auth.utils';
import { config } from '../config';
import { runMigrationsUp } from './migrator';

export const seedDatabase = async (): Promise<void> => {
  console.log('🌱 Starting database seeding...');

  // Ensure migrations are run first
  await runMigrationsUp();

  // 1. Seed Admin
  const adminPasswordHash = await hashPassword(config.ADMIN_PASSWORD);
  const adminRes = await query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) 
     DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = 'admin'
     RETURNING id`,
    ['Platform Admin', config.ADMIN_EMAIL.toLowerCase().trim(), adminPasswordHash]
  );
  console.log(`✅ Seeded Admin: ${config.ADMIN_EMAIL}`);

  // 2. Seed 2 Owners
  const owners = [
    { name: 'Dr. Sunita Sharma', email: 'owner1@clinic.in', password: 'OwnerPassword123' },
    { name: 'Rajesh Verma', email: 'owner2@salon.in', password: 'OwnerPassword123' },
  ];

  const ownerIds: Record<string, string> = {};

  for (const owner of owners) {
    const passwordHash = await hashPassword(owner.password);
    const res = await query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner')
       ON CONFLICT (email) 
       DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = 'owner'
       RETURNING id`,
      [owner.name, owner.email.toLowerCase().trim(), passwordHash]
    );
    ownerIds[owner.email] = res.rows[0].id;
    console.log(`✅ Seeded Owner: ${owner.email}`);
  }

  // 3. Seed 5 Customers
  const customers = [
    { name: 'Aarav Patel', email: 'customer1@example.com', password: 'CustomerPassword123' },
    { name: 'Priya Nair', email: 'customer2@example.com', password: 'CustomerPassword123' },
    { name: 'Rohan Mehta', email: 'customer3@example.com', password: 'CustomerPassword123' },
    { name: 'Ananya Desai', email: 'customer4@example.com', password: 'CustomerPassword123' },
    { name: 'Vikram Singh', email: 'customer5@example.com', password: 'CustomerPassword123' },
  ];

  for (const cust of customers) {
    const passwordHash = await hashPassword(cust.password);
    await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'customer')
       ON CONFLICT (email) 
       DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = 'customer'`,
      [cust.name, cust.email.toLowerCase().trim(), passwordHash]
    );
    console.log(`✅ Seeded Customer: ${cust.email}`);
  }

  // 4. Seed 3 Approved Businesses + 1 Pending Business
  const businessesData = [
    {
      owner_id: ownerIds['owner1@clinic.in'],
      name: 'Arogya Health Clinic',
      category: 'Clinic',
      address: '45 Indiranagar 100ft Road',
      city: 'Bengaluru',
      phone: '+919876543210',
      status: 'approved',
      services: [
        { name: 'General Physician Consultation', duration_minutes: 30, price: 500 },
        { name: 'Health Checkup & Blood Work', duration_minutes: 60, price: 1200 },
      ],
    },
    {
      owner_id: ownerIds['owner2@salon.in'],
      name: 'Bliss Unisex Salon',
      category: 'Salon',
      address: '12 Bandra Linking Road',
      city: 'Mumbai',
      phone: '+919876543211',
      status: 'approved',
      services: [
        { name: 'Haircut & Styling', duration_minutes: 45, price: 600 },
        { name: 'Facial & Skin Care', duration_minutes: 60, price: 1500 },
      ],
    },
    {
      owner_id: ownerIds['owner1@clinic.in'],
      name: 'Janata Urban Bank Branch',
      category: 'Banking',
      address: '78 Connaught Place',
      city: 'Delhi',
      phone: '+919876543212',
      status: 'approved',
      services: [
        { name: 'Account & Loan Consultation', duration_minutes: 30, price: 0 },
        { name: 'Locker & Wealth Advisory', duration_minutes: 45, price: 200 },
      ],
    },
    {
      owner_id: ownerIds['owner2@salon.in'],
      name: 'Glow Ayurveda Spa',
      category: 'Spa',
      address: '99 Koramangala 5th Block',
      city: 'Bengaluru',
      phone: '+919876543213',
      status: 'pending', // Pending approval for admin testing
      services: [
        { name: 'Abhyanga Herbal Massage', duration_minutes: 60, price: 1800 },
      ],
    },
  ];

  const tz = config.BUSINESS_TIMEZONE;
  const nowInTz = DateTime.now().setZone(tz);

  for (const b of businessesData) {
    // Check if business exists by name & owner
    let bRes = await query<{ id: string }>(
      'SELECT id FROM businesses WHERE owner_id = $1 AND name = $2',
      [b.owner_id, b.name]
    );

    let businessId: string;
    if (bRes.rows.length === 0) {
      const ins = await query<{ id: string }>(
        `INSERT INTO businesses (owner_id, name, category, address, city, phone, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [b.owner_id, b.name, b.category, b.address, b.city, b.phone, b.status]
      );
      businessId = ins.rows[0].id;
    } else {
      businessId = bRes.rows[0].id;
      await query(
        'UPDATE businesses SET status = $1, category = $2, address = $3, city = $4, phone = $5 WHERE id = $6',
        [b.status, b.category, b.address, b.city, b.phone, businessId]
      );
    }
    console.log(`✅ Seeded Business: "${b.name}" (${b.status})`);

    // Working hours: Monday to Saturday 09:00 - 17:00 (days 1 to 6)
    for (let day = 1; day <= 6; day++) {
      await query(
        `INSERT INTO working_hours (business_id, day_of_week, open_time, close_time)
         VALUES ($1, $2, '09:00', '17:00')
         ON CONFLICT (business_id, day_of_week)
         DO UPDATE SET open_time = '09:00', close_time = '17:00'`,
        [businessId, day]
      );
    }

    // Seed Services & Slots (for approved businesses only)
    for (const s of b.services) {
      let sRes = await query<{ id: string }>(
        'SELECT id FROM services WHERE business_id = $1 AND name = $2',
        [businessId, s.name]
      );

      let serviceId: string;
      if (sRes.rows.length === 0) {
        const sIns = await query<{ id: string }>(
          `INSERT INTO services (business_id, name, duration_minutes, price)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [businessId, s.name, s.duration_minutes, s.price]
        );
        serviceId = sIns.rows[0].id;
      } else {
        serviceId = sRes.rows[0].id;
        await query(
          'UPDATE services SET duration_minutes = $1, price = $2 WHERE id = $3',
          [s.duration_minutes, s.price, serviceId]
        );
      }

      // Generate slots for next 7 days if business is approved
      if (b.status === 'approved') {
        let totalSlotsCreated = 0;
        for (let d = 0; d < 7; d++) {
          const currentDay = nowInTz.plus({ days: d }).startOf('day');
          const dbDayOfWeek = currentDay.weekday === 7 ? 0 : currentDay.weekday;

          // Open Monday to Saturday
          if (dbDayOfWeek >= 1 && dbDayOfWeek <= 6) {
            let slotStart = currentDay.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
            const dayClose = currentDay.set({ hour: 17, minute: 0, second: 0, millisecond: 0 });

            while (slotStart.plus({ minutes: s.duration_minutes }) <= dayClose) {
              const slotEnd = slotStart.plus({ minutes: s.duration_minutes });

              if (slotStart > nowInTz) {
                const res = await query(
                  `INSERT INTO slots (service_id, start_time, end_time, status)
                   VALUES ($1, $2, $3, 'free')
                   ON CONFLICT (service_id, start_time) DO NOTHING
                   RETURNING id`,
                  [serviceId, slotStart.toUTC().toJSDate(), slotEnd.toUTC().toJSDate()]
                );
                if (res.rowCount && res.rowCount > 0) {
                  totalSlotsCreated++;
                }
              }
              slotStart = slotEnd;
            }
          }
        }
        if (totalSlotsCreated > 0) {
          console.log(`   ✨ Generated ${totalSlotsCreated} slots for service "${s.name}"`);
        }
      }
    }
  }

  console.log('🎉 Seeding completed successfully!');
};

if (require.main === module) {
  seedDatabase()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Seeding failed:', err);
      await pool.end();
      process.exit(1);
    });
}
