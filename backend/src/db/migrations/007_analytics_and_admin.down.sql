-- Migration 007 Down: Revert Analytics & Admin Audit, User Blocking & Queue Wait Estimates

-- 1. Drop analytics indexes
DROP INDEX IF EXISTS idx_slots_service_start;
DROP INDEX IF EXISTS idx_appointments_slot_status;
DROP INDEX IF EXISTS idx_queue_history_biz_joined;

-- 2. Drop admin_audit_log table and its indexes
DROP INDEX IF EXISTS idx_admin_audit_log_admin_id;
DROP INDEX IF EXISTS idx_admin_audit_log_created_at;
DROP TABLE IF EXISTS admin_audit_log;

-- 3. Remove estimated_wait_minutes from queue_history
ALTER TABLE queue_history
DROP COLUMN IF EXISTS estimated_wait_minutes;

-- 4. Remove is_blocked, blocked_at, blocked_reason from users
DROP INDEX IF EXISTS idx_users_is_blocked;

ALTER TABLE users
DROP COLUMN IF EXISTS blocked_reason,
DROP COLUMN IF EXISTS blocked_at,
DROP COLUMN IF EXISTS is_blocked;
