-- Fix job_spool table constraint to use lowercase priority values

-- Drop the old constraint
ALTER TABLE job_spool DROP CONSTRAINT IF EXISTS valid_priority;

-- Update existing data to use lowercase values
UPDATE job_spool SET priority = CASE 
  WHEN UPPER(priority) = 'LOW' THEN 'low'
  WHEN UPPER(priority) = 'NORMAL' THEN 'normal' 
  WHEN UPPER(priority) = 'HIGH' THEN 'high'
  WHEN UPPER(priority) = 'CRITICAL' THEN 'urgent'
  ELSE 'normal'
END
WHERE priority NOT IN ('low', 'normal', 'high', 'urgent');

-- Add the new constraint with lowercase values
ALTER TABLE job_spool ADD CONSTRAINT valid_priority 
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

-- Verify the fix
SELECT priority, COUNT(*) as count 
FROM job_spool 
GROUP BY priority 
ORDER BY priority;