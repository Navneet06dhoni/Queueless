import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { rabbitMQClient, QUEUES } from '../src/events/rabbitmq';
import { logger } from '../src/utils/logger';

describe('Monolith Architecture Modes (QUEUE_MODE & Startup Guards)', () => {
  const originalQueueMode = config.QUEUE_MODE;

  afterEach(() => {
    (config as any).QUEUE_MODE = originalQueueMode;
  });

  it('QUEUE_MODE=service: /api/queue routes are NOT mounted (returns 404)', async () => {
    (config as any).QUEUE_MODE = 'service';
    const serviceApp = createApp();

    const res = await request(serviceApp).get('/api/queue/00000000-0000-0000-0000-000000000000/status');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('QUEUE_MODE=embedded: /api/queue routes ARE mounted', async () => {
    (config as any).QUEUE_MODE = 'embedded';
    const embeddedApp = createApp();

    const res = await request(embeddedApp).get('/api/queue/00000000-0000-0000-0000-000000000000/status');
    // In embedded mode, hits the route handler which returns BUSINESS_NOT_FOUND (not the global route 404 NOT_FOUND)
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BUSINESS_NOT_FOUND');
  });

  it('Startup guard: refuses to attach duplicate consumer if queue.q already has consumers', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation((() => undefined) as any);

    // Mock rabbitMQClient.getChannel to return channel with consumerCount > 0
    const mockChannel = {
      checkQueue: jest.fn().mockResolvedValue({
        queue: QUEUES.QUEUE,
        consumerCount: 1, // active consumer already present!
        messageCount: 0,
      }),
    };

    const getChannelSpy = jest.spyOn(rabbitMQClient, 'getChannel').mockResolvedValue(mockChannel as any);
    const startConsumerSpy = jest.spyOn(rabbitMQClient, 'startConsumer').mockResolvedValue(undefined as any);

    // Trigger onConnect callback
    let onConnectCallback: (() => Promise<void>) | undefined;
    jest.spyOn(rabbitMQClient, 'onConnect').mockImplementation((cb: any) => {
      onConnectCallback = cb;
    });

    // Reset subscribed state and set embedded mode
    (config as any).QUEUE_MODE = 'embedded';
    (config as any).EVENT_TRANSPORT = 'rabbitmq';

    const { initQueueSubscriptions, _resetSubscribedForTesting } = await import('../src/modules/queue');
    _resetSubscribedForTesting();
    initQueueSubscriptions();

    if (onConnectCallback) {
      await onConnectCallback();
    }

    // Must warn and NOT call startConsumer
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ consumerCount: 1 }),
      expect.stringContaining('Refusing to attach duplicate queue consumer')
    );
    expect(startConsumerSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    getChannelSpy.mockRestore();
    startConsumerSpy.mockRestore();
  });

  it('Startup guard: refuses to attach duplicate consumer if socket.q already has consumers', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation((() => undefined) as any);

    const mockChannel = {
      assertQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue({}),
      checkQueue: jest.fn().mockResolvedValue({
        queue: 'socket.q',
        consumerCount: 1, // active consumer already present!
        messageCount: 0,
      }),
    };

    const getChannelSpy = jest.spyOn(rabbitMQClient, 'getChannel').mockResolvedValue(mockChannel as any);
    const startConsumerSpy = jest.spyOn(rabbitMQClient, 'startConsumer').mockResolvedValue(undefined as any);

    let onConnectCallback: (() => Promise<void>) | undefined;
    jest.spyOn(rabbitMQClient, 'onConnect').mockImplementation((cb: any) => {
      onConnectCallback = cb;
    });

    (config as any).EVENT_TRANSPORT = 'rabbitmq';

    const { initSocketSubscriptions } = await import('../src/socket');
    await initSocketSubscriptions();

    if (onConnectCallback) {
      await onConnectCallback();
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ consumerCount: 1, queue: 'socket.q' }),
      expect.stringContaining('Refusing to attach duplicate socket consumer')
    );
    expect(startConsumerSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    getChannelSpy.mockRestore();
    startConsumerSpy.mockRestore();
  });
});
