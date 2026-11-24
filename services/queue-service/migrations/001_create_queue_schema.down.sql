-- 001_create_queue_schema.down.sql
DROP TABLE IF EXISTS processed_events;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS queue_settings;
DROP TABLE IF EXISTS queue_history;
