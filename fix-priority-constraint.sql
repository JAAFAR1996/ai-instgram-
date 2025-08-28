-- Fix manual_followup_queue constraint
UPDATE manual_followup_queue SET priority = 'normal' WHERE priority NOT IN ('low', 'normal', 'high', 'urgent');

-- Check current constraint
SELECT conname, contype, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'manual_followup_queue'::regclass 
AND contype = 'c';
