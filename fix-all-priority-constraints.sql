-- Fix ALL priority constraint mismatches across all tables
-- This script fixes the core issue causing database constraint violations

BEGIN;

-- 1. Fix job_spool table (already done but ensuring consistency)
ALTER TABLE job_spool DROP CONSTRAINT IF EXISTS valid_priority;
UPDATE job_spool SET priority = CASE 
  WHEN UPPER(priority) = 'LOW' THEN 'low'
  WHEN UPPER(priority) = 'NORMAL' THEN 'normal' 
  WHEN UPPER(priority) = 'HIGH' THEN 'high'
  WHEN UPPER(priority) = 'CRITICAL' THEN 'urgent'
  ELSE 'normal'
END
WHERE priority NOT IN ('low', 'normal', 'high', 'urgent');
ALTER TABLE job_spool ADD CONSTRAINT valid_priority 
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE job_spool ALTER COLUMN priority SET DEFAULT 'normal';

-- 2. Fix queue_jobs table if exists
DO $$ 
BEGIN 
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'queue_jobs') THEN
    ALTER TABLE queue_jobs DROP CONSTRAINT IF EXISTS queue_jobs_priority_check;
    UPDATE queue_jobs SET priority = CASE 
      WHEN UPPER(priority) = 'LOW' THEN 'low'
      WHEN UPPER(priority) = 'NORMAL' THEN 'normal' 
      WHEN UPPER(priority) = 'HIGH' THEN 'high'
      WHEN UPPER(priority) = 'CRITICAL' THEN 'urgent'
      ELSE 'normal'
    END
    WHERE priority NOT IN ('low', 'normal', 'high', 'urgent');
    ALTER TABLE queue_jobs ADD CONSTRAINT queue_jobs_priority_check 
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
    ALTER TABLE queue_jobs ALTER COLUMN priority SET DEFAULT 'normal';
  END IF;
END $$;

-- 3. Fix manual_followup_queue table (this one is critical!)
ALTER TABLE manual_followup_queue DROP CONSTRAINT IF EXISTS manual_followup_queue_priority_check;
UPDATE manual_followup_queue SET priority = CASE 
  WHEN UPPER(priority) = 'LOW' THEN 'low'
  WHEN UPPER(priority) = 'MEDIUM' THEN 'normal'
  WHEN UPPER(priority) = 'NORMAL' THEN 'normal'
  WHEN UPPER(priority) = 'HIGH' THEN 'high'
  WHEN UPPER(priority) = 'URGENT' THEN 'urgent'
  ELSE 'normal'
END
WHERE priority NOT IN ('low', 'normal', 'high', 'urgent');
ALTER TABLE manual_followup_queue ADD CONSTRAINT manual_followup_queue_priority_check 
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

-- 4. Update any other tables with priority columns (skip integer types)
DO $$
DECLARE
    table_record RECORD;
BEGIN
    FOR table_record IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'priority' 
        AND table_schema = 'public'
        AND data_type = 'character varying'  -- Only VARCHAR columns
        AND table_name NOT IN ('job_spool', 'queue_jobs', 'manual_followup_queue')
    LOOP
        EXECUTE format('UPDATE %I SET priority = CASE 
          WHEN UPPER(priority::text) = ''LOW'' THEN ''low''
          WHEN UPPER(priority::text) = ''NORMAL'' THEN ''normal''
          WHEN UPPER(priority::text) = ''MEDIUM'' THEN ''normal''
          WHEN UPPER(priority::text) = ''HIGH'' THEN ''high''
          WHEN UPPER(priority::text) = ''CRITICAL'' THEN ''urgent''
          WHEN UPPER(priority::text) = ''URGENT'' THEN ''urgent''
          ELSE ''normal''
        END
        WHERE priority NOT IN (''low'', ''normal'', ''high'', ''urgent'')', 
        table_record.table_name);
    END LOOP;
END $$;

-- 5. Fix integer priority tables separately (like manychat_flows)
-- These use numeric priorities: 0=low, 1=normal, 2=high, 3=urgent
-- Leave integer tables as-is since they use different system

-- Verification - only check existing tables
SELECT 'job_spool' as table_name, priority, COUNT(*) as count 
FROM job_spool GROUP BY priority
UNION ALL
SELECT 'manual_followup_queue', priority, COUNT(*) 
FROM manual_followup_queue GROUP BY priority;

COMMIT;

-- Final check - this should return no rows if everything is fixed
SELECT table_name, column_name, constraint_name
FROM information_schema.constraint_column_usage ccu
JOIN information_schema.check_constraints cc ON ccu.constraint_name = cc.constraint_name
WHERE ccu.column_name = 'priority' 
AND cc.check_clause LIKE '%NORMAL%';