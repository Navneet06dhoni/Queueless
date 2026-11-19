-- 003_business_search_indexes.sql
-- Optimized indexes for business discovery, filtering, and slot range queries

CREATE INDEX IF NOT EXISTS idx_businesses_status_city_category ON businesses (status, city, category);
CREATE INDEX IF NOT EXISTS idx_businesses_lower_name ON businesses (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_slots_service_start_status ON slots (service_id, start_time, status);
