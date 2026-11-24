import http from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '@queueless/common';
import { coreClient, CoreClient } from '../coreClient';
import { redisDb } from '../redis';
import {
  CustomerQueuePosition,
  OwnerQueueDetails,
  PublicQueueStatus,
} from '../types';

let io: Server | null = null;
let pubClient: Redis | null = null;
let subClient: Redis | null = null;
let activeCoreClient: CoreClient = coreClient;

export const setSocketCoreClient = (client: CoreClient): void => {
  activeCoreClient = client;
};

export const getIO = (): Server | null => io;

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
      db: redisDb,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    subClient = pubClient.duplicate();

    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        if (io && pubClient && subClient) {
          io.adapter(createAdapter(pubClient, subClient));
          logger.info('✅ [QueueSocket] Redis adapter connected successfully');
        }
      })
      .catch((err) => {
        if (config.NODE_ENV !== 'test') {
          logger.warn({ err: err.message }, '⚠️ [QueueSocket] Redis adapter could not connect, using default in-memory adapter');
        }
      });
  } catch (err: any) {
    if (config.NODE_ENV !== 'test') {
      logger.warn({ err: err.message }, '⚠️ [QueueSocket] Could not initialize Redis adapter');
    }
  }

  // Authentication Handshake Middleware via Core Client
  io.use(async (socket: Socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.split(' ')[1]
        : null);

    if (!token) {
      return next(new Error('Authentication error: Token required'));
    }

    try {
      // Verify token through monolith core API (checks expiration and blocked status)
      const user = await activeCoreClient.verifyToken(token);
      socket.data.user = {
        sub: user.userId,
        role: user.role,
        name: user.name,
      };
      next();
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

    // Client event: queue:watch (join room queue:{businessId})
    socket.on('queue:watch', async (data: { businessId: string }, ack?: (res: any) => void) => {
      try {
        if (!data?.businessId) {
          if (ack) ack({ error: 'businessId is required' });
          return;
        }

        socket.join(`queue:${data.businessId}`);
        if (ack) {
          const { queueService } = await import('../service');
          const status = await queueService.getPublicStatus(data.businessId);
          ack({ success: true, status });
        }
      } catch (err: any) {
        if (ack) ack({ error: err.message });
      }
    });

    // Client event: owner:watch (join room owner:{businessId})
    socket.on('owner:watch', async (data: { businessId: string }, ack?: (res: any) => void) => {
      try {
        const user = socket.data.user;
        if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
          if (ack) ack({ error: 'Unauthorized: Owner or admin role required' });
          return;
        }

        if (!data?.businessId) {
          if (ack) ack({ error: 'businessId is required' });
          return;
        }

        // Verify business ownership via core client
        const biz = await activeCoreClient.getBusinessQueueInfo(data.businessId);
        if (biz.ownerId !== user.sub && user.role !== 'admin') {
          if (ack) ack({ error: 'Forbidden: You do not own this business' });
          return;
        }

        socket.join(`owner:${data.businessId}`);
        if (ack) {
          const { queueService } = await import('../service');
          const details = await queueService.getOwnerQueue(data.businessId, user.sub, user.role);
          ack({ success: true, details });
        }
      } catch (err: any) {
        if (ack) ack({ error: err.message });
      }
    });
  });

  return io;
};

export const closeSocketServer = async (): Promise<void> => {
  if (io) {
    await new Promise<void>((resolve) => {
      io!.close(() => resolve());
    });
    io = null;
  }
  if (pubClient) {
    pubClient.disconnect();
    pubClient = null;
  }
  if (subClient) {
    subClient.disconnect();
    subClient = null;
  }
};

// Sockets Emission Helpers
export const emitQueueUpdated = (businessId: string, status: PublicQueueStatus): void => {
  if (io) {
    io.to(`queue:${businessId}`).emit('queue:updated', status);
  }
};

export const emitOwnerQueueUpdated = (businessId: string, details: OwnerQueueDetails): void => {
  if (io) {
    io.to(`owner:${businessId}`).emit('owner:queue:updated', details);
  }
};

export const emitQueuePosition = (customerId: string, position: CustomerQueuePosition): void => {
  if (io) {
    io.to(`user:${customerId}`).emit('queue:position', position);
  }
};

export const emitQueueCalled = (
  customerId: string,
  payload: { businessId: string; ticketNumber: number }
): void => {
  if (io) {
    io.to(`user:${customerId}`).emit('queue:called', payload);
  }
};

export const emitQueueRemoved = (
  customerId: string,
  payload: { businessId: string; status: 'completed' | 'skipped' | 'left' }
): void => {
  if (io) {
    io.to(`user:${customerId}`).emit('queue:removed', payload);
  }
};

export const emitNotificationNew = (userId: string, notification: any): void => {
  if (io) {
    io.to(`user:${userId}`).emit('notification:new', notification);
  }
};

export const disconnectUserSockets = (userId: string): void => {
  if (io) {
    io.in(`user:${userId}`).disconnectSockets(true);
  }
};
