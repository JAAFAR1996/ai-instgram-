/**
 * ===============================================
 * TypeScript Declaration File - Module Augmentations
 * TypeScript interfaces and module declarations for packages without types
 * 
 * ✅ Provides type safety for external packages
 * ✅ Extends global Node.js types
 * ✅ Centralizes module declarations
 * ✅ No conflicts with other type files
 * ===============================================
 */

export {}; // Make this file a module augmentation only

// ===============================================
// MODULE DECLARATIONS FOR PACKAGES WITHOUT TYPES
// ===============================================

/**
 * PostgreSQL client library - used throughout the project for database operations
 * Provides type safety for pg module imports
 */
declare module 'pg';

/**
 * OpenTelemetry API - used in telemetry.ts for observability
 * Provides type safety for OpenTelemetry API imports
 */
declare module '@opentelemetry/api';

/**
 * OpenTelemetry SDK Metrics - used in telemetry.ts for metrics collection
 * Provides type safety for OpenTelemetry metrics imports
 */
declare module '@opentelemetry/sdk-metrics';

/**
 * OpenTelemetry SDK Trace Node - used in telemetry.ts for tracing
 * Provides type safety for OpenTelemetry tracing imports
 */
declare module '@opentelemetry/sdk-trace-node';

// ===============================================
// UTILITY TYPES
// ===============================================

/**
 * Flexible string maps for general use throughout the project
 * Used for dynamic key-value pairs where both keys and values are strings
 * 
 * @example
 * ```typescript
 * const headers: StringMap = {
 *   'Content-Type': 'application/json',
 *   'Authorization': 'Bearer token'
 * };
 * ```
 */
export type StringMap = Record<string, string>;

// ===============================================
// GLOBAL TYPE AUGMENTATIONS
// ===============================================

/**
 * Global type augmentations for Node.js environment variables
 * Extends the ProcessEnv interface to include project-specific environment variables
 * Provides type safety for process.env usage throughout the project
 */
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * Node.js environment - determines application behavior
       * @example 'development' | 'production' | 'test'
       */
      NODE_ENV: 'development' | 'production' | 'test';
      
      /**
       * PostgreSQL database connection URL
       * @example 'postgresql://user:password@localhost:5432/database'
       */
      DATABASE_URL?: string;
      
      /**
       * Enable/disable telemetry collection
       * @example 'true' | 'false'
       */
      ENABLE_TELEMETRY?: string;
      
      /**
       * Meta (Facebook) application secret for API authentication
       * Used for Instagram and WhatsApp API integrations
       */
      META_APP_SECRET?: string;
      
      /**
       * Instagram webhook verification token
       * Used for webhook signature verification
       */
      IG_VERIFY_TOKEN?: string;
      
      /**
       * Application port number
       * @example '3000' | '8080'
       */
      PORT?: string;
    }
  }
}

export {}; // Ensure module scope