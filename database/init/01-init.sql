-- ===============================================
-- AI Sales Platform Database Initialization
-- PostgreSQL 16 with pgvector extension
-- ===============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create application user (for production)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ai_sales') THEN
        CREATE ROLE ai_sales WITH LOGIN PASSWORD 'change_this_password';
    END IF;
END $$;

-- Grant necessary permissions
GRANT CONNECT ON DATABASE ai_sales_dev TO ai_sales;
GRANT USAGE ON SCHEMA public TO ai_sales;
GRANT CREATE ON SCHEMA public TO ai_sales;

-- Create audit function for tracking changes
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create function for generating order numbers
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
    next_num INTEGER;
    year_part TEXT;
BEGIN
    year_part := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    
    SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 6) AS INTEGER)), 0) + 1
    INTO next_num
    FROM orders
    WHERE order_number LIKE year_part || '%';
    
    RETURN year_part || LPAD(next_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;