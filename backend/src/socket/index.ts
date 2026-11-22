import http from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { verifyAccessToken } from '../modules/auth/auth.utils';
import { businessPort } from '../modules/business/business.ports';
import {
  CustomerQueuePosition,
  OwnerQueueDetails,
  PublicQueueStatus,
} from '../modules/queue/queue.types';

let io: Server | null = null;
let pubClient: Redis | null = null;
let subClient: Redis | null = null;

export const initSocketServer = (httpServer: http.Server): Server => {
  if (io) {
    return io;
  }

  io = new Server(httpServer, {
    cors: {
      origin: config.FRONTEND_ORIGIN || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Attempt Redis adapter for multi-instance scaling
  try {
    pubClient = new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        if (io && pubClient && subClient) {
          io.adapter(createAdapter(pubClient, subClient));
          logger.info('✅ Socket.io Redis adapter connected successfully');
        }
      })
      .catch((err) => {
        if (config.NODE_ENV !== 'test') {
          logger.warn({ err: err.message }, '⚠️ Socket.io Redis adapter could not connect, using default in-memory adapter');
        }
      });
  } catch (err: any) {
    if (config.NODE_ENV !== 'test') {
      logger.warn({ err: err.message }, '⚠️ Could not initialize Redis adapter for Socket.io');
    }
  }

  // Authentication Handshake Middleware
  io.use((socket: Socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.split(' ')[1]
        : null);

    if (!token) {
      return next(new Error('Authentication error: Token required'));
    }

    try {
      const payload = verifyAccessToken(token);
      socket.data.user = payload;

      // Check if user is blocked
      import('../middleware/auth')
        .then(({ isUserBlocked }) => isUserBlocked(payload.sub))
        .then((blocked) => {
          if (blocked) {
            return next(new Error('Authentication error: Account suspended'));
          }
          next();
        })
        .catch(() => next());
    } catch {
      return next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  // Connection Handler
  io.on('connection', (socket: Socket) => {
    const userId = socket.data.user?.sub;
    if (userId) {
      socket.join(`user:${userId}`);
    }

    // Client event: queue:watch (Approved businesses only)
    socket.on('queue:watch', async (data: { businessId: string }, ack?: (res: any) => void) => {
      try {
        if (!data?.businessId) {
          if (ack) ack({ error: 'businessId is required' });
          return;
        }

        const biz = await businessPort.findBusiness(data.businessId);
        if (!biz || biz.status !== 'approved') {
          if (ack) ack({ error: 'Business not found or not approved' });
          return;
        }

        socket.join(`queue:${data.businessId}`);
        if (ack) {
          // Acknowledge with public status
          const { queueService } = await import('../modules/queue/queue.service');
          const status = await queueService.getPublicStatus(data.businessId);
          ack({ status });
        }
      } catch (err: any) {
        if (ack) ack({ error: err.message });
      }
    });

    // Client event: queue:unwatch
    socket.on('queue:unwatch', (data: { businessId: string }) => {
      if (data?.businessId) {
        socket.leave(`queue:${data.businessId}`);
      }
    });

    // Client event: queue:watch-owner (Only business owner)
    socket.on('queue:watch-owner', async (data: { businessId: string }, ack?: (res: any) => void) => {
      try {
        if (!data?.businessId) {
          if (ack) ack({ error: 'businessId is required' });
          return;
        }

        if (socket.data.user?.role !== 'owner') {
          if (ack) ack({ error: 'Forbidden: Owner role required' });
          return;
        }

        const biz = await businessPort.findBusiness(data.businessId);
        if (!biz || biz.owner_id !== socket.data.user.sub) {
          if (ack) ack({ error: 'Forbidden: You do not own this business' });
          return;
        }

        socket.join(`owner:${data.businessId}`);
        if (ack) {
          const { queueService } = await import('../modules/queue/queue.service');
          const fullQueue = await queueService.getOwnerQueue(data.businessId, socket.data.user.sub);
          ack({ queue: fullQueue });
        }
      } catch (err: any) {
        if (ack) ack({ error: err.message });
      }
    });
  });

  return io;
};

export const getIO = (): Server | null => io;

export const closeSocketServer = async (): Promise<void> => {
  if (io) {
    io.close();
    io = null;
  }
  if (pubClient) {
    try {
      await pubClient.quit();
    } catch {}
    pubClient = null;
  }
  if (subClient) {
    try {
      await subClient.quit();
    } catch {}
    subClient = null;
  }
};

// Server-side broadcasting helpers
export const emitQueueUpdated = (businessId: string, data: PublicQueueStatus): void => {
  if (io) {
    io.to(`queue:${businessId}`).emit('queue:updated', {
      businessId,
      ...data,
    });
  }
};

export const emitQueuePosition = (userId: string, data: CustomerQueuePosition): void => {
  if (io) {
    io.to(`user:${userId}`).emit('queue:position', data);
  }
};

export const emitQueueCalled = (userId: string, data: { businessId: string; ticketNumber: number }): void => {
  if (io) {
    io.to(`user:${userId}`).emit('queue:called', data);
  }
};

export const emitQueueRemoved = (userId: string, data: { businessId: string; status: string }): void => {
  if (io) {
    io.to(`user:${userId}`).emit('queue:removed', data);
  }
};

export const emitOwnerQueueUpdated = (businessId: string, data: OwnerQueueDetails): void => {
  if (io) {
    io.to(`owner:${businessId}`).emit('queue:owner-updated', data);
  }
};

export const emitNotificationNew = (
  userId: string,
  notification: { id: string; type: string; title: string | null; message: string; data: any; createdAt: string | Date }
): void => {
  if (io) {
    io.to(`user:${userId}`).emit('notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      createdAt:
        notification.createdAt instanceof Date
          ? notification.createdAt.toISOString()
          : notification.createdAt,
    });
  }
};
