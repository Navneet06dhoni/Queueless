const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const workflowFiles = [
  path.resolve(__dirname, '../.github/workflows/ci.yml'),
  path.resolve(__dirname, '../.github/workflows/release.yml'),
];

console.log('='.repeat(90));
console.log('VERIFYING GITHUB ACTIONS PINNED SHAS VIA git ls-remote');
console.log('='.repeat(90));

const seen = new Set();
const actions = [];

for (const file of workflowFiles) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/uses:\s+([^@\s]+)@([a-f0-9]+)\s*#\s*([v0-9.]+)/i);
    if (match) {
      const repo = match[1];
      const pinned = match[2];
      const tag = match[3];
      const key = `${repo}@${tag}`;
      if (!seen.has(key)) {
        seen.add(key);
        actions.push({ repo, tag, pinned, file: path.basename(file) });
      }
    }
  }
}

let allMatch = true;

for (const a of actions) {
  const url = `https://github.com/${a.repo}.git`;
  try {
    const raw = execSync(`git ls-remote ${url} refs/tags/${a.tag} refs/tags/${a.tag}^{}`, { encoding: 'utf8' }).trim();
    console.log(`\nAction: ${a.repo} (${a.tag}) [from ${a.file}]`);
    console.log(`Pinned SHA in workflow : ${a.pinned}`);
    console.log(`Remote output:\n${raw}`);

    const lines = raw.split('\n');
    let remoteCommitSha = '';
    const peeled = lines.find(l => l.includes('^{}'));
    if (peeled) {
      remoteCommitSha = peeled.split(/\s+/)[0];
    } else if (lines.length > 0 && lines[0].trim()) {
      remoteCommitSha = lines[0].split(/\s+/)[0];
    }

    if (remoteCommitSha === a.pinned) {
      console.log(`✅ MATCH: ${a.pinned} is the exact commit SHA for tag ${a.tag}`);
    } else {
      allMatch = false;
      console.log(`⚠️ MISMATCH: remote tag points to commit ${remoteCommitSha}, workflow has ${a.pinned}`);
    }
  } catch (err) {
    allMatch = false;
    console.error(`❌ Failed to ls-remote for ${a.repo}:`, err.message);
  }
}

console.log('\n' + '='.repeat(90));
if (allMatch) {
  console.log('🎉 ALL GITHUB ACTIONS PINNED SHAS MATCH REMOTE COMMITS EXACTLY!');
} else {
  console.log('⚠️ SOME ACTION SHAS DO NOT MATCH REMOTE REPOSITORIES!');
  process.exit(1);
}
console.log('='.repeat(90));
