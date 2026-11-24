import fs from 'fs';
import path from 'path';

describe('Architecture & Module Boundary Tests', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const packagesDir = path.resolve(rootDir, 'packages');
  const modulesDir = path.resolve(__dirname, '../src/modules');
  const moduleNames = fs.readdirSync(modulesDir).filter((file) => {
    return fs.statSync(path.join(modulesDir, file)).isDirectory();
  });

  const getTsFiles = (dir: string): string[] => {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (file === 'node_modules' || file === 'dist') continue;
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

  describe('Shared Packages Architecture Boundaries', () => {
    test('packages/* may never import anything from backend/* or services/*', () => {
      const packageFiles = getTsFiles(packagesDir);
      const violations: string[] = [];

      for (const file of packageFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, lineNum) => {
          if (line.includes('backend/') || line.includes('backend\\') || line.includes('services/')) {
            violations.push(
              `${path.relative(rootDir, file)}:${lineNum + 1} imports forbidden backend/services: "${line.trim()}"`
            );
          }
        });
      }

      expect(violations).toEqual([]);
    });

    test('packages dependencies adhere strictly to architectural constraints', () => {
      const contractsPkg = JSON.parse(
        fs.readFileSync(path.join(packagesDir, 'contracts/package.json'), 'utf-8')
      );
      const commonPkg = JSON.parse(
        fs.readFileSync(path.join(packagesDir, 'common/package.json'), 'utf-8')
      );
      const messagingPkg = JSON.parse(
        fs.readFileSync(path.join(packagesDir, 'messaging/package.json'), 'utf-8')
      );

      // contracts depends only on zod
      const contractsDeps = Object.keys(contractsPkg.dependencies || {});
      expect(contractsDeps).toEqual(['zod']);

      // common depends on zod, express, pino, pino-http, @queueless/contracts
      const commonDeps = Object.keys(commonPkg.dependencies || {}).sort();
      expect(commonDeps).toEqual(
        ['@queueless/contracts', 'express', 'pino', 'pino-http', 'zod'].sort()
      );

      // messaging depends on amqplib, zod, @queueless/contracts, @queueless/common
      const messagingDeps = Object.keys(messagingPkg.dependencies || {}).sort();
      expect(messagingDeps).toEqual(
        ['@queueless/common', '@queueless/contracts', 'amqplib', 'zod'].sort()
      );
    });

    test('packages/* contains no business domain table names other than outbox_events and processed_events', () => {
      const backendDomainTables = [
        'users',
        'refresh_tokens',
        'businesses',
        'services',
        'working_hours',
        'slots',
        'appointments',
        'queues',
        'queue_entries',
        'queue_history',
        'notifications',
        'admin_audit_log',
      ];

      const packageSrcFiles = getTsFiles(path.join(packagesDir));
      const tableViolations: string[] = [];

      for (const file of packageSrcFiles) {
        const content = fs.readFileSync(file, 'utf-8');

        for (const table of backendDomainTables) {
          const sqlPattern = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|TABLE)\\s+${table}\\b`, 'i');
          if (sqlPattern.test(content)) {
            tableViolations.push(
              `${path.relative(rootDir, file)} references domain table "${table}"`
            );
          }
        }
      }

      expect(tableViolations).toEqual([]);
    });
  });

  describe('Notification Service Architecture Boundaries', () => {
    const servicesDir = path.resolve(rootDir, 'services');
    const notifServiceSrc = path.resolve(servicesDir, 'notification-service/src');
    const backendSrc = path.resolve(rootDir, 'backend/src');

    test('notification-service must never import anything from backend/', () => {
      const notifFiles = getTsFiles(notifServiceSrc);
      const violations: string[] = [];
      const backendImportRegex = /(?:from\s+['"][^'"]*backend[/\\]|require\s*\(\s*['"][^'"]*backend[/\\])/;

      for (const file of notifFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, lineNum) => {
          if (backendImportRegex.test(line)) {
            violations.push(
              `${path.relative(rootDir, file)}:${lineNum + 1} imports forbidden backend: "${line.trim()}"`
            );
          }
        });
      }

      expect(violations).toEqual([]);
    });

    test('backend/src must never import anything from services/', () => {
      const backendFiles = getTsFiles(backendSrc);
      const violations: string[] = [];
      const serviceImportRegex = /(?:from\s+['"][^'"]*services[/\\]|require\s*\(\s*['"][^'"]*services[/\\])/;

      for (const file of backendFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, lineNum) => {
          if (serviceImportRegex.test(line)) {
            violations.push(
              `${path.relative(rootDir, file)}:${lineNum + 1} imports forbidden services: "${line.trim()}"`
            );
          }
        });
      }

      expect(violations).toEqual([]);
    });
  });

  describe('Queue Service Architecture Boundaries', () => {
    const servicesDir = path.resolve(rootDir, 'services');
    const queueServiceSrc = path.resolve(servicesDir, 'queue-service/src');

    test('queue-service must never import anything from backend/ or other services', () => {
      const queueFiles = getTsFiles(queueServiceSrc);
      const violations: string[] = [];
      const forbiddenRegex = /(?:from\s+['"][^'"]*(?:backend[/\\]|notification-service[/\\])|require\s*\(\s*['"][^'"]*(?:backend[/\\]|notification-service[/\\]))/;

      for (const file of queueFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, lineNum) => {
          if (forbiddenRegex.test(line)) {
            violations.push(
              `${path.relative(rootDir, file)}:${lineNum + 1} imports forbidden backend/services: "${line.trim()}"`
            );
          }
        });
      }

      expect(violations).toEqual([]);
    });

    test('queue service contains no SQL against users, businesses, appointments or slots', () => {
      const forbiddenTables = ['users', 'businesses', 'appointments', 'slots'];
      const queueFiles = getTsFiles(queueServiceSrc);
      const violations: string[] = [];

      for (const file of queueFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        for (const table of forbiddenTables) {
          const sqlPattern = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|TABLE)\\s+${table}\\b`, 'i');
          if (sqlPattern.test(content)) {
            violations.push(`${path.relative(rootDir, file)} references forbidden core table "${table}"`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });
});
