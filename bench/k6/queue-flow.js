import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const tokensRaw = open('/bench/tokens.json');
const tokens = JSON.parse(tokensRaw);

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:8080';
const IS_SMOKE = __ENV.SMOKE === 'true';

const joinLatency = new Trend('join_latency', true);
const positionLatency = new Trend('position_latency', true);
const nextLatency = new Trend('next_latency', true);
const customErrorRate = new Rate('custom_error_rate');
const consistencyErrors = new Counter('queue_consistency_errors');

const CUSTOMER_VUS = IS_SMOKE ? 10 : 150;
const DURATION = IS_SMOKE ? '10s' : '90s';

export const options = {
  scenarios: {
    customers: {
      executor: 'constant-vus',
      vus: CUSTOMER_VUS,
      duration: DURATION,
      exec: 'customerFlow',
    },
    owner: {
      executor: 'constant-vus',
      vus: 1,
      duration: DURATION,
      exec: 'ownerFlow',
    },
  },
  thresholds: {
    custom_error_rate: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export function customerFlow() {
  const businessId = tokens.businessId;
  const customerIndex = (__VU - 1) % tokens.customers.length;
  const customer = tokens.customers[customerIndex];
  const headers = {
    Authorization: `Bearer ${customer.token}`,
    'Content-Type': 'application/json',
  };

  // Join queue initially if needed
  if (__ITER === 0) {
    const joinRes = http.post(`${BASE_URL}/api/queue/${businessId}/join`, null, { headers });
    joinLatency.add(joinRes.timings.duration);
    const joinOk = check(joinRes, {
      'join status is 201 or 409': (r) => r.status === 201 || r.status === 409,
    });
    if (!joinOk && joinRes.status >= 500) {
      customErrorRate.add(true);
      consistencyErrors.add(1);
    } else {
      customErrorRate.add(false);
    }
    sleep(0.5);
  }

  // Poll position
  const posRes = http.get(`${BASE_URL}/api/queue/${businessId}/position`, { headers });
  positionLatency.add(posRes.timings.duration);
  const posOk = check(posRes, {
    'position status is 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  if (!posOk && posRes.status >= 500) {
    customErrorRate.add(true);
    consistencyErrors.add(1);
  } else {
    customErrorRate.add(false);
  }

  sleep(1);
}

export function ownerFlow() {
  const businessId = tokens.businessId;
  const owner = tokens.owner;
  const headers = {
    Authorization: `Bearer ${owner.token}`,
    'Content-Type': 'application/json',
  };

  const nextRes = http.post(`${BASE_URL}/api/queue/${businessId}/next`, null, { headers });
  nextLatency.add(nextRes.timings.duration);

  // Status 200 (served customer) or 409 (QUEUE_EMPTY) are both valid application responses
  const nextOk = check(nextRes, {
    'next status is 200 or 409': (r) => r.status === 200 || r.status === 409,
    'next status is not 5xx': (r) => r.status < 500,
  });
  if (!nextOk && nextRes.status >= 500) {
    customErrorRate.add(true);
    consistencyErrors.add(1);
  } else {
    customErrorRate.add(false);
  }

  sleep(0.5);
}
