import { ApiError } from '../../utils/ApiError';
import { events } from '../../events';
import { setUserBlockedCache } from '../../middleware/auth';
import { adminRepository, AdminRepository } from './admin.repository';
import { userPort, UserPort } from '../auth/auth.ports';
import { businessPort, BusinessPort } from '../business/business.ports';
import { bookingPort, BookingPort } from '../booking/booking.ports';
import { queuePort, QueuePort } from '../queue/queue.ports';
import { notificationPort, NotificationPort } from '../notification/notification.ports';
import { outboxRepository } from '../../events/outbox.repository';
import {
  AdminAuditLogItem,
  AdminStats,
  AdminUserListItem,
  ListUsersQuery,
} from './admin.types';

export class AdminService {
  constructor(
    private repo: AdminRepository = adminRepository,
    private uPort: UserPort = userPort,
    private bizPort: BusinessPort = businessPort,
    private bkPort: BookingPort = bookingPort,
    private qPort: QueuePort = queuePort,
    private nPort: NotificationPort = notificationPort
  ) {}

  /**
   * Get platform statistics composed purely through module ports (no cross-module SQL joins)
   */
  async getStats(): Promise<AdminStats> {
    const [uStats, bStats, apptStats, qStats, notifStats] = await Promise.all([
      this.uPort.getUserStats(),
      this.bizPort.getBusinessStats(),
      this.bkPort.getBookingStats(),
      this.qPort.getQueueStats(),
      this.nPort.getNotificationStats(),
    ]);

    // Merge daily series by date
    const dailyMap = new Map<string, { date: string; newUsers: number; newAppointments: number }>();

    for (const u of uStats.dailyUsers) {
      dailyMap.set(u.date, { date: u.date, newUsers: u.newUsers, newAppointments: 0 });
    }

    for (const a of apptStats.dailyAppointments) {
      const existing = dailyMap.get(a.date);
      if (existing) {
        existing.newAppointments = a.newAppointments;
      } else {
        dailyMap.set(a.date, { date: a.date, newUsers: 0, newAppointments: a.newAppointments });
      }
    }

    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return {
      users: uStats.usersByRole,
      businesses: bStats.bizByStatus,
      appointments: apptStats.apptByStatus,
      queueServed30Days: qStats.queueServed30Days,
      failedEmails: notifStats.failedEmails,
      daily,
    };
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
   * - Sets user flags, revokes refresh tokens, records audit log
   * - Updates Redis blocked set
   * - Publishes user.blocked event { v: 1, userId, reason, blockedBy }
   * - Booking module listens and cancels future appointments
   * - Queue module listens and removes user from live queues
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

    // 1. Database update & audit log
    await this.repo.blockUserTx(adminId, targetUserId, reason);

    // 2. Update Redis blocked set
    await setUserBlockedCache(targetUserId, true);

    // 3. Publish user.blocked event (decoupled: booking and queue react autonomously)
    await events.publish('user.blocked', {
      v: 1,
      userId: targetUserId,
      reason,
      blockedBy: adminId,
    });

    return { message: 'User blocked successfully' };
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

    return { message: 'User unblocked successfully' };
  }

  /**
   * List admin audit logs with pagination
   */
  async listAuditLogs(
    page: number = 1,
    limit: number = 20
  ): Promise<{
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

  /**
   * Get outbox visibility rows and counts
   */
  async getOutbox(status?: string, limit: number = 20) {
    return outboxRepository.getOutboxRows(status, limit);
  }

  async logAudit(
    adminId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    details: any
  ) {
    return this.repo.createAuditLog(adminId, action, targetType, targetId, details);
  }
}

export const adminService = new AdminService();
