import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 20,
  duration: '60s',
};

const BASE_URL = __ENV.BASE_URL || 'http://gateway:8080';
const BUSINESS_ID = __ENV.BUSINESS_ID;

export default function () {
  const listRes = http.get(`${BASE_URL}/api/businesses?category=clinic&limit=10`);
  check(listRes, {
    'businesses list 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
  sleep(1);

  if (BUSINESS_ID) {
    const detailRes = http.get(`${BASE_URL}/api/businesses/${BUSINESS_ID}`);
    check(detailRes, {
      'business detail 200 or 429': (r) => r.status === 200 || r.status === 429,
    });
    sleep(1);

    const queueRes = http.get(`${BASE_URL}/api/queue/${BUSINESS_ID}/status`);
    check(queueRes, {
      'queue status 200 or 429': (r) => r.status === 200 || r.status === 429,
    });
    sleep(1);
  }
}
