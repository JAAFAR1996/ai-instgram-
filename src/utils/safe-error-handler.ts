/**
 * ===============================================
 * Universal Error Handler
 * معالج أخطاء شامل ومتعدد الطبقات
 * ===============================================
 */

import { serr } from '../isolation/context.js';
import { getErrorMessage } from '../types/common.js';

/**
 * Universal Error Handler Factory
 * إنشاء معالج أخطاء شامل لكل مكون
 */
export function createSafeErrorHandler(component: string) {
  return {
    handleError: (error: unknown, context: Record<string, unknown> = {}) => {
      const timestamp = new Date().toISOString();
      
      // Layer 1: serr function - استخراج الخصائص الآمنة
      const baseError = serr(error);
      
      // Layer 2: message extraction - استخراج رسالة الخطأ
      const message = getErrorMessage(error);
      
      // Layer 3: context preservation - الحفاظ على السياق
      const safeContext = {
        ...context,
        component,
        timestamp,
        errorType: typeof error,
        hasStack: !!(error as any)?.stack
      };

      return {
        ...baseError,
        message,
        context: safeContext
      };
    }
  };
}

/**
 * Enhanced Error Handler with additional features
 * معالج أخطاء محسن مع ميزات إضافية
 */
export function createEnhancedErrorHandler(component: string, options: {
  includeStackTrace?: boolean;
  includeMemoryInfo?: boolean;
  includeRequestInfo?: boolean;
} = {}) {
  const {
    includeStackTrace = true,
    includeMemoryInfo = false,
    includeRequestInfo = false
  } = options;

  return {
    handleError: (
      error: unknown, 
      context: Record<string, unknown> = {},
      requestInfo?: {
        path?: string;
        method?: string;
        headers?: Record<string, string>;
        query?: Record<string, string>;
      }
    ) => {
      const timestamp = new Date().toISOString();
      
      // Layer 1: Base error extraction
      const baseError = serr(error);
      
      // Layer 2: Message extraction
      const message = getErrorMessage(error);
      
      // Layer 3: Enhanced context
      const safeContext: Record<string, unknown> = {
        ...context,
        component,
        timestamp,
        errorType: typeof error,
        hasStack: !!(error as any)?.stack
      };

      // Layer 4: Stack trace (optional)
      if (includeStackTrace && (error as any)?.stack) {
        safeContext.stackTrace = (error as any).stack;
      }

      // Layer 5: Memory information (optional)
      if (includeMemoryInfo) {
        safeContext.memoryUsage = process.memoryUsage();
        safeContext.uptime = process.uptime();
      }

      // Layer 6: Request information (optional)
      if (includeRequestInfo && requestInfo) {
        safeContext.requestInfo = {
          path: requestInfo.path,
          method: requestInfo.method,
          hasHeaders: !!requestInfo.headers,
          hasQuery: !!requestInfo.query
        };
      }

      return {
        ...baseError,
        message,
        context: safeContext
      };
    },

    // Utility method for logging
    logError: (
      error: unknown,
      context: Record<string, unknown> = {},
      requestInfo?: {
        path?: string;
        method?: string;
        headers?: Record<string, string>;
        query?: Record<string, string>;
      }
    ) => {
      const handledError = this.handleError(error, context, requestInfo);
      
      // Use console.error for immediate logging (avoid circular dependencies)
      console.error(JSON.stringify({
        level: 'error',
        component,
        timestamp: new Date().toISOString(),
        ...handledError
      }));

      return handledError;
    }
  };
}

/**
 * Quick error handler for simple use cases
 * معالج أخطاء سريع للاستخدامات البسيطة
 */
export function quickErrorHandler(error: unknown, component: string): {
  name?: string;
  message: string;
  code?: unknown;
  component: string;
  timestamp: string;
} {
  return {
    ...serr(error),
    message: getErrorMessage(error),
    component,
    timestamp: new Date().toISOString()
  };
}

/**
 * Error handler with retry logic
 * معالج أخطاء مع منطق إعادة المحاولة
 */
export function createRetryErrorHandler(component: string, maxRetries = 3) {
  return {
    handleErrorWithRetry: async <T>(
      operation: () => Promise<T>,
      context: Record<string, unknown> = {},
      retryDelay = 1000
    ): Promise<T> => {
      let lastError: unknown;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error;
          
          const errorInfo = createSafeErrorHandler(component).handleError(error, {
            ...context,
            attempt,
            maxRetries,
            willRetry: attempt < maxRetries
          });

          console.error(JSON.stringify({
            level: 'error',
            component,
            timestamp: new Date().toISOString(),
            ...errorInfo
          }));

          if (attempt < maxRetries) {
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          }
        }
      }

      // All retries failed
      throw lastError;
    }
  };
}

export default {
  createSafeErrorHandler,
  createEnhancedErrorHandler,
  quickErrorHandler,
  createRetryErrorHandler
};
