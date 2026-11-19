-- Migration 005: Queue system enhancements for live virtual queue & hybrid check-ins

-- 1. Businesses: Add queue_open status
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS queue_open BOOLEAN NOT NULL DEFAULT true;

-- 2. Queue History: Make customer_id nullable for walk-ins
ALTER TABLE queue_history 
ALTER COLUMN customer_id DROP NOT NULL;

-- 3. Queue History: Add walk-in name, ticket number, source, appointment link, and ordering score
ALTER TABLE queue_history 
ADD COLUMN IF NOT EXISTS walk_in_name TEXT,
ADD COLUMN IF NOT EXISTS ticket_number INT,
ADD COLUMN IF NOT EXISTS source TEXT CHECK (source IN ('online', 'appointment', 'walk_in')),
ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS score BIGINT;

-- 4. Unique Partial Indexes: A customer can only be in one active queue at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_active_customer 
ON queue_history(customer_id) 
WHERE status IN ('waiting', 'called') AND customer_id IS NOT NULL;

-- 5. Unique Partial Indexes: An appointment can only be in one active queue at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_active_appointment 
ON queue_history(appointment_id) 
WHERE status IN ('waiting', 'called') AND appointment_id IS NOT NULL;

-- 6. Indexes on business_id and status / completed_at for fast queue lookups & rolling averages
CREATE INDEX IF NOT EXISTS idx_queue_history_biz_status 
ON queue_history(business_id, status);

CREATE INDEX IF NOT EXISTS idx_queue_history_biz_completed 
ON queue_history(business_id, completed_at);
