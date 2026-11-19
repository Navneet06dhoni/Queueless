-- Migration 007: Analytics & Admin Audit, User Blocking & Queue Wait Estimates

-- 1. Users table: Add blocked status flags
ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_is_blocked ON users(is_blocked);

-- 2. Queue history table: Add estimated_wait_minutes
ALTER TABLE queue_history
ADD COLUMN IF NOT EXISTS estimated_wait_minutes INT;

-- 3. New table: admin_audit_log
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id ON admin_audit_log(admin_id);

-- 4. Analytics Support Indexes
CREATE INDEX IF NOT EXISTS idx_queue_history_biz_joined ON queue_history(business_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_appointments_slot_status ON appointments(slot_id, status);
CREATE INDEX IF NOT EXISTS idx_slots_service_start ON slots(service_id, start_time);
