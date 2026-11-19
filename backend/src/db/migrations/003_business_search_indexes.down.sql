-- 003_business_search_indexes.down.sql
DROP INDEX IF EXISTS idx_slots_service_start_status;
DROP INDEX IF EXISTS idx_businesses_lower_name;
DROP INDEX IF EXISTS idx_businesses_status_city_category;
