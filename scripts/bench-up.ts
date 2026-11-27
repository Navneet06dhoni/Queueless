import { execSync, spawnSync } from 'child_process';
import path from 'path';

const mode = process.argv[2];
if (mode !== 'monolith' && mode !== 'monolith-x3' && mode !== 'micro') {
  console.error('❌ Usage: tsx scripts/bench-up.ts <monolith|monolith-x3|micro>');
  process.exit(1);
}

// Raise rate limits in benchmark environment
process.env.GATEWAY_AUTH_RATE_LIMIT = process.env.GATEWAY_AUTH_RATE_LIMIT || '10000r/s';
process.env.GATEWAY_API_RATE_LIMIT = process.env.GATEWAY_API_RATE_LIMIT || '50000r/s';
process.env.GATEWAY_AUTH_BURST = process.env.GATEWAY_AUTH_BURST || '500';
process.env.GATEWAY_API_BURST = process.env.GATEWAY_API_BURST || '1000';
process.env.RATE_LIMIT_GLOBAL_MAX = process.env.RATE_LIMIT_GLOBAL_MAX || '5000000';
process.env.RATE_LIMIT_QUEUE_MAX = process.env.RATE_LIMIT_QUEUE_MAX || '1000000';

console.log(`==================================================================`);
console.log(`🚀 Benchmarking Stack Setup: ${mode.toUpperCase()} DEPLOYMENT`);
console.log(`ℹ️ Effective Benchmark Rate Limits:`);
console.log(`   GATEWAY_AUTH_RATE_LIMIT: ${process.env.GATEWAY_AUTH_RATE_LIMIT}`);
console.log(`   GATEWAY_API_RATE_LIMIT:  ${process.env.GATEWAY_API_RATE_LIMIT}`);
console.log(`   GATEWAY_AUTH_BURST:      ${process.env.GATEWAY_AUTH_BURST}`);
console.log(`   GATEWAY_API_BURST:       ${process.env.GATEWAY_API_BURST}`);
console.log(`   RATE_LIMIT_GLOBAL_MAX:   ${process.env.RATE_LIMIT_GLOBAL_MAX}`);
console.log(`   RATE_LIMIT_QUEUE_MAX:    ${process.env.RATE_LIMIT_QUEUE_MAX}`);
console.log(`==================================================================`);

const isMonolith = mode === 'monolith';
const isMonolithX3 = mode === 'monolith-x3';
const composeFiles = isMonolith
  ? ['-f', 'docker-compose.yml', '-f', 'docker-compose.monolith.yml']
  : isMonolithX3
  ? ['-f', 'docker-compose.yml', '-f', 'docker-compose.monolith-x3.yml']
  : ['-f', 'docker-compose.yml'];

// 1. Clean teardown with volumes removed
console.log('\n🧹 [1/5] Performing clean teardown (docker compose down -v --remove-orphans)...');
execSync(`docker compose down -v --remove-orphans`, { stdio: 'inherit' });

// 2. Start stack in background
console.log(`\n📦 [2/5] Starting ${mode} stack containers...`);
execSync(`docker compose ${composeFiles.join(' ')} up -d`, { stdio: 'inherit' });

// 3. Wait for services to be healthy
console.log('\n⏳ [3/5] Waiting for all stack services to report healthy...');
const expectedServices = isMonolith
  ? ['queueless_postgres', 'queueless_redis', 'queueless_core', 'queueless_frontend', 'queueless_gateway']
  : isMonolithX3
  ? ['queueless_postgres', 'queueless_redis', 'queueless_core_1', 'queueless_core_2', 'queueless_core_3', 'queueless_frontend', 'queueless_gateway']
  : ['queueless_postgres', 'queueless_redis', 'queueless_core', 'queueless_queue_service', 'queueless_notification_service', 'queueless_frontend', 'queueless_gateway'];

const startTime = Date.now();
const maxWaitMs = 90000;

while (Date.now() - startTime < maxWaitMs) {
  let allHealthy = true;
  for (const name of expectedServices) {
    try {
      const status = execSync(`docker inspect ${name} --format "{{.State.Health.Status}}" 2>nul`, { encoding: 'utf-8' }).trim();
      if (status !== 'healthy') {
        allHealthy = false;
        break;
      }
    } catch {
      allHealthy = false;
      break;
    }
  }

  if (allHealthy) {
    console.log(`✅ All services reported healthy in ${Math.round((Date.now() - startTime) / 1000)}s!`);
    break;
  }

  // Check if migrate failed
  try {
    const migStatus = execSync('docker inspect queueless_migrate --format "{{.State.ExitCode}}" 2>nul', { encoding: 'utf-8' }).trim();
    if (migStatus !== '' && migStatus !== '0' && migStatus !== '<no value>') {
      console.error(`❌ Migration container failed with exit code ${migStatus}`);
      process.exit(1);
    }
  } catch {
    // container may not exist yet
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}

// 4. Run database seeding & benchmark fixtures
console.log('\n🌱 [4/5] Running database seed container (seed profile)...');
execSync(`docker compose ${composeFiles.join(' ')} --profile seed run --rm seed`, { stdio: 'inherit' });

console.log('\n🎯 [4.5/5] Generating benchmark fixtures (bench/prepare.ts)...');
execSync('npx tsx bench/prepare.ts', { stdio: 'inherit' });

// 5. Verification & Summary of running services and resource limits
console.log('\n📊 [5/5] Stack Status & Resource Limits Summary:');
execSync(`docker compose ${composeFiles.join(' ')} ps`, { stdio: 'inherit' });

console.log('\n🔍 Effective Resource Limits:');
if (isMonolith) {
  console.log('   - Core (Monolith): Limit = 3.0 CPUs, 1536 MB RAM (SUM of core + queue-service + notification-service)');
  console.log('   - Queue Service: DISABLED (profiles: disabled)');
  console.log('   - Notification Service: DISABLED (profiles: disabled)');
  console.log('   - Total App Tier Limits: 3.0 CPUs, 1536 MB RAM');
} else if (isMonolithX3) {
  console.log('   - Core 1: Limit = 1.0 CPU, 512 MB RAM');
  console.log('   - Core 2: Limit = 1.0 CPU, 512 MB RAM');
  console.log('   - Core 3: Limit = 1.0 CPU, 512 MB RAM');
  console.log('   - Queue Service: DISABLED (embedded in each core)');
  console.log('   - Notification Service: DISABLED (embedded in each core)');
  console.log('   - Total App Tier Limits: 3.0 CPUs, 1536 MB RAM (3 replicas behind Nginx round-robin + sticky sockets)');
} else {
  console.log('   - Core: Limit = 1.0 CPU, 512 MB RAM');
  console.log('   - Queue Service: Limit = 1.0 CPU, 512 MB RAM');
  console.log('   - Notification Service: Limit = 1.0 CPU, 512 MB RAM');
  console.log('   - Total App Tier Limits: 3.0 CPUs, 1536 MB RAM (1.0 + 1.0 + 1.0 CPUs, 512 + 512 + 512 MB)');
}

console.log(`\n🎉 ${mode.toUpperCase()} stack is fully ready for benchmarking!\n`);
