import { z } from 'zod';

/**
 * Versioned, typed event contracts with denormalized payloads (v: 1).
 * These contracts ensure event consumers (such as Notifications) have all the data
 * they need to produce messages/emails without querying other domain modules' tables.
 */

export const BaseEventSchema = z.object({
  v: z.literal(1).default(1),
});

export const TimestampSchema = z
  .union([z.string(), z.date()])
  .transform((val) => (val instanceof Date ? val.toISOString() : String(val)));

export const BookingConfirmedEventSchema = BaseEventSchema.extend({
  appointmentId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  businessId: z.string().uuid().optional(),
  businessName: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  ownerEmail: z.string().email().optional(),
  serviceId: z.string().uuid().optional(),
  serviceName: z.string().optional(),
  slotId: z.string().uuid().optional(),
  slotStartTime: TimestampSchema.optional(),
  slotEndTime: TimestampSchema.optional(),
});
export type BookingConfirmedEvent = z.infer<typeof BookingConfirmedEventSchema>;

export const BookingCancelledEventSchema = BaseEventSchema.extend({
  appointmentId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  businessId: z.string().uuid().optional(),
  businessName: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  ownerEmail: z.string().email().optional(),
  serviceName: z.string().optional(),
  slotId: z.string().uuid().optional(),
  slotStartTime: TimestampSchema.optional(),
  cancelledBy: z.string().optional().default('system'),
  reason: z.string().optional(),
  customerNotification: z.boolean().default(true),
  ownerNotification: z.boolean().default(true),
});
export type BookingCancelledEvent = z.infer<typeof BookingCancelledEventSchema>;

export const BookingRescheduledEventSchema = BaseEventSchema.extend({
  appointmentId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  businessId: z.string().uuid(),
  businessName: z.string().optional(),
  serviceName: z.string().optional(),
  oldSlotId: z.string().uuid().optional(),
  newSlotId: z.string().uuid().optional(),
  oldSlotStartTime: TimestampSchema.optional(),
  newSlotStartTime: TimestampSchema.optional(),
  startTime: TimestampSchema.optional(),
});
export type BookingRescheduledEvent = z.infer<typeof BookingRescheduledEventSchema>;

export const AppointmentReminderDueEventSchema = BaseEventSchema.extend({
  appointmentId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  customerEmail: z.string().email(),
  businessId: z.string().uuid(),
  businessName: z.string(),
  serviceName: z.string(),
  slotStartTime: TimestampSchema,
});
export type AppointmentReminderDueEvent = z.infer<typeof AppointmentReminderDueEventSchema>;

export const BusinessStatusChangedEventSchema = BaseEventSchema.extend({
  businessId: z.string().uuid(),
  businessName: z.string().optional(),
  ownerId: z.string().uuid(),
  ownerEmail: z.string().email().optional(),
  ownerName: z.string().optional(),
  status: z.enum(['approved', 'rejected']),
  rejectionReason: z.string().optional(),
});
export type BusinessStatusChangedEvent = z.infer<typeof BusinessStatusChangedEventSchema>;

export const QueueJoinedEventSchema = BaseEventSchema.extend({
  queueEntryId: z.string().uuid().optional(),
  entryId: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  businessName: z.string().optional(),
  customerId: z.string().uuid(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  ticketNumber: z.number().int(),
  position: z.number().int(),
  estimatedWaitMinutes: z.number().int().nullable().optional(),
});
export type QueueJoinedEvent = z.infer<typeof QueueJoinedEventSchema>;

export const QueueAdvancedEventSchema = BaseEventSchema.extend({
  queueEntryId: z.string().optional(),
  businessId: z.string().uuid(),
  businessName: z.string().optional(),
  calledEntryId: z.string().optional(),
  calledCustomerId: z.string().uuid().nullable().optional(),
  calledCustomerName: z.string().optional(),
  calledCustomerEmail: z.string().email().optional(),
  customerId: z.string().uuid().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  ticketNumber: z.number().int().optional(),
  position: z.number().int().optional(),
  estimatedWaitMinutes: z.number().int().nullable().optional(),
  stage: z.enum(['next', 'near', 'called']).optional(),
  upcoming: z
    .array(
      z.object({
        customerId: z.string().uuid().nullable().optional(),
        position: z.number().int(),
        entryId: z.string().optional(),
      })
    )
    .optional(),
});
export type QueueAdvancedEvent = z.infer<typeof QueueAdvancedEventSchema>;

export const QueueCalledEventSchema = BaseEventSchema.extend({
  queueEntryId: z.string().uuid().optional(),
  entryId: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  ticketNumber: z.number().int(),
});
export type QueueCalledEvent = z.infer<typeof QueueCalledEventSchema>;

export const QueueCompletedEventSchema = BaseEventSchema.extend({
  queueEntryId: z.string().uuid().optional(),
  entryId: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  ticketNumber: z.number().int(),
});
export type QueueCompletedEvent = z.infer<typeof QueueCompletedEventSchema>;

export const QueueSkippedEventSchema = BaseEventSchema.extend({
  queueEntryId: z.string().uuid().optional(),
  entryId: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  ticketNumber: z.number().int(),
});
export type QueueSkippedEvent = z.infer<typeof QueueSkippedEventSchema>;

export const QueueLeftEventSchema = BaseEventSchema.extend({
  queueEntryId: z.string().uuid().optional(),
  entryId: z.string().uuid().optional(),
  businessId: z.string().uuid(),
  customerId: z.string().uuid(),
  ticketNumber: z.number().int().optional(),
});
export type QueueLeftEvent = z.infer<typeof QueueLeftEventSchema>;

export const UserBlockedEventSchema = BaseEventSchema.extend({
  userId: z.string().uuid(),
  reason: z.string().optional(),
  blockedBy: z.string().uuid().optional(),
});
export type UserBlockedEvent = z.infer<typeof UserBlockedEventSchema>;

export const NotificationCreatedEventSchema = BaseEventSchema.extend({
  notificationId: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  data: z.record(z.any()).optional().default({}),
  createdAt: TimestampSchema.optional(),
});
export type NotificationCreatedEvent = z.infer<typeof NotificationCreatedEventSchema>;

/**
 * Registry of all 10 core domain event contracts with versioned Zod schemas.
 */
export const EventContracts = {
  'booking.confirmed': BookingConfirmedEventSchema,
  'booking.cancelled': BookingCancelledEventSchema,
  'booking.rescheduled': BookingRescheduledEventSchema,
  'business.status_changed': BusinessStatusChangedEventSchema,
  'queue.joined': QueueJoinedEventSchema,
  'queue.left': QueueLeftEventSchema,
  'queue.advanced': QueueAdvancedEventSchema,
  'appointment.reminder_due': AppointmentReminderDueEventSchema,
  'user.blocked': UserBlockedEventSchema,
  'notification.created': NotificationCreatedEventSchema,
} as const;

export type EventContractType = keyof typeof EventContracts;

/**
 * Validates payload on event publishing. Ensures publishers conform to contract.
 */
export function validateEventPublish(type: string, data: any): any {
  const schema = (EventContracts as any)[type];
  if (!schema) return data;
  return schema.parse(data);
}

/**
 * Validates payload on event consumption. Protects consumers from malformed events.
 */
export function validateEventConsume(type: string, data: any): any {
  const schema = (EventContracts as any)[type];
  if (!schema) return data;
  return schema.parse(data);
}
