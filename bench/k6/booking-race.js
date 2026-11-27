import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const tokensRaw = open('/bench/tokens.json');
const tokens = JSON.parse(tokensRaw);

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:8080';
const IS_SMOKE = __ENV.SMOKE === 'true';

const bookingSuccesses = new Counter('booking_successes');
const bookingConflicts = new Counter('booking_conflicts');
const bookingErrors = new Counter('booking_errors');
const latencySuccess = new Trend('latency_success', true);
const latencyConflict = new Trend('latency_conflict', true);
const customErrorRate = new Rate('custom_error_rate');

const VU_COUNT = IS_SMOKE ? 10 : 200;
const SLOT_COUNT = IS_SMOKE ? 2 : 20;

export const options = {
  scenarios: {
    booking_race: {
      executor: 'per-vu-iterations',
      vus: VU_COUNT,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    custom_error_rate: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const vuId = __VU; // 1-indexed
  const slotIndex = (vuId - 1) % SLOT_COUNT;
  const customerIndex = (vuId - 1) % tokens.customers.length;

  const targetSlot = tokens.slots[slotIndex];
  const customer = tokens.customers[customerIndex];

  const payload = JSON.stringify({
    slot_id: targetSlot.id,
    service_id: targetSlot.serviceId,
    customer_notes: `k6 race VU ${vuId} slot ${slotIndex}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${customer.token}`,
    },
    timeout: '20s',
  };

  const res = http.post(`${BASE_URL}/api/appointments`, payload, params);

  if (res.status === 201) {
    bookingSuccesses.add(1);
    latencySuccess.add(res.timings.duration);
    customErrorRate.add(false);
  } else if (res.status === 409) {
    bookingConflicts.add(1);
    latencyConflict.add(res.timings.duration);
    customErrorRate.add(false);
  } else {
    bookingErrors.add(1);
    customErrorRate.add(true);
    console.error(`Unexpected status ${res.status}: ${res.body}`);
  }

  check(res, {
    'status is 201 or 409': (r) => r.status === 201 || r.status === 409,
    'status is not 5xx': (r) => r.status < 500,
  });
}
