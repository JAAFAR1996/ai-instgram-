/**
 * ===============================================
 * Migration 033: Add RLS Functions
 * ===============================================
 * 
 * This migration adds the missing RLS functions that are referenced
 * in other migrations but not properly defined.
 * 
 * Functions added:
 * - current_merchant_id() - Returns current merchant ID from session
 * - is_admin_user() - Returns whether current user is admin
 */

-- Create or replace current_merchant_id function
CREATE OR REPLACE FUNCTION current_merchant_id() 
RETURNS UUID AS $$
DECLARE
    merchant_id_str TEXT;
BEGIN
    -- Try to get merchant ID from session variable
    merchant_id_str := current_setting('app.current_merchant_id', true);
    
    -- If not set, return NULL
    IF merchant_id_str IS NULL OR merchant_id_str = '' THEN
        RETURN NULL;
    END IF;
    
    -- Convert to UUID, return NULL if invalid
    RETURN merchant_id_str::UUID;
EXCEPTION 
    WHEN OTHERS THEN
        -- Log error and return NULL
        RAISE WARNING 'Failed to parse merchant_id: %', merchant_id_str;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Create or replace is_admin_user function
CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS BOOLEAN AS $$
DECLARE
    admin_str TEXT;
BEGIN
    -- Try to get admin flag from session variable
    admin_str := current_setting('app.is_admin', true);
    
    -- Default to false if not set
    RETURN COALESCE(admin_str::BOOLEAN, false);
EXCEPTION
    WHEN OTHERS THEN
        -- Log error and return false
        RAISE WARNING 'Failed to parse admin flag: %', admin_str;
        RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Create unified app_user role if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user;
        RAISE NOTICE 'Created app_user role';
    END IF;
END $$;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO app_user;
GRANT EXECUTE ON FUNCTION current_merchant_id() TO app_user;
GRANT EXECUTE ON FUNCTION is_admin_user() TO app_user;

-- Create function to set merchant context
CREATE OR REPLACE FUNCTION set_merchant_context(merchant_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Set session variable for current merchant
    PERFORM set_config('app.current_merchant_id', merchant_id::TEXT, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to set admin context
CREATE OR REPLACE FUNCTION set_admin_context(is_admin BOOLEAN DEFAULT true)
RETURNS VOID AS $$
BEGIN
    -- Set session variable for admin status
    PERFORM set_config('app.is_admin', is_admin::TEXT, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to clear context
CREATE OR REPLACE FUNCTION clear_context()
RETURNS VOID AS $$
BEGIN
    -- Clear session variables
    PERFORM set_config('app.current_merchant_id', '', false);
    PERFORM set_config('app.is_admin', 'false', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions for context functions
GRANT EXECUTE ON FUNCTION set_merchant_context(UUID) TO app_user;
GRANT EXECUTE ON FUNCTION set_admin_context(BOOLEAN) TO app_user;
GRANT EXECUTE ON FUNCTION clear_context() TO app_user;

-- Create view for current context
CREATE OR REPLACE VIEW current_context AS
SELECT 
    current_merchant_id() as merchant_id,
    is_admin_user() as is_admin,
    current_setting('app.current_merchant_id', true) as merchant_id_raw,
    current_setting('app.is_admin', true) as admin_raw;

GRANT SELECT ON current_context TO app_user;

-- Add comments for documentation
COMMENT ON FUNCTION current_merchant_id() IS 'Returns the current merchant ID from session context';
COMMENT ON FUNCTION is_admin_user() IS 'Returns whether the current user has admin privileges';
COMMENT ON FUNCTION set_merchant_context(UUID) IS 'Sets the merchant context for the current session';
COMMENT ON FUNCTION set_admin_context(BOOLEAN) IS 'Sets the admin context for the current session';
COMMENT ON FUNCTION clear_context() IS 'Clears all session context variables';
COMMENT ON VIEW current_context IS 'View showing current session context';

-- Insert migration record
INSERT INTO schema_migrations (version, applied_at, success)
VALUES ('033_add_rls_functions.sql', NOW(), TRUE)
ON CONFLICT (version) DO NOTHING;
