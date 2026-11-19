export type NotificationChannel = 'in_app' | 'email';
export type NotificationStatus = 'unread' | 'read';
export type EmailDeliveryStatus = 'not_required' | 'pending' | 'sent' | 'failed';

export interface INotification {
  id: string;
  user_id: string;
  type: string;
  title: string | null;
  message: string;
  data: any;
  dedupe_key: string | null;
  read_at: Date | null;
  email_status: EmailDeliveryStatus;
  email_attempts: number;
  last_error: string | null;
  status: NotificationStatus;
  created_at: Date;
}

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailTransport {
  sendMail(options: EmailOptions): Promise<void>;
}

export interface NotificationPayload {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: any;
  dedupeKey: string;
  emailOptions?: EmailOptions;
}
