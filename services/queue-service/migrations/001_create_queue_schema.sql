-- 001_create_queue_schema.sql
-- Queue Microservice schema (no FKs to monolith core)

-- 1. queue_history
CREATE TABLE IF NOT EXISTS queue_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    customer_id UUID,
    customer_name TEXT,
    customer_email TEXT,
    walk_in_name TEXT,
    ticket_number INT,
    source TEXT CHECK (source IN ('online', 'appointment', 'walk_in')),
    appointment_id UUID,
    score BIGINT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    called_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'completed', 'skipped', 'left')),
    estimated_wait_minutes INT
);

-- Partial Unique Indexes for concurrency & queue integrity
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_active_customer 
ON queue_history(customer_id) 
WHERE status IN ('waiting', 'called') AND customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_active_appointment 
ON queue_history(appointment_id) 
WHERE status IN ('waiting', 'called') AND appointment_id IS NOT NULL;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_queue_history_biz_status 
ON queue_history(business_id, status);

CREATE INDEX IF NOT EXISTS idx_queue_history_biz_completed 
ON queue_history(business_id, completed_at);

CREATE INDEX IF NOT EXISTS idx_queue_history_joined_at 
ON queue_history(joined_at);

-- 2. queue_settings
CREATE TABLE IF NOT EXISTS queue_settings (
    business_id UUID PRIMARY KEY,
    queue_open BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. outbox_events
CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  trace_context JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
  ON outbox_events (status, created_at)
  WHERE status = 'pending';

-- 4. processed_events
CREATE TABLE IF NOT EXISTS processed_events (
  event_id UUID NOT NULL,
  consumer_name TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, consumer_name)
);

CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at
  ON processed_events (processed_at DESC);
