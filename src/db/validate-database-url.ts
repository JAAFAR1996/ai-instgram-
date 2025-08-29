/**
 * Database URL validation utility
 * تحقق من صحة DATABASE_URL لتجنب Node.js internal assertions
 */

import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'db-validation' });

export interface DatabaseUrlValidation {
  isValid: boolean;
  error?: string;
  details?: {
    protocol: string;
    host: string;
    port: number;
    database: string;
    username: string;
    hasPassword: boolean;
  };
}

/**
 * Validate DATABASE_URL format and content
 */
export function validateDatabaseUrl(databaseUrl?: string): DatabaseUrlValidation {
  if (!databaseUrl) {
    return {
      isValid: false,
      error: 'DATABASE_URL is not provided'
    };
  }

  try {
    // Parse the URL
    const url = new URL(databaseUrl);
    
    // Check protocol
    if (!url.protocol.startsWith('postgres')) {
      return {
        isValid: false,
        error: `Invalid protocol: ${url.protocol}. Must be postgresql:// or postgres://`
      };
    }

    // Check hostname
    if (!url.hostname) {
      return {
        isValid: false,
        error: 'No hostname specified in DATABASE_URL'
      };
    }

    // Check database name
    const database = url.pathname.slice(1); // Remove leading slash
    if (!database) {
      return {
        isValid: false,
        error: 'No database name specified in DATABASE_URL'
      };
    }

    // Check username
    if (!url.username) {
      return {
        isValid: false,
        error: 'No username specified in DATABASE_URL'
      };
    }

    // Extract details
    const details = {
      protocol: url.protocol,
      host: url.hostname,
      port: url.port ? parseInt(url.port) : 5432,
      database,
      username: url.username,
      hasPassword: !!url.password
    };

    // Additional validation
    if (details.port < 1 || details.port > 65535) {
      return {
        isValid: false,
        error: `Invalid port: ${details.port}. Must be between 1-65535`
      };
    }

    log.info('✅ DATABASE_URL validation passed', {
      host: details.host,
      port: details.port,
      database: details.database,
      username: details.username,
      hasPassword: details.hasPassword
    });

    return {
      isValid: true,
      details
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    log.error('❌ DATABASE_URL validation failed', {
      error: errorMessage,
      url: databaseUrl.substring(0, 50) + '...' // Don't log full URL for security
    });

    return {
      isValid: false,
      error: `Invalid URL format: ${errorMessage}`
    };
  }
}

/**
 * Test database connection without creating a pool
 */
export async function testDatabaseConnection(databaseUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Import pg here to avoid circular dependencies
    const { Client } = await import('pg');
    
    const client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10000, // 10 seconds timeout
      ssl: {
        rejectUnauthorized: false // For Render deployment
      }
    });

    await client.connect();
    
    // Test simple query
    const result = await client.query('SELECT NOW() as current_time');
    
    await client.end();

    log.info('✅ Database connection test successful', {
      currentTime: result.rows[0]?.current_time
    });

    return { success: true };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    log.error('❌ Database connection test failed', {
      error: errorMessage
    });

    return {
      success: false,
      error: errorMessage
    };
  }
}