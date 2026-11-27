import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const customErrorRate = new Rate('custom_error_rate');

const tokensRaw = open('/bench/tokens.json');
const tokens = JSON.parse(tokensRaw);

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:8080';
const IS_SMOKE = __ENV.SMOKE === 'true';

export const options = {
  stages: IS_SMOKE
    ? [
        { duration: '3s', target: 5 },
        { duration: '7s', target: 5 },
      ]
    : [
        { duration: '20s', target: 100 },
        { duration: '60s', target: 100 },
        { duration: '10s', target: 0 },
      ],
  thresholds: {
    custom_error_rate: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const businessId = tokens.businessId;

  // 1. Browse businesses with filters
  const listRes = http.get(`${BASE_URL}/api/businesses?category=healthcare&search=Arogya`);
  const listOk = check(listRes, {
    'browse list status is 200': (r) => r.status === 200,
  });
  customErrorRate.add(!listOk);

  sleep(0.2);

  // 2. Business details
  const detailRes = http.get(`${BASE_URL}/api/businesses/${businessId}`);
  const detailOk = check(detailRes, {
    'business detail status is 200': (r) => r.status === 200,
  });
  customErrorRate.add(!detailOk);

  sleep(0.2);

  // 3. Queue public status
  const queueRes = http.get(`${BASE_URL}/api/queue/${businessId}/status`);
  const queueOk = check(queueRes, {
    'queue status status is 200': (r) => r.status === 200,
  });
  customErrorRate.add(!queueOk);

  sleep(0.5);
}
