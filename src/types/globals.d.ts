/**
 * ===============================================
 * Global Type Definitions - AI Sales Platform
 * Ambient type declarations for global types
 * Used across the entire application
 * 
 * ✅ Provides global type definitions
 * ✅ Ensures type consistency across modules
 * ✅ Reduces duplication of common types
 * ===============================================
 */

// ===============================================
// LOGGING & CONTEXT TYPES
// ===============================================

/**
 * Global logging context type
 * Used for consistent logging across all services
 * Extends the base context with common fields
 */
declare global {
  type LogContext = Record<string, unknown> & {
    traceId?: string;
    correlationId?: string;
    requestId?: string;
    merchantId?: string;
    userId?: string;
    sessionId?: string;
    component?: string;
    environment?: string;
    version?: string;
  };
}

// ===============================================
// ENVIRONMENT & CONFIGURATION TYPES
// ===============================================

/**
 * Global environment variables type
 * Extends NodeJS.ProcessEnv with our custom variables
 */
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Database
      DATABASE_URL?: string;
      DB_HOST?: string;
      DB_PORT?: string;
      DB_NAME?: string;
      DB_USER?: string;
      DB_PASSWORD?: string;
      
      // Redis
      REDIS_URL?: string;
      REDIS_HOST?: string;
      REDIS_PORT?: string;
      REDIS_PASSWORD?: string;
      
      // Instagram
      INSTAGRAM_APP_ID?: string;
      INSTAGRAM_APP_SECRET?: string;
      INSTAGRAM_WEBHOOK_SECRET?: string;
      INSTAGRAM_REDIRECT_URI?: string;
      
      // AI/OpenAI
      OPENAI_API_KEY?: string;
      OPENAI_MODEL?: string;
      
      // Server
      PORT?: string;
      NODE_ENV?: 'development' | 'staging' | 'production';
      LOG_LEVEL?: 'error' | 'warn' | 'info' | 'debug';
      
      // Security
      JWT_SECRET?: string;
      SESSION_SECRET?: string;
      ENCRYPTION_KEY?: string;
      
      // Monitoring
      SENTRY_DSN?: string;
      NEW_RELIC_LICENSE_KEY?: string;
      
      // Feature flags
      ENABLE_AI_PROCESSING?: string;
      ENABLE_AUTO_REPLY?: string;
      ENABLE_STORY_RESPONSE?: string;
    }
  }
}

// ===============================================
// UTILITY TYPES
// ===============================================

/**
 * Generic success response type
 * Used across all API responses
 */
type ApiSuccessResponse<T = unknown> = {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
};

/**
 * Generic error response type
 * Used across all API error responses
 */
type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
};

/**
 * Generic API response type
 * Union of success and error responses
 */
type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// ===============================================
// COMMON INTERFACES
// ===============================================

/**
 * Base entity interface
 * All database entities should extend this
 */
interface BaseEntity {
  id: string;
  created_at: string;
  updated_at: string;
}

/**
 * Pagination interface
 * Used for paginated API responses
 */
interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Paginated response interface
 * Combines data with pagination info
 */
interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

// ===============================================
// EXPORT TYPES FOR MODULE USE
// ===============================================

export type {
  LogContext,
  ApiSuccessResponse,
  ApiErrorResponse,
  ApiResponse,
  BaseEntity,
  Pagination,
  PaginatedResponse
};
