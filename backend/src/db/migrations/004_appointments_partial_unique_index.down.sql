-- 004_appointments_partial_unique_index.down.sql
DROP INDEX IF EXISTS idx_appointments_customer_status;
DROP INDEX IF EXISTS uq_appointments_active_slot;
ALTER TABLE appointments ADD CONSTRAINT appointments_slot_id_key UNIQUE (slot_id);
