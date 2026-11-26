const fs = require('fs');
const path = require('path');

const targetDirs = [
  'backend/tests',
  'frontend/src/test',
  'services/notification-service/tests',
  'services/queue-service/tests',
  'packages/common/tests',
  'packages/contracts/tests',
  'packages/messaging/tests'
];

console.log('='.repeat(80));
console.log('TEST INVENTORY: it( and test( counts per file');
console.log('='.repeat(80));

let totalTestsAcrossRepo = 0;
let totalSuitesAcrossRepo = 0;

for (const dir of targetDirs) {
  const fullPath = path.resolve(__dirname, '..', dir);
  if (!fs.existsSync(fullPath)) {
    console.log(`Directory not found: ${dir}`);
    continue;
  }

  const files = fs.readdirSync(fullPath).filter(f => 
    (f.endsWith('.test.ts') || f.endsWith('.test.tsx') || f.endsWith('.test.js')) &&
    !f.includes('setup') && !f.includes('teardown')
  ).sort();

  console.log(`\n📁 ${dir} (${files.length} suites)`);
  console.log('-'.repeat(80));
  let dirCount = 0;

  for (const file of files) {
    const filePath = path.join(fullPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    // Match it( or test( or it.skip( or test.skip( etc.
    const matches = content.match(/(?:(?<=\s)|(?<=^))(?:it|test)(?:\.(?:only|skip|todo|concurrent))?\s*\(/gm) || [];
    const count = matches.length;
    dirCount += count;
    console.log(`  ${file.padEnd(45)} : ${count} tests`);
  }
  console.log(`  ${'Total for ' + dir}`.padEnd(47) + `: ${dirCount} tests`);
  totalTestsAcrossRepo += dirCount;
  totalSuitesAcrossRepo += files.length;
}

console.log('\n' + '='.repeat(80));
console.log(`OVERALL TOTAL: ${totalSuitesAcrossRepo} suites, ${totalTestsAcrossRepo} tests`);
console.log('='.repeat(80));
