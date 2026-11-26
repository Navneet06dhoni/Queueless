const { execFileSync } = require('child_process');

try {
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${process.cwd()}:/repo`,
      '-w',
      '/repo',
      'zricethezav/gitleaks:latest',
      'detect',
      '--source',
      '/repo',
      '--verbose',
      '--no-git',
    ],
    { stdio: 'inherit' }
  );
} catch (err) {
  process.exit(err.status || 1);
}
