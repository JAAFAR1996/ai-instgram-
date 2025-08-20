/**
 * ===============================================
 * Database Connection Pool Management
 * PostgreSQL connection with connection pooling
 * ===============================================
 */

import postgres from 'postgres';
import type { DatabaseConfig, DatabaseError } from '../types/database.js';
import { getConfig } from '../config/environment.js';

// Configuration interface
interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  max_connections?: number;
  idle_timeout?: number;
  connect_timeout?: number;
}

// Connection pool class
export class DatabaseConnection {
  private sql: ReturnType<typeof postgres> | null = null;
  private config: ConnectionConfig;
  private isConnected = false;

  constructor(config?: Partial<ConnectionConfig>) {
    // Load configuration from validated environment config or fallback to provided config
    try {
      const appConfig = getConfig();
      this.config = {
        host: config?.host || appConfig.database.host,
        port: config?.port || appConfig.database.port,
        database: config?.database || appConfig.database.database,
        username: config?.username || appConfig.database.username,
        password: config?.password || appConfig.database.password,
        ssl: config?.ssl !== undefined ? config.ssl : appConfig.database.ssl,
        max_connections: config?.max_connections || appConfig.database.maxConnections,
        idle_timeout: config?.idle_timeout || parseInt(process.env.DB_IDLE_TIMEOUT || '30'),
        connect_timeout: config?.connect_timeout || parseInt(process.env.DB_CONNECT_TIMEOUT || '10')
      };
    } catch (error) {
      // Fallback to environment variables if config validation fails
      console.warn('⚠️ Using fallback database configuration (environment validation failed)');
      this.config = {
        host: config?.host || process.env.DB_HOST || 'localhost',
        port: config?.port || parseInt(process.env.DB_PORT || '5432'),
        database: config?.database || process.env.DB_NAME || 'ai_sales_dev',
        username: config?.username || process.env.DB_USER || 'postgres',
        password: config?.password || process.env.DB_PASSWORD || 'dev_password_123',
        ssl: config?.ssl !== undefined ? config.ssl : process.env.NODE_ENV === 'production',
        max_connections: config?.max_connections || parseInt(process.env.DB_POOL_MAX || '10'),
        idle_timeout: config?.idle_timeout || parseInt(process.env.DB_IDLE_TIMEOUT || '30'),
        connect_timeout: config?.connect_timeout || parseInt(process.env.DB_CONNECT_TIMEOUT || '10')
      };
    }
  }

  /**
   * Initialize database connection
   */
  public async connect(): Promise<void> {
    try {
      if (this.isConnected && this.sql) {
        return;
      }

      console.log('🔗 Connecting to PostgreSQL database...');
      
      this.sql = postgres(this.config.host, {
        port: this.config.port,
        database: this.config.database,
        username: this.config.username,
        password: this.config.password,
        ssl: this.config.ssl ? 'require' : false,
        max: this.config.max_connections,
        idle_timeout: this.config.idle_timeout,
        connect_timeout: this.config.connect_timeout,
        
        // Additional performance settings
        transform: {
          // Transform undefined to null for PostgreSQL compatibility
          undefined: null
        },
        
        // Error handling
        onnotice: (notice: any) => {
          console.warn('📝 PostgreSQL Notice:', notice);
        },
        
        // Debugging in development
        debug: process.env.NODE_ENV === 'development'
      });

      // Test the connection
      await this.testConnection();
      this.isConnected = true;

      console.log('✅ PostgreSQL connection pool initialized successfully');
      
    } catch (error) {
      this.isConnected = false;
      console.error('❌ Failed to connect to PostgreSQL:', error);
      throw this.formatDatabaseError(error);
    }
  }

  /**
   * Test database connection and basic functionality
   */
  public async testConnection(): Promise<boolean> {
    try {
      if (!this.sql) {
        throw new Error('Database connection not initialized');
      }

      // Test basic connectivity
      const result = await this.sql`SELECT NOW() as current_time, version() as db_version`;
      
      if (result.length === 0) {
        throw new Error('No response from database');
      }

      console.log('📅 Database time:', result[0].current_time);
      console.log('🗄️ Database version:', result[0].db_version.split(' ')[0]);

      // Test required extensions
      await this.checkRequiredExtensions();

      return true;
    } catch (error) {
      console.error('❌ Database connection test failed:', error);
      throw this.formatDatabaseError(error);
    }
  }

