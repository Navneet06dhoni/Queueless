-- Migration 006: Evolve notifications system & appointment reminders

-- 1. Evolve notifications table
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS data JSONB,
ADD COLUMN IF NOT EXISTS dedupe_key TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_status TEXT CHECK (email_status IN ('not_required', 'pending', 'sent', 'failed')) DEFAULT 'not_required',
ADD COLUMN IF NOT EXISTS email_attempts INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- 2. Migrate existing status values and enforce CHECK (status IN ('unread', 'read'))
UPDATE notifications SET status = 'unread' WHERE status = 'sent';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('unread', 'read'));
ALTER TABLE notifications ALTER COLUMN status SET DEFAULT 'unread';

-- 3. Index for user notifications query (status, created_at desc)
CREATE INDEX IF NOT EXISTS idx_notifications_user_status_created 
ON notifications(user_id, status, created_at DESC);

-- 4. Appointments: Add reminder_sent_at for atomic reminder tracking
ALTER TABLE appointments 
ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
