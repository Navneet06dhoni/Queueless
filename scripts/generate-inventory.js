const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('=== GIT LOG FOR 4 FILES ===');
try {
  const gitLog = execSync('git log -n 5 --stat -- backend/tests/admin.test.ts backend/tests/concurrency.test.ts backend/tests/edgeCases.test.ts backend/tests/rateLimiting.test.ts', { encoding: 'utf8' });
  console.log(gitLog || '(no commits found for these files)');
} catch (e) {
  console.log('Git log error:', e.message);
}

console.log('\n=== CHECK IF 4 FILES EXIST ON DISK IN backend/tests ===');
const checkFiles = ['admin.test.ts', 'concurrency.test.ts', 'edgeCases.test.ts', 'rateLimiting.test.ts'];
for (const f of checkFiles) {
  const p = path.join('backend', 'tests', f);
  if (fs.existsSync(p)) {
    const stat = fs.statSync(p);
    const content = fs.readFileSync(p, 'utf8');
    const tests = (content.match(/^\s*(it|test)\s*\(/gm) || []).length;
    console.log(`${f}: EXISTS, size=${stat.size} bytes, testCount=${tests}`);
  } else {
    console.log(`${f}: DOES NOT EXIST`);
  }
}

function countTestsInDir(dir, ext) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(ext));
  files.sort();
  return files.map(f => {
    const p = path.join(dir, f);
    const content = fs.readFileSync(p, 'utf8');
    const count = (content.match(/^\s*(it|test)\s*\(/gm) || []).length;
    return { file: f, count, size: fs.statSync(p).size };
  });
}

console.log('\n=== BACKEND TESTS INVENTORY (backend/tests) ===');
const backendTests = countTestsInDir(path.join('backend', 'tests'), '.test.ts');
backendTests.forEach(t => {
  console.log(`${t.file.padEnd(35)}: ${t.count} tests (${t.size} bytes)`);
});
console.log(`Total backend test files: ${backendTests.length}`);
console.log(`Total backend it/test calls: ${backendTests.reduce((a, b) => a + b.count, 0)}`);

console.log('\n=== FRONTEND TESTS INVENTORY (frontend/src/test) ===');
const frontendDir = path.join('frontend', 'src', 'test');
const frontendFiles = fs.readdirSync(frontendDir).filter(f => f.includes('.test.'));
frontendFiles.sort();
let totalFeTests = 0;
frontendFiles.forEach(f => {
  const p = path.join(frontendDir, f);
  const content = fs.readFileSync(p, 'utf8');
  const count = (content.match(/^\s*(it|test)\s*\(/gm) || []).length;
  totalFeTests += count;
  console.log(`${f.padEnd(35)}: ${count} tests (${fs.statSync(p).size} bytes)`);
});
console.log(`Total frontend test files: ${frontendFiles.length}`);
console.log(`Total frontend it/test calls: ${totalFeTests}`);
