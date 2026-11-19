import { ApiError } from '../../utils/ApiError';
import { events } from '../../events';
import { setUserBlockedCache } from '../../middleware/auth';
import { adminRepository, AdminRepository } from './admin.repository';
import {
  AdminAuditLogItem,
  AdminStats,
  AdminUserListItem,
  ListUsersQuery,
} from './admin.types';

export class AdminService {
  constructor(private repo: AdminRepository = adminRepository) {}

  /**
   * Get platform statistics
   */
  async getStats(): Promise<AdminStats> {
    return this.repo.getStats();
  }

  /**
   * List users with search and filters
   */
  async listUsers(options: ListUsersQuery): Promise<{
    data: AdminUserListItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const { users, total } = await this.repo.listUsers(options);

    return {
      data: users,
      page,
      limit,
      total,
    };
  }

  /**
   * Block a user:
   * - Cannot block self or another admin (403)
   * - Atomic transaction: sets flags, revokes refresh tokens, cancels future appointments & frees slots
   * - After commit: publishes booking.cancelled events, removes from active queues, updates Redis set
   */
  async blockUser(adminId: string, targetUserId: string, reason?: string) {
    if (adminId === targetUserId) {
      throw ApiError.forbidden('An administrator cannot block themselves', 'CANNOT_BLOCK_SELF');
    }

    const targetUser = await this.repo.findUserById(targetUserId);
    if (!targetUser) {
      throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
    }

    if (targetUser.role === 'admin') {
      throw ApiError.forbidden(
        'An administrator cannot block another administrator',
        'CANNOT_BLOCK_ADMIN'
      );
    }

    // 1. Database atomic transaction
    const { cancelledAppointments } = await this.repo.blockUserTx(adminId, targetUserId, reason);

    // 2. Update Redis blocked set
    await setUserBlockedCache(targetUserId, true);

    // 3. Publish cancellation events after commit
    for (const appt of cancelledAppointments) {
      events.publish('booking.cancelled', {
        appointmentId: appt.id,
        businessId: appt.business_id,
        cancelledBy: 'admin',
        customerNotification: true,
        ownerNotification: true,
      });
    }

    // 4. Remove user from any active queue
    try {
      const leftEntries = await this.repo.removeUserFromActiveQueues(targetUserId);
      if (leftEntries.length > 0) {
        const { queueRedis } = await import('../queue/queue.redis');
        const { queueService } = await import('../queue/queue.service');

        for (const entry of leftEntries) {
          await queueRedis.removeEntry(entry.business_id, entry.id, targetUserId);
          await queueService.broadcastQueueState(entry.business_id);
          await queueService.updateWaitingPositions(entry.business_id);
        }
      }
    } catch (err: any) {
      console.warn(`[AdminService] Error cleaning up queues for blocked user ${targetUserId}:`, err.message);
    }

    return {
      message: 'User has been blocked successfully',
      userId: targetUserId,
      cancelledAppointmentsCount: cancelledAppointments.length,
    };
  }

  /**
   * Unblock a user
   */
  async unblockUser(adminId: string, targetUserId: string) {
    const targetUser = await this.repo.findUserById(targetUserId);
    if (!targetUser) {
      throw ApiError.notFound('User not found', 'USER_NOT_FOUND');
    }

    await this.repo.unblockUserTx(adminId, targetUserId);
    await setUserBlockedCache(targetUserId, false);

    return {
      message: 'User has been unblocked successfully',
      userId: targetUserId,
    };
  }

  /**
   * Record audit log
   */
  async logAudit(
    adminId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    details: any
  ): Promise<void> {
    await this.repo.createAuditLog(adminId, action, targetType, targetId, details);
  }

  /**
   * List admin audit logs
   */
  async listAuditLogs(page: number = 1, limit: number = 20): Promise<{
    data: AdminAuditLogItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    const { logs, total } = await this.repo.listAuditLogs(page, limit);
    return {
      data: logs,
      page,
      limit,
      total,
    };
  }
}

export const adminService = new AdminService();
