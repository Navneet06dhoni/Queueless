import { createServiceMetrics } from '@queueless/common';
import { config } from './config';

async function fetchDlqDepth(): Promise<number | null> {
  try {
    const parsed = new URL(config.RABBITMQ_URL);
    const host = parsed.hostname || 'rabbitmq';
    const user = decodeURIComponent(parsed.username || 'guest');
    const pass = decodeURIComponent(parsed.password || 'guest');
    const mgmtUrl = process.env.RABBITMQ_MANAGEMENT_URL || `http://${host}:15672`;
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');

    const res = await fetch(`${mgmtUrl}/api/queues/%2F/queueless.dlq`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(1500),
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { messages?: number };
    return typeof data.messages === 'number' ? data.messages : 0;
  } catch {
    return null;
  }
}

export const notificationMetrics = createServiceMetrics({
  serviceName: 'notification-service',
  onBeforeScrape: async () => {
    const depth = await fetchDlqDepth();
    if (depth !== null) {
      dlqDepth.set({ queue: 'queueless.dlq' }, depth);
    }
  },
});

export const notificationsCreatedTotal = notificationMetrics.registerCounter({
  name: 'queueless_notifications_created_total',
  help: 'Total number of notifications created by type',
  labelNames: ['type'] as const,
});

export const emailsSentTotal = notificationMetrics.registerCounter({
  name: 'queueless_emails_sent_total',
  help: 'Total number of emails sent successfully',
});

export const emailsFailedTotal = notificationMetrics.registerCounter({
  name: 'queueless_emails_failed_total',
  help: 'Total number of emails that failed after all retries',
});

export const emailRetriesTotal = notificationMetrics.registerCounter({
  name: 'queueless_email_retries_total',
  help: 'Total number of email delivery retry attempts',
});

export const notificationProcessingDurationSeconds = notificationMetrics.registerHistogram({
  name: 'queueless_notification_processing_duration_seconds',
  help: 'Notification processing duration in seconds',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const dlqDepth = notificationMetrics.registerGauge({
  name: 'queueless_dlq_depth',
  help: 'Number of messages in the RabbitMQ dead-letter queue',
  labelNames: ['queue'] as const,
});
