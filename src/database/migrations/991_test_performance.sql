
        -- Add index on large dataset
        CREATE INDEX CONCURRENTLY idx_test_performance_data 
          ON test_performance_migration(data);

        -- Add new column with default value
        ALTER TABLE test_performance_migration 
        ADD COLUMN status VARCHAR(20) DEFAULT 'pending';

        -- Update all records (potentially slow operation)
        UPDATE test_performance_migration 
        SET status = CASE 
          WHEN id % 2 = 0 THEN 'active'
          ELSE 'inactive'
        END;

        -- Create partial index
        CREATE INDEX idx_test_performance_active 
          ON test_performance_migration(created_at) 
          WHERE status = 'active';
      