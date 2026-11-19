import { EventEmitter } from 'events';

class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  /**
   * Publish an event with a name and payload
   * Keeps callers decoupled so event bus can easily switch to RabbitMQ/Redis later
   */
  public publish(name: string, payload: any): void {
    setImmediate(() => {
      this.emitter.emit(name, payload);
    });
  }

  /**
   * Subscribe to an event
   */
  public subscribe(name: string, handler: (payload: any) => Promise<void> | void): void {
    this.emitter.on(name, async (payload) => {
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[EventBus] Error handling event "${name}":`, err);
      }
    });
  }

  /**
   * Unsubscribe from an event
   */
  public unsubscribe(name: string, handler: (...args: any[]) => void): void {
    this.emitter.off(name, handler);
  }
}

export const events = new EventBus();
export default events;
