import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { DockerStatsSampler } from '../bench/stats';
import { checkRaceAppointments } from '../bench/race-check';
import { cleanResetState } from '../bench/clean-state';

// Ensure elevated benchmark rate limits are set
process.env.GATEWAY_AUTH_RATE_LIMIT = process.env.GATEWAY_AUTH_RATE_LIMIT || '10000r/s';
process.env.GATEWAY_API_RATE_LIMIT = process.env.GATEWAY_API_RATE_LIMIT || '50000r/s';
process.env.GATEWAY_AUTH_BURST = process.env.GATEWAY_AUTH_BURST || '500';
process.env.GATEWAY_API_BURST = process.env.GATEWAY_API_BURST || '1000';
process.env.RATE_LIMIT_GLOBAL_MAX = process.env.RATE_LIMIT_GLOBAL_MAX || '5000000';
process.env.RATE_LIMIT_QUEUE_MAX = process.env.RATE_LIMIT_QUEUE_MAX || '1000000';

export interface ScenarioDefinition {
  name: string;
  file: string;
  durationSeconds: number;
}

export const ALL_SCENARIOS: ScenarioDefinition[] = [
  { name: 'browse', file: 'browse.js', durationSeconds: 90 },
  { name: 'booking-race', file: 'booking-race.js', durationSeconds: 10 },
  { name: 'queue-flow', file: 'queue-flow.js', durationSeconds: 90 },
  { name: 'mixed', file: 'mixed.js', durationSeconds: 120 },
];

function printUsage() {
  console.log(`
Usage: tsx scripts/bench-all.ts [options]

Options:
  --stacks <list>      Comma-separated list of stacks to run (e.g. monolith,micro or micro)
                       Available: monolith, monolith-x3, micro (default: all)
  --scenarios <list>   Comma-separated list of scenarios to run (default: browse,booking-race,queue-flow,mixed)
                       Available: browse, booking-race, queue-flow, mixed
  --runs <number>      Number of repetitions per scenario per stack (default: 3)
  --cooldown <seconds> Cool-down pause in seconds between runs (default: 30)
  --help               Display this help message and exit

Resumption Behavior:
  Any run that already has both <scenario>-<run>-summary.json and
  <scenario>-<run>-stats-summary.json in bench/results/<stack>/ will be SKIPPED.
`);
}

function printNotice(cooldown: number) {
  console.log(`\n******************************************************************`);
  console.log(`⚠️  BENCHMARK SUITE NOTICE:`);
  console.log(`    Nothing else may use the machine during the benchmark run.`);
  console.log(`    Cooldown between runs: ${cooldown} seconds.`);
  console.log(`******************************************************************`);
  console.log(`Effective Rate Limits in Environment:`);
  console.log(`   GATEWAY_AUTH_RATE_LIMIT = ${process.env.GATEWAY_AUTH_RATE_LIMIT}`);
  console.log(`   GATEWAY_API_RATE_LIMIT  = ${process.env.GATEWAY_API_RATE_LIMIT}`);
  console.log(`   GATEWAY_AUTH_BURST      = ${process.env.GATEWAY_AUTH_BURST}`);
  console.log(`   GATEWAY_API_BURST       = ${process.env.GATEWAY_API_BURST}`);
  console.log(`   RATE_LIMIT_GLOBAL_MAX   = ${process.env.RATE_LIMIT_GLOBAL_MAX}`);
  console.log(`   RATE_LIMIT_QUEUE_MAX    = ${process.env.RATE_LIMIT_QUEUE_MAX}`);
  console.log(`******************************************************************\n`);
}

