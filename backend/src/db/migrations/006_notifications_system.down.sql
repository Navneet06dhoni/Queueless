-- Migration 006 Rollback: Notifications system

ALTER TABLE appointments DROP COLUMN IF EXISTS reminder_sent_at;

DROP INDEX IF EXISTS idx_notifications_user_status_created;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('sent', 'unread', 'read'));
ALTER TABLE notifications ALTER COLUMN status SET DEFAULT 'sent';

ALTER TABLE notifications DROP COLUMN IF EXISTS last_error;
ALTER TABLE notifications DROP COLUMN IF EXISTS email_attempts;
ALTER TABLE notifications DROP COLUMN IF EXISTS email_status;
ALTER TABLE notifications DROP COLUMN IF EXISTS read_at;
ALTER TABLE notifications DROP COLUMN IF EXISTS dedupe_key;
ALTER TABLE notifications DROP COLUMN IF EXISTS data;
ALTER TABLE notifications DROP COLUMN IF EXISTS title;
