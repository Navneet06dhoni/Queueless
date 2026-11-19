-- Migration 005 Rollback: Queue system enhancements

DROP INDEX IF EXISTS idx_queue_history_biz_completed;
DROP INDEX IF EXISTS idx_queue_history_biz_status;
DROP INDEX IF EXISTS uq_queue_active_appointment;
DROP INDEX IF EXISTS uq_queue_active_customer;

ALTER TABLE queue_history DROP COLUMN IF EXISTS score;
ALTER TABLE queue_history DROP COLUMN IF EXISTS appointment_id;
ALTER TABLE queue_history DROP COLUMN IF EXISTS source;
ALTER TABLE queue_history DROP COLUMN IF EXISTS ticket_number;
ALTER TABLE queue_history DROP COLUMN IF EXISTS walk_in_name;

-- Delete walk-ins before restoring NOT NULL on customer_id
DELETE FROM queue_history WHERE customer_id IS NULL;
ALTER TABLE queue_history ALTER COLUMN customer_id SET NOT NULL;

ALTER TABLE businesses DROP COLUMN IF EXISTS queue_open;