async function runK6Async(k6Args: string[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn('docker', k6Args, { stdio: 'inherit' });
    child.on('close', (code) => {
      resolve(code ?? 0);
    });
    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function runScenario(
  stack: string,
  scenario: ScenarioDefinition,
  runNumber: number,
  coolDownSeconds: number
): Promise<boolean> {
  const resultsDir = path.resolve(process.cwd(), 'bench/results', stack);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const summaryFileHost = path.join(resultsDir, `${scenario.name}-${runNumber}-summary.json`);
  const summaryFileContainer = `/bench/results/${stack}/${scenario.name}-${runNumber}-summary.json`;
  const statsCsvHost = path.join(resultsDir, `${scenario.name}-${runNumber}-stats.csv`);
  const statsSummaryHost = path.join(resultsDir, `${scenario.name}-${runNumber}-stats-summary.json`);

  // RESUMPTION CHECK: If both summary and stats-summary already exist, skip!
  if (fs.existsSync(summaryFileHost) && fs.existsSync(statsSummaryHost)) {
    console.log(`⏭️  Skipping [${stack.toUpperCase()}] ${scenario.name} Run #${runNumber}: already completed.`);
    return false; // did not run, no cooldown needed
  }

  console.log(`\n==================================================================`);
  console.log(`▶️  Running [${stack.toUpperCase()}] | Scenario: ${scenario.name} | Run #${runNumber} (${new Date().toISOString()})`);
  console.log(`==================================================================`);

  // 1. Strict clean state reset before EVERY scenario run
  console.log(`🔄 Performing pre-run state reset (clean-state.ts)...`);
  const initialCounts = await cleanResetState();
  console.log(`📊 Initial Starting Row Counts (Proof of Clean Parity):`);
  console.log(`   - Appointments:            ${initialCounts.appointmentsCount}`);
  console.log(`   - Queue History (Core):    ${initialCounts.queueHistoryCoreCount}`);
  console.log(`   - Queue History (Service): ${initialCounts.queueHistoryServiceCount}`);
  console.log(`   - Available Slots:         ${initialCounts.slotsCount}`);
  console.log(`   - Redis Queue Keys:        ${initialCounts.redisQueueKeysCount}`);

  // Enforce >= 10 samples for long-running scenarios (browse, queue-flow, mixed)
  const enforceMinSamples = scenario.name !== 'booking-race';
  const sampler = new DockerStatsSampler(statsCsvHost, 2000, enforceMinSamples);
  sampler.start();

  try {
    const k6Args = [
      'run',
      '--rm',
      '-i',
      '-v',
      `${path.resolve(process.cwd(), 'bench')}:/bench`,
      '--add-host=host.docker.internal:host-gateway',
      '-e',
      'BASE_URL=http://host.docker.internal:8080',
      'grafana/k6:0.54.0',
      'run',
      `--summary-export=${summaryFileContainer}`,
      `/bench/k6/${scenario.file}`,
    ];

    console.log(`Executing: docker ${k6Args.join(' ')}`);
    const exitCode = await runK6Async(k6Args);

    if (exitCode === 0) {
      console.log(`✅ Scenario ${scenario.name} Run #${runNumber}: Thresholds PASSED`);
    } else if (exitCode === 99) {
      console.warn(`⚠️ Scenario ${scenario.name} Run #${runNumber}: One or more thresholds FAILED (exit code 99)`);
    } else {
      throw new Error(`k6 process exited with unexpected code ${exitCode}`);
    }

    if (scenario.name === 'booking-race') {
      console.log(`\n🔍 Verifying Database state for booking race...`);
      const raceResult = await checkRaceAppointments(20);
      console.log(`   ${raceResult.passed ? '✅' : '❌'} ${raceResult.message}`);
      if (!raceResult.passed) {
        throw new Error(`Race check failed: ${raceResult.message}`);
      }
    }
  } finally {
    const statsSummary = sampler.stop();
    fs.writeFileSync(statsSummaryHost, JSON.stringify(statsSummary, null, 2));
    console.log(`📊 Stats Summary saved to: ${statsSummaryHost}`);
    console.log(`   Captured Intervals: ${statsSummary.intervalCount} (${statsSummary.sampleCount} total container records)`);
    console.log(`   Total Avg CPU: ${statsSummary.total.avgCpuPerc}%, Peak CPU: ${statsSummary.total.peakCpuPerc}%`);
    console.log(`   Total Avg Mem: ${statsSummary.total.avgMemMB} MB, Peak Mem: ${statsSummary.total.peakMemMB} MB`);
  }

  if (coolDownSeconds > 0) {
    console.log(`\n⏳ Cooling down for ${coolDownSeconds} seconds to allow connection drains and CPU settling...`);
    await new Promise((resolve) => setTimeout(resolve, coolDownSeconds * 1000));
  }

  return true; // actually executed
}

async function runStack(
  stack: string,
  scenarios: ScenarioDefinition[],
  runs: number,
  coolDownSeconds: number
) {
  console.log(`\n##################################################################`);
  console.log(`🏗️  PREPARING STACK: ${stack.toUpperCase()}`);
  console.log(`##################################################################`);

  // Check if any scenario in this stack needs to run
  let hasPending = false;
  const resultsDir = path.resolve(process.cwd(), 'bench/results', stack);
  for (let r = 1; r <= runs; r++) {
    for (const sc of scenarios) {
      const summaryFile = path.join(resultsDir, `${sc.name}-${r}-summary.json`);
      const statsFile = path.join(resultsDir, `${sc.name}-${r}-stats-summary.json`);
      if (!fs.existsSync(summaryFile) || !fs.existsSync(statsFile)) {
        hasPending = true;
        break;
      }
    }
    if (hasPending) break;
  }

  if (!hasPending) {
    console.log(`✅ All runs for [${stack.toUpperCase()}] are already completed! Skipping stack restart.`);
    return;
  }

  // Reset and bring up stack with prepare
  execSync(`npm run bench:up:${stack}`, { stdio: 'inherit' });

  for (let r = 1; r <= runs; r++) {
    for (const scenario of scenarios) {
      await runScenario(stack, scenario, r, coolDownSeconds);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  let targetStacks = ['monolith', 'micro'];
  let targetScenarios = ALL_SCENARIOS;
  let runs = 3;
  let coolDownSeconds = 30;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--stacks' || args[i] === '--stack') && args[i + 1]) {
      const input = args[i + 1].trim();
      targetStacks = input === 'all'
        ? ['monolith', 'monolith-x3', 'micro']
        : input.split(',').map((s) => s.trim());
      i++;
    } else if (args[i] === '--scenarios' && args[i + 1]) {
      const names = args[i + 1].split(',').map((s) => s.trim());
      targetScenarios = ALL_SCENARIOS.filter((s) => names.includes(s.name));
      i++;
    } else if (args[i] === '--runs' && args[i + 1]) {
      runs = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--cooldown' && args[i + 1]) {
      coolDownSeconds = parseInt(args[i + 1], 10);
      i++;
    }
  }

  printNotice(coolDownSeconds);

  // Estimate remaining time
  let pendingRuns = 0;
  let estimatedSeconds = 0;

  for (const stack of targetStacks) {
    const resultsDir = path.resolve(process.cwd(), 'bench/results', stack);
    for (let r = 1; r <= runs; r++) {
      for (const sc of targetScenarios) {
        const summaryFile = path.join(resultsDir, `${sc.name}-${r}-summary.json`);
        const statsFile = path.join(resultsDir, `${sc.name}-${r}-stats-summary.json`);
        if (!fs.existsSync(summaryFile) || !fs.existsSync(statsFile)) {
          pendingRuns++;
          estimatedSeconds += sc.durationSeconds + coolDownSeconds;
        }
      }
    }
  }

  const estMinutes = (estimatedSeconds / 60).toFixed(1);
  console.log(`⏱️  REMAINING WORKLOAD ESTIMATION:`);
  console.log(`   Pending Runs: ${pendingRuns}`);
  console.log(`   Estimated Execution Time: ~${estimatedSeconds}s (~${estMinutes} minutes)`);
  console.log(`------------------------------------------------------------------\n`);

  for (const stack of targetStacks) {
    await runStack(stack, targetScenarios, runs, coolDownSeconds);
  }

  console.log(`\n==================================================================`);
  console.log(`🎉 BENCHMARK RUNS COMPLETED SUCCESSFULLY!`);
  console.log(`==================================================================`);
}

main().catch((err) => {
  console.error('Benchmark suite execution failed:', err);
  process.exit(1);
});
