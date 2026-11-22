import fs from 'fs';
import path from 'path';

describe('Architecture & Module Boundary Tests', () => {
  const modulesDir = path.resolve(__dirname, '../src/modules');
  const moduleNames = fs.readdirSync(modulesDir).filter((file) => {
    return fs.statSync(path.join(modulesDir, file)).isDirectory();
  });

  const getTsFiles = (dir: string): string[] => {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getTsFiles(fullPath));
      } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  };

  test('no module should import another module repository directly', () => {
    const violations: string[] = [];

    for (const mod of moduleNames) {
      const modDir = path.join(modulesDir, mod);
      const files = getTsFiles(modDir);

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, lineNum) => {
          // Check for cross-module repository imports like '../other/other.repository'
          if (line.includes("from '..") || line.includes('from "..')) {
            for (const otherMod of moduleNames) {
              if (otherMod === mod) continue;

              const regex = new RegExp(`from ['"].*\\/${otherMod}\\/.*repository['"]`);
              if (regex.test(line)) {
                violations.push(
                  `${path.relative(modulesDir, file)}:${lineNum + 1} imports ${otherMod} repository: "${line.trim()}"`
                );
              }
            }
          }
        });
      }
    }

    expect(violations).toEqual([]);
  });

  test('no module should execute direct SQL queries on another module tables', () => {
    // Explicit forbidden tables per module to strictly enforce domain boundaries:
    // - Admin: must not query appointments, slots, queue, or notifications directly (must use ports & events)
    // - Analytics: must not query appointments, slots, or queue directly (must use BookingPort & QueuePort)
    // - Queue: must not query appointments, slots, businesses, services, or working hours directly (must use BookingPort & BusinessPort)
    // - Notification: must not query appointments, slots, businesses, services, or queue directly (reacts only to denormalized events)
    // - Business: must not query appointments, queues, or notifications directly (must use BookingPort)
    // - Booking: must not query queues, notifications, or audit logs directly
    const forbiddenTablesPerModule: Record<string, string[]> = {
      admin: [
        'appointments',
        'slots',
        'queue_history',
        'queue_entries',
        'notifications',
        'businesses',
        'services',
        'working_hours',
      ],
      analytics: [
        'appointments',
        'slots',
        'queue_history',
        'queue_entries',
        'notifications',
        'businesses',
        'services',
        'working_hours',
        'users',
      ],
      queue: [
        'appointments',
        'slots',
        'businesses',
        'services',
        'working_hours',
        'notifications',
        'admin_audit_log',
      ],
      notification: [
        'appointments',
        'slots',
        'businesses',
        'services',
        'working_hours',
        'queue_history',
        'queue_entries',
        'admin_audit_log',
      ],
      business: [
        'appointments',
        'queue_history',
        'queue_entries',
        'notifications',
        'admin_audit_log',
      ],
      booking: [
        'queue_history',
        'queue_entries',
        'notifications',
        'admin_audit_log',
      ],
    };

    const sqlViolations: string[] = [];

    for (const [mod, forbidden] of Object.entries(forbiddenTablesPerModule)) {
      const modDir = path.join(modulesDir, mod);
      if (!fs.existsSync(modDir)) continue;

      const files = getTsFiles(modDir);

      for (const file of files) {
        if (file.endsWith('.types.ts') || file.endsWith('.validation.ts')) continue;

        const content = fs.readFileSync(file, 'utf-8');

        for (const foreignTable of forbidden) {
          // Match SQL patterns: FROM <table>, JOIN <table>, INTO <table>, UPDATE <table>
          const sqlPattern = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+${foreignTable}\\b`, 'i');
          if (sqlPattern.test(content)) {
            sqlViolations.push(
              `${path.relative(modulesDir, file)} touches foreign table "${foreignTable}"`
            );
          }
        }
      }
    }

    expect(sqlViolations).toEqual([]);
  });
});