  /**
   * Check if required PostgreSQL extensions are installed
   */
  private async checkRequiredExtensions(): Promise<void> {
    const requiredExtensions = ['uuid-ossp', 'pg_trgm', 'pgvector'];
    
    try {
      if (!this.sql) throw new Error('Database not connected');

      const extensions = await this.sql`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = ANY(${requiredExtensions})
      `;

      const installedExtensions = extensions.map(ext => ext.extname);
      const missingExtensions = requiredExtensions.filter(ext => !installedExtensions.includes(ext));

      if (missingExtensions.length > 0) {
        console.warn('⚠️ Missing PostgreSQL extensions:', missingExtensions);
        console.warn('📝 Please install missing extensions in your database');
      } else {
        console.log('✅ All required PostgreSQL extensions are installed');
      }
    } catch (error) {
      console.warn('⚠️ Could not check PostgreSQL extensions:', error);
    }
  }

  /**
   * Get the SQL instance for querying
   */
  public getSQL(): ReturnType<typeof postgres> {
    if (!this.sql || !this.isConnected) {
      throw new Error('Database connection not initialized. Call connect() first.');
    }
    return this.sql;
  }

  /**
   * Execute a query with security validation
   * ⚠️ Use parameterized queries only - prevents SQL injection
   */
  public async query<T = any>(query: string, params: any[] = []): Promise<T[]> {
    try {
      if (!this.sql) {
        throw new Error('Database connection not initialized');
      }

      // 🔒 Security validation before executing query
      this.validateQuerySecurity(query, params);

      const result = await this.sql.unsafe(query, params);
      return result as unknown as T[];
    } catch (error) {
      console.error('❌ Database query error:', error);
      throw this.formatDatabaseError(error);
    }
  }

