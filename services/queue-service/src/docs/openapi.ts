export function getQueueOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'QueueLess Queue Service API',
      version: '1.0.0',
      description: 'Microservice managing virtual queues, ticket progression, real-time sockets, and queue facts.',
    },
    paths: {
      '/api/queue/me': {
        get: {
          summary: 'Get active queue entry for logged-in customer',
          tags: ['Queue'],
          responses: {
            '200': { description: 'Active queue position' },
            '401': { description: 'Unauthorized' },
            '404': { description: 'Not in queue' },
          },
        },
      },
      '/api/queue/{businessId}/status': {
        get: {
          summary: 'Get public queue status (no auth)',
          tags: ['Queue'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Public queue status' },
            '404': { description: 'Business not found' },
          },
        },
      },
      '/api/queue/{businessId}/position': {
        get: {
          summary: 'Get customer live queue position in business',
          tags: ['Queue'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Customer position & wait time' },
            '401': { description: 'Unauthorized' },
            '404': { description: 'Not in queue' },
          },
        },
      },
      '/api/queue/{businessId}/join': {
        post: {
          summary: 'Join virtual queue',
          tags: ['Queue'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '201': { description: 'Joined queue successfully' },
            '401': { description: 'Unauthorized' },
            '409': { description: 'Already in queue or queue closed' },
          },
        },
      },
      '/api/queue/{businessId}/check-in': {
        post: {
          summary: 'Check in with booked appointment (hybrid queue)',
          tags: ['Queue'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['appointmentId'],
                  properties: { appointmentId: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Checked in successfully' },
            '401': { description: 'Unauthorized' },
            '409': { description: 'Early/grace violation or conflict' },
          },
        },
      },
      '/api/queue/{businessId}/leave': {
        post: {
          summary: 'Leave virtual queue',
          tags: ['Queue'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Left queue successfully' },
            '401': { description: 'Unauthorized' },
            '404': { description: 'Not in queue' },
          },
        },
      },
      '/api/queue/{businessId}/next': {
        post: {
          summary: 'Call next customer in queue (owner)',
          tags: ['Queue Owner'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Next customer called' },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden' },
            '409': { description: 'Queue empty' },
          },
        },
      },
      '/api/queue/{businessId}/complete': {
        post: {
          summary: 'Complete current customer without calling next (owner)',
          tags: ['Queue Owner'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Current customer marked complete' },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden' },
          },
        },
      },
      '/api/queue/{businessId}/skip': {
        post: {
          summary: 'Skip current customer (owner)',
          tags: ['Queue Owner'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { requeue: { type: 'boolean' } },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Current customer skipped' },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden' },
          },
        },
      },
      '/api/queue/{businessId}/walk-in': {
        post: {
          summary: 'Add walk-in customer directly (owner)',
          tags: ['Queue Owner'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Walk-in added' },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden' },
          },
        },
      },
      '/api/queue/{businessId}/open': {
        patch: {
          summary: 'Toggle queue open/closed status (owner)',
          tags: ['Queue Owner'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { queue_open: { type: 'boolean' } },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Queue open status updated' },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden' },
          },
        },
      },
      '/api/queue/{businessId}': {
        get: {
          summary: 'Get full queue state and today metrics (owner)',
          tags: ['Queue Owner'],
          parameters: [
            { name: 'businessId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Owner queue details' },
            '401': { description: 'Unauthorized' },
            '403': { description: 'Forbidden' },
          },
        },
      },
      '/internal/analytics/business/{id}/summary': {
        get: {
          summary: 'Get queue analytics summary for a business',
          tags: ['internal'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string' } },
            { name: 'to', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Queue analytics summary' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/internal/analytics/business/{id}/today': {
        get: {
          summary: 'Get queue today metrics for a business',
          tags: ['internal'],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Queue today metrics' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/internal/stats': {
        get: {
          summary: 'Get 30-day global queue served stats',
          tags: ['internal'],
          parameters: [
            { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } },
          ],
          responses: {
            '200': { description: '30-day queue stats' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
    },
  };
}
