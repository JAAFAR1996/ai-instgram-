/**
 * ===============================================
 * Instagram Error Handling Utilities
 * Centralized error categorization and handling
 * ===============================================
 */

import type { InstagramError, SendResult } from '../types/instagram.js';
import { InstagramErrorCode } from '../types/instagram.js';

/**
 * Error categorization function
 */
export function categorizeInstagramError(error: unknown, context?: Record<string, unknown>): InstagramError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorString = errorMessage.toLowerCase();
  
  // Authentication & Authorization Errors
  if (errorString.includes('invalid') && (errorString.includes('token') || errorString.includes('credential'))) {
    return {
      code: InstagramErrorCode.INVALID_CREDENTIALS,
      message: 'Invalid Instagram credentials provided',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'AUTH'
    };
  }
  
  if (errorString.includes('expired') && errorString.includes('token')) {
    return {
      code: InstagramErrorCode.EXPIRED_TOKEN,
      message: 'Instagram access token has expired',
      details: { originalError: errorMessage, ...context },
      retryable: true,
      category: 'AUTH'
    };
  }
  
  if (errorString.includes('unauthorized') || errorString.includes('401')) {
    return {
      code: InstagramErrorCode.UNAUTHORIZED_ACCESS,
      message: 'Unauthorized access to Instagram API',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'AUTH'
    };
  }
  
  if (errorString.includes('permission') || errorString.includes('403')) {
    return {
      code: InstagramErrorCode.INSUFFICIENT_PERMISSIONS,
      message: 'Insufficient permissions for Instagram operation',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'AUTH'
    };
  }
  
  // Rate Limiting & Quota Errors
  if (errorString.includes('rate limit') || errorString.includes('429') || errorString.includes('too many requests')) {
    return {
      code: InstagramErrorCode.RATE_LIMIT_EXCEEDED,
      message: 'Instagram API rate limit exceeded',
      details: { originalError: errorMessage, ...context },
      retryable: true,
      category: 'RATE_LIMIT'
    };
  }
  
  if (errorString.includes('quota') || errorString.includes('limit exceeded')) {
    return {
      code: InstagramErrorCode.QUOTA_EXCEEDED,
      message: 'Instagram API quota exceeded',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'RATE_LIMIT'
    };
  }
  
  if (errorString.includes('message window expired') || errorString.includes('24 hour')) {
    return {
      code: InstagramErrorCode.MESSAGE_WINDOW_EXPIRED,
      message: 'Message window expired - cannot send message within 24 hours',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'RATE_LIMIT'
    };
  }
  
  // Media & Content Errors
  if (errorString.includes('media upload') || errorString.includes('upload failed')) {
    return {
      code: InstagramErrorCode.MEDIA_UPLOAD_FAILED,
      message: 'Instagram media upload failed',
      details: { originalError: errorMessage, ...context },
      retryable: true,
      category: 'MEDIA'
    };
  }
  
  if (errorString.includes('invalid format') || errorString.includes('unsupported format')) {
    return {
      code: InstagramErrorCode.INVALID_MEDIA_FORMAT,
      message: 'Invalid or unsupported media format',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'MEDIA'
    };
  }
  
  if (errorString.includes('size exceeded') || errorString.includes('too large')) {
    return {
      code: InstagramErrorCode.MEDIA_SIZE_EXCEEDED,
      message: 'Media file size exceeds Instagram limits',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'MEDIA'
    };
  }
  
  if (errorString.includes('invalid content') || errorString.includes('content policy')) {
    return {
      code: InstagramErrorCode.INVALID_MESSAGE_CONTENT,
      message: 'Message content violates Instagram policies',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'MEDIA'
    };
  }
  
  // Recipient & User Errors
  if (errorString.includes('invalid recipient') || errorString.includes('recipient not found')) {
    return {
      code: InstagramErrorCode.INVALID_RECIPIENT,
      message: 'Invalid or non-existent recipient',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'RECIPIENT'
    };
  }
  
  if (errorString.includes('user not found') || errorString.includes('404')) {
    return {
      code: InstagramErrorCode.RECIPIENT_NOT_FOUND,
      message: 'Instagram user not found',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'RECIPIENT'
    };
  }
  
  if (errorString.includes('blocked') || errorString.includes('user blocked')) {
    return {
      code: InstagramErrorCode.RECIPIENT_BLOCKED,
      message: 'Recipient has blocked the business account',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'RECIPIENT'
    };
  }
  
  if (errorString.includes('opted out') || errorString.includes('unsubscribed')) {
    return {
      code: InstagramErrorCode.RECIPIENT_OPTED_OUT,
      message: 'Recipient has opted out of messages',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'RECIPIENT'
    };
  }
  
  // Network & Infrastructure Errors
  if (errorString.includes('timeout') || errorString.includes('timed out')) {
    return {
      code: InstagramErrorCode.NETWORK_TIMEOUT,
      message: 'Instagram API request timed out',
      details: { originalError: errorMessage, ...context },
      retryable: true,
      category: 'NETWORK'
    };
  }
  
  if (errorString.includes('connection') || errorString.includes('network')) {
    return {
      code: InstagramErrorCode.NETWORK_CONNECTION_FAILED,
      message: 'Network connection to Instagram API failed',
      details: { originalError: errorMessage, ...context },
      retryable: true,
      category: 'NETWORK'
    };
  }
  
  if (errorString.includes('service unavailable') || errorString.includes('503')) {
    return {
      code: InstagramErrorCode.API_SERVICE_UNAVAILABLE,
      message: 'Instagram API service is temporarily unavailable',
      details: { originalError: errorMessage, ...context },
      retryable: true,
      category: 'NETWORK'
    };
  }
  
  // Database & Storage Errors
  if (errorString.includes('database') || errorString.includes('connection failed')) {
    return {
      code: InstagramErrorCode.DATABASE_CONNECTION_FAILED,
      message: 'Database connection failed',
      details: { originalError: errorMessage, ...context },
      retryable: true,
      category: 'DATABASE'
    };
  }
  
  if (errorString.includes('credentials not found')) {
    return {
      code: InstagramErrorCode.CREDENTIALS_NOT_FOUND,
      message: 'Instagram credentials not found for merchant',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'DATABASE'
    };
  }
  
  if (errorString.includes('logging failed')) {
    return {
      code: InstagramErrorCode.LOGGING_FAILED,
      message: 'Failed to log message activity',
      details: { originalError: errorMessage, ...context },
      retryable: true,
      category: 'DATABASE'
    };
  }
  
  // Business Logic Errors
  if (errorString.includes('merchant not found')) {
    return {
      code: InstagramErrorCode.MERCHANT_NOT_FOUND,
      message: 'Merchant not found in system',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'BUSINESS'
    };
  }
  
  if (errorString.includes('invalid conversation')) {
    return {
      code: InstagramErrorCode.INVALID_CONVERSATION_ID,
      message: 'Invalid conversation ID provided',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'BUSINESS'
    };
  }
  
  if (errorString.includes('template conversion')) {
    return {
      code: InstagramErrorCode.TEMPLATE_CONVERSION_FAILED,
      message: 'Failed to convert message template',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'BUSINESS'
    };
  }
  
  // Validation Errors
  if (errorString.includes('validation') || errorString.includes('invalid')) {
    return {
      code: InstagramErrorCode.VALIDATION_ERROR,
      message: 'Input validation failed',
      details: { originalError: errorMessage, ...context },
      retryable: false,
      category: 'GENERIC'
    };
  }
  
  // Default unknown error
  return {
    code: InstagramErrorCode.UNKNOWN_ERROR,
    message: 'An unknown error occurred while processing Instagram message',
    details: { originalError: errorMessage, ...context },
    retryable: false,
    category: 'GENERIC'
  };
}

/**
 * Helper function to create error response
 */
export function createErrorResponse(error: unknown, context?: Record<string, unknown>): SendResult {
  const categorizedError = categorizeInstagramError(error, context);
  
  return {
    success: false,
    error: JSON.stringify({
      code: categorizedError.code,
      message: categorizedError.message,
      details: categorizedError.details,
      retryable: categorizedError.retryable,
      category: categorizedError.category
    }),
    deliveryStatus: 'failed',
    timestamp: new Date()
  };
}
