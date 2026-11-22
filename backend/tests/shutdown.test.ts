import { performGracefulShutdown } from '../src/server';
import { events } from '../src/events';

describe('Graceful Shutdown', () => {
  it('executes graceful shutdown cleanly without hanging or unhandled rejections', async () => {
    // Create mock server
    const mockServer = {
      close: jest.fn((cb: (err?: Error) => void) => {
        cb();
        return mockServer;
      }),
    } as any;

    // Publish an event to exercise event bus flush
    events.publish('test.shutdown', { time: Date.now() });

    // Execute shutdown with 1s timeout
    await expect(performGracefulShutdown(mockServer, 'SIGTERM', 1000)).resolves.not.toThrow();

    expect(mockServer.close).toHaveBeenCalledTimes(1);
  });
});