  /**
   * Validate query for potential SQL injection risks
   * @param query SQL query string
   * @param params Query parameters
   */
  private validateQuerySecurity(query: string, params: any[]): void {
    // Check for potential SQL injection patterns
    if (params.length === 0) {
      // If no parameters, check for suspicious patterns
      const suspiciousPatterns = [
        /\$\d+/,                    // Parameter placeholders without params
        /;.*(?:DROP|DELETE|UPDATE|INSERT|CREATE|ALTER)/i,  // Multiple statements
        /UNION.*SELECT/i,           // Union-based injection
        /OR.*1=1/i,                // Boolean-based injection
        /AND.*1=2/i,               // Boolean-based injection
        /\/\*.*\*\//,              // SQL comments
        /--/,                      // SQL line comments
        /xp_cmdshell/i,            // Command execution
        /sp_executesql/i           // Dynamic SQL execution
      ];

      for (const pattern of suspiciousPatterns) {
        if (pattern.test(query)) {
          throw new Error(
            `🚨 Potential SQL injection detected: Query contains suspicious pattern. Use parameterized queries instead.`
          );
        }
      }
    }

    // Validate parameter types
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      if (typeof param === 'string') {
        // Check for SQL injection in string parameters
        const injectionPatterns = [
          /['"].*(?:OR|AND).*['"]/i,
          /['"].*(?:UNION|SELECT).*['"]/i,
          /['"].*(?:DROP|DELETE).*['"]/i
        ];

        for (const pattern of injectionPatterns) {
          if (pattern.test(param)) {
            console.warn(`⚠️ Suspicious parameter detected at index ${i}:`, param.substring(0, 50));
          }
        }
      }
    }
  }

  /**
   * Execute a transaction
   */
  public async transaction<T>(
    callback: (sql: ReturnType<typeof postgres>) => Promise<T>
  ): Promise<T> {
    if (!this.sql) {
      throw new Error('Database connection not initialized');
    }

    try {
      return await this.sql.begin(async (sql) => {
        return await callback(sql);
      }) as T;
    } catch (error) {
      console.error('❌ Database transaction error:', error);
      throw this.formatDatabaseError(error);
    }
  }

  /**
   * Check if database is healthy
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    timestamp: Date;
    details: {
      connected: boolean;
      response_time_ms: number;
      active_connections: number;
      database_size: string;
    };
  }> {
    const startTime = Date.now();
    
    try {
      if (!this.sql || !this.isConnected) {
        throw new Error('Database not connected');
      }

      // Get connection stats
      const stats = await this.sql`
        SELECT 
          count(*) as active_connections,
          pg_size_pretty(pg_database_size(current_database())) as database_size
        FROM pg_stat_activity 
        WHERE state = 'active'
      `;

      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        timestamp: new Date(),
        details: {
          connected: this.isConnected,
          response_time_ms: responseTime,
          active_connections: parseInt(stats[0].active_connections),
          database_size: stats[0].database_size
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date(),
        details: {
          connected: false,
          response_time_ms: Date.now() - startTime,
          active_connections: 0,
          database_size: 'unknown'
        }
      };
    }
  }

  /**
   * Get database statistics
   */
  public async getStats(): Promise<{
    total_tables: number;
    total_records: number;
    database_size: string;
    largest_tables: Array<{
      table_name: string;
      row_count: number;
      size: string;
    }>;
  }> {
    try {
      if (!this.sql) throw new Error('Database not connected');

      // Get table count
      const tableCount = await this.sql`
        SELECT count(*) as count 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;

      // Get database size
      const dbSize = await this.sql`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `;

      // Get largest tables
      const largestTables = await this.sql`
        SELECT 
          schemaname||'.'||tablename as table_name,
          n_tup_ins + n_tup_upd + n_tup_del as row_count,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_stat_user_tables 
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC 
        LIMIT 10
      `;

      const totalRecords = largestTables.reduce((sum, table) => sum + table.row_count, 0);

      return {
        total_tables: parseInt(tableCount[0].count),
        total_records: totalRecords,
        database_size: dbSize[0].size,
        largest_tables: largestTables.map(table => ({
          table_name: table.table_name,
          row_count: table.row_count,
          size: table.size
        }))
      };
    } catch (error) {
      console.error('❌ Error getting database stats:', error);
      throw this.formatDatabaseError(error);
    }
  }

  /**
   * Close database connection
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.sql && this.isConnected) {
        await this.sql.end();
        console.log('🔌 PostgreSQL connection closed');
      }
      this.sql = null;
      this.isConnected = false;
    } catch (error) {
      console.error('❌ Error closing database connection:', error);
    }
  }

  /**
   * Format database errors for better handling
   */
  private formatDatabaseError(error: any): DatabaseError {
    const dbError = error as DatabaseError;
    
    // Add context to common errors
    if (dbError.code) {
      switch (dbError.code) {
        case '23505':
          dbError.message = `Duplicate key violation: ${dbError.detail || 'Record already exists'}`;
          break;
        case '23503':
          dbError.message = `Foreign key violation: ${dbError.detail || 'Referenced record does not exist'}`;
          break;
        case '23502':
          dbError.message = `Not null violation: ${dbError.column || 'Required field'} cannot be null`;
          break;
        case '42P01':
          dbError.message = `Table does not exist: ${dbError.table || 'Unknown table'}`;
          break;
        case '42703':
          dbError.message = `Column does not exist: ${dbError.column || 'Unknown column'}`;
          break;
      }
    }

    return dbError;
  }

  /**
   * Get connection status
   */
  public isReady(): boolean {
    return this.isConnected && this.sql !== null;
  }

  /**
   * Get connection configuration (without password)
   */
  public getConfig(): Omit<ConnectionConfig, 'password'> {
    const { password, ...safeConfig } = this.config;
    return safeConfig;
  }
}

// Singleton instance
let dbInstance: DatabaseConnection | null = null;

/**
 * Get database connection instance
 */
export function getDatabase(): DatabaseConnection {
  if (!dbInstance) {
    dbInstance = new DatabaseConnection();
  }
  return dbInstance;
}

/**
 * Initialize database connection
 */
export async function initializeDatabase(): Promise<DatabaseConnection> {
  const db = getDatabase();
  
  if (!db.isReady()) {
    await db.connect();
  }
  
  return db;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.disconnect();
    dbInstance = null;
  }
}

/**
 * Set merchant context for Row-Level Security
 */
export async function setMerchantContext(merchantId: string) {
  const db = getDatabase();
  const sql = db.getSQL();
  
  try {
    await sql`SELECT set_merchant_context(${merchantId}::uuid)`;
    console.log(`🔐 Merchant context set: ${merchantId}`);
  } catch (error) {
    console.error('❌ Failed to set merchant context:', error);
    throw error;
  }
}

/**
 * Create a secure connection with merchant context
 */
export async function createSecureConnection(merchantId: string) {
  const db = getDatabase();
  
  if (!db.isReady()) {
    await db.connect();
  }
  
  await setMerchantContext(merchantId);
  return db;
}

/**
 * Execute query with merchant context
 */
export async function executeWithMerchantContext<T = any>(
  merchantId: string,
  queryFn: (sql: ReturnType<typeof postgres>) => Promise<T>
): Promise<T> {
  const db = await createSecureConnection(merchantId);
  const sql = db.getSQL();
  
  return await queryFn(sql);
}

// Export default instance
export default getDatabase;