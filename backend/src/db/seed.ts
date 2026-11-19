import { pool, query } from './index';
import { hashPassword } from '../modules/auth/auth.utils';
import { config } from '../config';
import { runMigrationsUp } from './migrator';

export const seedDatabase = async (): Promise<void> => {
  console.log('🌱 Starting database seeding...');

  // Ensure migrations are run first
  await runMigrationsUp();

  // 1. Seed Admin
  const adminPasswordHash = await hashPassword(config.ADMIN_PASSWORD);
  await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) 
     DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = 'admin'`,
    ['Platform Admin', config.ADMIN_EMAIL.toLowerCase().trim(), adminPasswordHash]
  );
  console.log(`✅ Seeded Admin: ${config.ADMIN_EMAIL}`);

  // 2. Seed 2 Owners
  const owners = [
    { name: 'Dr. Sunita Sharma', email: 'owner1@clinic.in', password: 'OwnerPassword123' },
    { name: 'Rajesh Verma', email: 'owner2@salon.in', password: 'OwnerPassword123' },
  ];

  for (const owner of owners) {
    const passwordHash = await hashPassword(owner.password);
    await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner')
       ON CONFLICT (email) 
       DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = 'owner'`,
      [owner.name, owner.email.toLowerCase().trim(), passwordHash]
    );
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
