const fs = require('fs');

const content = fs.readFileSync('proof/verify.txt', 'utf8');
const lines = content.split(/\r?\n/);

console.log('=== SELECT-STRING SUMMARY OF VERIFY.TXT ===');
lines.forEach(l => {
  if (/Test Suites:|Tests:|Test Files|FAIL/.test(l)) {
    console.log(l);
  }
});

const passLines = lines.filter(l => /^\s*PASS\s+/.test(l));
console.log('\n=== PASS LINES COUNT ===');
console.log(`Total PASS lines in verify.txt: ${passLines.length}`);
passLines.forEach((l, idx) => console.log(`  [${idx + 1}] ${l.trim()}`));
