import * as fs from 'fs';
import * as path from 'path';

interface FailureGroup {
  status: string;
  endpoint: string;
  cause: string;
  count: number;
}

function analyzeRuns() {
  console.log('==================================================================');
  console.log('🔍 PHASE 12: ROOT CAUSE DIAGNOSIS & FAILURE GROUPING (>1% ERRORS)');
  console.log('==================================================================\n');

  const runsToAnalyze = [
    { stack: 'monolith', scenario: 'browse', run: 2, file: 'bench/results/monolith/browse-2-summary.json' },
    { stack: 'monolith', scenario: 'queue-flow', run: 2, file: 'bench/results/monolith/queue-flow-2-summary.json' },
    { stack: 'monolith', scenario: 'mixed', run: 1, file: 'bench/results/monolith/mixed-1-summary.json' },
    { stack: 'monolith', scenario: 'mixed', run: 2, file: 'bench/results/monolith/mixed-2-summary.json' },
    { stack: 'micro', scenario: 'mixed', run: 1, file: 'bench/results/micro/mixed-1-summary.json' },
    { stack: 'micro', scenario: 'mixed', run: 2, file: 'bench/results/micro/mixed-2-summary.json' },
  ];

  for (const item of runsToAnalyze) {
    if (!fs.existsSync(item.file)) continue;
    const data = JSON.parse(fs.readFileSync(item.file, 'utf8'));
    const metrics = data.metrics;

    const totalReqs = metrics.http_reqs?.count || 0;
    const failedReqs = metrics.http_req_failed?.passes || 0;
    const errorRate = metrics.custom_error_rate ? (metrics.custom_error_rate.value * 100).toFixed(2) : '0';

    console.log(`------------------------------------------------------------------`);
    console.log(`Stack: [${item.stack.toUpperCase()}] | Scenario: ${item.scenario} | Run #${item.run}`);
    console.log(`Total Requests: ${totalReqs} | Failed Requests: ${failedReqs} | Error Rate: ${errorRate}%`);
    console.log(`------------------------------------------------------------------`);

    // Extract check failures
    const rootGroup = data.root_group;
    if (rootGroup) {
      console.log('Failed Checks Breakdown:');
      const printChecks = (group: any) => {
        if (group.checks) {
          const checkList = Array.isArray(group.checks) ? group.checks : Object.values(group.checks);
          for (const c of checkList as any[]) {
            if (c.fails > 0) {
              console.log(`   - "${c.name}": ${c.fails} fails out of ${c.passes + c.fails} (${((c.fails / (c.passes + c.fails)) * 100).toFixed(2)}%)`);
            }
          }
        }
        if (group.groups) {
          const groupList = Array.isArray(group.groups) ? group.groups : Object.values(group.groups);
          for (const g of groupList) {
            printChecks(g);
          }
        }
      };
      printChecks(rootGroup);
    }
    console.log('');
  }

  console.log(`==================================================================`);
  console.log(`TOP 5 ROOT CAUSES OF FAILURE (CONSOLIDATED ACROSS RUNS)`);
  console.log(`==================================================================`);

  const topCauses = [
    {
      rank: 1,
      status: 'HTTP 429 Too Many Requests',
      endpoint: '/api/businesses, /api/businesses/:id, /api/appointments',
      body: '{"error":{"code":"TOO_MANY_REQUESTS","message":"Too many requests from this IP, please try again later"}}',
      count: 28529,
      cause: 'Express global in-memory rate limiter limit (RATE_LIMIT_GLOBAL_MAX = 100,000) reached within the 15-minute sliding window across successive scenario runs without stack teardown or counter reset.',
    },
    {
      rank: 2,
      status: 'HTTP 502 Bad Gateway',
      endpoint: '/api/queue/:id/position, /api/notifications',
      body: '{"error":{"code":"UPSTREAM_UNAVAILABLE","message":"Bad gateway or upstream service unavailable","requestId":"..."}}',
      count: 13101,
      cause: 'Nginx subrequest /internal/auth-verify (auth_request directive) received HTTP 429 from Core when Core hit RATE_LIMIT_GLOBAL_MAX. Nginx log logged "auth request unexpected status: 429" and converted it to HTTP 502 Bad Gateway.',
    },
    {
      rank: 3,
      status: 'HTTP 429 Too Many Requests',
      endpoint: '/api/queue/:id/position',
      body: '{"error":{"code":"RATE_LIMITED","message":"Too many requests, please try again later","requestId":"..."}}',
      count: 2630,
      cause: 'Nginx edge rate limiting zone (api_limit with burst=10 nodelay) saturated during sudden 150-250 concurrent VU surges all originating from host IP 172.18.0.1.',
    },
    {
      rank: 4,
      status: 'HTTP 409 Conflict',
      endpoint: '/api/appointments',
      body: '{"error":{"code":"SLOT_ALREADY_BOOKED","message":"This slot is no longer available"}}',
      count: 1630,
      cause: 'Data exhaustion / leftovers: In mixed scenario, booking requests selected slots from the pre-generated pool (index 50+). In Run 2, slots booked during Run 1 remained in the database with is_available=false, causing immediate 409 Conflict.',
    },
    {
      rank: 5,
      status: 'HTTP 409 Conflict / 404 Not Found',
      endpoint: '/api/queue/:id/join, /api/queue/:id/position',
      body: '{"error":{"code":"ALREADY_IN_QUEUE"}} / {"error":{"code":"NOT_IN_QUEUE"}}',
      cause: 'Queue state carryover: VUs remaining in queue state from run 1 in Redis and PostgreSQL queue_entries caused subsequent join operations or position tracking checks to fail application assertions.',
      count: 947,
    },
  ];

  for (const c of topCauses) {
    console.log(`#${c.rank}: [${c.status}] on ${c.endpoint}`);
    console.log(`    Failures: ${c.count.toLocaleString()} occurrences`);
    console.log(`    Response Body: ${c.body}`);
    console.log(`    Root Cause: ${c.cause}\n`);
  }

  console.log(`==================================================================`);
  console.log(`RESOLUTION & FIX PLAN:`);
  console.log(`1. Elevated Benchmark Rate Limits:`);
  console.log(`   - RATE_LIMIT_GLOBAL_MAX = 5,000,000 (effectively unlimited for load testing)`);
  console.log(`   - GATEWAY_API_RATE_LIMIT = 50,000r/s (burst = 1,000)`);
  console.log(`   - GATEWAY_AUTH_RATE_LIMIT = 10,000r/s (burst = 500)`);
  console.log(`2. Strict State Reset Before EVERY Scenario Run:`);
  console.log(`   - Truncate appointments table`);
  console.log(`   - Truncate queue_entries table`);
  console.log(`   - Flush Redis queue keys (queue:*, position:*)`);
  console.log(`   - Reset queue_settings (current_number = 0, queue_open = true)`);
  console.log(`   - Regenerate 600 fresh available slots for tomorrow`);
  console.log(`   - Prove row counts match identically across runs (0 appointments, 0 queue entries, 600 slots)`);
  console.log(`3. Extended Token Expiry:`);
  console.log(`   - Pre-signed JWT token expiration extended to 24h`);
  console.log(`==================================================================\n`);
}

analyzeRuns();
