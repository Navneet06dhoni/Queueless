import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { DockerStatsSampler } from '../bench/stats';
import { checkRaceAppointments } from '../bench/race-check';

const SCENARIOS = [
  'browse.js',
  'booking-race.js',
  'queue-flow.js',
  'mixed.js',
];

async function runScenario(scenario: string, stack: string) {
  console.log(`\n============================================================`);
  console.log(`🔥 [Smoke Test] Running ${scenario} against ${stack}...`);
  console.log(`============================================================`);

  const resultsDir = path.resolve(process.cwd(), 'bench/results', stack);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const csvPath = path.join(resultsDir, `smoke-${scenario.replace('.js', '')}-stats.csv`);
  const sampler = new DockerStatsSampler(csvPath, 2000);
  sampler.start();

  try {
    const k6Cmd = [
      'docker run --rm -i',
      `-v "${path.resolve(process.cwd(), 'bench')}:/bench:ro"`,
      '--add-host=host.docker.internal:host-gateway',
      '-e BASE_URL=http://host.docker.internal:8080',
      '-e SMOKE=true',
      'grafana/k6:0.54.0 run',
      `/bench/k6/${scenario}`,
    ].join(' ');

    console.log(`Executing: ${k6Cmd}`);
    try {
      execSync(k6Cmd, { stdio: 'inherit' });
      console.log(`✅ k6 scenario completed: All thresholds PASSED`);
    } catch (err: any) {
      if (err.status === 99) {
        console.warn(`⚠️ k6 scenario completed: One or more thresholds FAILED (exit code 99)`);
      } else {
        throw err;
      }
    }

    if (scenario === 'booking-race.js') {
      console.log(`\n🔍 Verifying Database state for booking race...`);
      const raceResult = await checkRaceAppointments(2);
      console.log(`   ${raceResult.passed ? '✅' : '❌'} ${raceResult.message}`);
      if (!raceResult.passed) {
        throw new Error(`Race check failed: ${raceResult.message}`);
      }
    }
  } finally {
    const statsSummary = sampler.stop();
    console.log(`\n📊 Container Resource Stats (${scenario}):`);
    console.log(`Total Avg CPU: ${statsSummary.total.avgCpuPerc}%, Peak CPU: ${statsSummary.total.peakCpuPerc}%`);
    console.log(`Total Avg Mem: ${statsSummary.total.avgMemMB} MB, Peak Mem: ${statsSummary.total.peakMemMB} MB`);
  }
}

async function main() {
  const stack = process.argv[2] || 'monolith';
  console.log(`🚀 Starting 10-second smoke iterations for all 4 scenarios on [${stack}]`);

  for (const scenario of SCENARIOS) {
    await runScenario(scenario, stack);
  }

  console.log(`\n============================================================`);
  console.log(`🎉 ALL 4 SMOKE SCENARIOS COMPLETED ON [${stack}]!`);
  console.log(`============================================================`);
}

main().catch((err) => {
  console.error('Smoke suite failed:', err);
  process.exit(1);
});
