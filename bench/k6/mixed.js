import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const tokensRaw = open('/bench/tokens.json');
const tokens = JSON.parse(tokensRaw);

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:8080';
const IS_SMOKE = __ENV.SMOKE === 'true';

const customErrorRate = new Rate('custom_error_rate');

export const options = {
  stages: IS_SMOKE
    ? [
        { duration: '3s', target: 10 },
        { duration: '5s', target: 20 },
        { duration: '2s', target: 0 },
      ]
    : [
        { duration: '30s', target: 120 },
        { duration: '60s', target: 120 },
        { duration: '20s', target: 250 },
        { duration: '10s', target: 0 },
      ],
  thresholds: {
    custom_error_rate: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const businessId = tokens.businessId;
  const customerIndex = (__VU - 1) % tokens.customers.length;
  const customer = tokens.customers[customerIndex];

  const roll = Math.random();

  if (roll < 0.7) {
    // 70% Browse
    const listRes = http.get(`${BASE_URL}/api/businesses?category=healthcare`);
    const listOk = check(listRes, { 'browse list 200': (r) => r.status === 200 });
    customErrorRate.add(!listOk);

    sleep(0.1);

    const detailRes = http.get(`${BASE_URL}/api/businesses/${businessId}`);
    const detailOk = check(detailRes, { 'business detail 200': (r) => r.status === 200 });
    customErrorRate.add(!detailOk);
  } else if (roll < 0.9) {
    // 20% Queue status / Position
    const statusRes = http.get(`${BASE_URL}/api/queue/${businessId}/status`);
    const statusOk = check(statusRes, { 'queue status 200': (r) => r.status === 200 });
    customErrorRate.add(!statusOk);

    if (Math.random() < 0.5) {
      const posRes = http.get(`${BASE_URL}/api/queue/${businessId}/position`, {
        headers: { Authorization: `Bearer ${customer.token}` },
      });
      const posOk = check(posRes, { 'queue position 200 or 404': (r) => r.status === 200 || r.status === 404 });
      customErrorRate.add(!posOk && posRes.status >= 500);
    }
  } else {
    // 10% Booking
    // Pick from slots starting after index 50 to avoid race test slots
    const availableSlots = tokens.slots.slice(50);
    const slot = availableSlots[Math.floor(Math.random() * availableSlots.length)];

    const payload = JSON.stringify({
      slot_id: slot.id,
      service_id: slot.serviceId,
      customer_notes: `k6 mixed VU ${__VU}`,
    });

    const res = http.post(`${BASE_URL}/api/appointments`, payload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customer.token}`,
      },
    });

    const ok = check(res, {
      'mixed booking status is 201 or 409': (r) => r.status === 201 || r.status === 409,
    });
    customErrorRate.add(!ok && res.status >= 500);
  }

  sleep(Math.random() * 0.5 + 0.3);
}
