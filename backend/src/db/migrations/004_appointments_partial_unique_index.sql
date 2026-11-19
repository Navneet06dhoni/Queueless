-- 004_appointments_partial_unique_index.sql
-- Replace full unique constraint on appointments.slot_id with partial unique index
-- This allows re-booking of a slot after a previous booking is cancelled

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_slot_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_active_slot 
ON appointments(slot_id) 
WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appointments_customer_status 
ON appointments(customer_id, status);
