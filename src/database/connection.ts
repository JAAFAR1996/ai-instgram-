/**
 * ===============================================
 * Database Connection Pool Management
 * PostgreSQL connection with connection pooling
 * ===============================================
 */

import postgres, { Sql } from 'postgres';
import type { DatabaseError } from '../types/database.js';
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

// Interfaces for query results
interface TestResult {
  current_time: Date;
  db_version: string;
}

interface ExtensionRow {
  extname: string;
}

interface StatsRow {
  active_connections: string;
  database_size: string;
}

interface TableCountRow {
  count: string;
}

interface DbSizeRow {
  size: string;
}

interface LargestTableRow {
  table_name: string;
  row_count: number;
  size: string;
}

interface TableStatsRow {
  table_name: string;
  row_count: number;
  size: string;
}



// Postgres client type
type SqlClient = Sql<{}>;

// Connection pool class
export class DatabaseConnection {
  private sql: SqlClient | null = null;
  private config: ConnectionConfig;
  private isConnected = false;

  constructor(config?: Partial<ConnectionConfig>) {
    // Load configuration from validated environment config or override with provided config
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
      
      this.sql = postgres({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.username,
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
      const result = await this.sql<TestResult[]>`SELECT NOW() as current_time, version() as db_version`;
      
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

      const extensions = await this.sql<ExtensionRow[]>`
        SELECT extname
        FROM pg_extension
        WHERE extname = ANY(${requiredExtensions})
      `;

      const installedExtensions = extensions.map((ext: ExtensionRow) => ext.extname);
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
  public getSQL(): Sql {
    if (!this.sql || !this.isConnected) {
      throw new Error('Database connection not initialized. Call connect() first.');
    }
    return this.sql;
  }

  /**
   * Execute a parameterized query using tagged templates
   * Provides automatic sanitization via the postgres library
   */
  public async query<T extends Record<string, any> = Record<string, any>>(
    strings: TemplateStringsArray,
    ...params: any[]
  ): Promise<T[]> {
    try {
      if (!this.sql) {
        throw new Error('Database connection not initialized');
      }

      return this.sql<T[]>(strings, ...params) as Promise<T[]>;
    } catch (error) {
      console.error('❌ Database query error:', error);
      throw this.formatDatabaseError(error);
    }
  }

  /**
   * Execute a transaction
   */
  public async transaction<T>(
    callback: (sql: Sql) => Promise<T>
  ): Promise<T> {
    if (!this.sql) {
      throw new Error('Database connection not initialized');
    }

    try {
      return await this.sql.begin(callback) as T;
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
      const stats = await this.sql<StatsRow[]>`
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
          active_connections: parseInt(stats[0].active_connections, 10),
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
      const tableCount = await this.sql<TableCountRow[]>`
        SELECT count(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;

      // Get database size
      const dbSize = await this.sql<DbSizeRow[]>`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `;

      // Get largest tables
      const largestTables = await this.sql<LargestTableRow[]>`
        SELECT
          schemaname||'.'||tablename as table_name,
          n_tup_ins + n_tup_upd + n_tup_del as row_count,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        LIMIT 10
      `;

      const totalRecords = largestTables.reduce<number>(
        (sum: number, table: LargestTableRow) => sum + table.row_count,
        0
      );

      return {
        total_tables: parseInt(tableCount[0].count, 10),
        total_records: totalRecords,
        database_size: dbSize[0].size,
        largest_tables: largestTables.map((table) => ({
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
export async function executeWithMerchantContext<T = unknown>(
  merchantId: string,
  queryFn: (sql: Sql) => Promise<T>
): Promise<T> {
  const db = await createSecureConnection(merchantId);
  const sql = db.getSQL();
  
  return await queryFn(sql);
}

// Export default instance
export default getDatabase;