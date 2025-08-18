export {}; // Make this file a module augmentation only

// Module declarations for packages without types
declare module 'pg';
declare module '@opentelemetry/api';
declare module '@opentelemetry/sdk-metrics';
declare module '@opentelemetry/sdk-trace-node';
declare module '@opentelemetry/resources';
declare module '@opentelemetry/semantic-conventions';
declare module '@opentelemetry/auto-instrumentations-node';

// Flexible string maps
type StringMap = Record<string, string>;

// API field name corrections
interface InstagramAPIResponse { 
  messageId?: string; 
  message_id?: string;
  [k: string]: any; 
}



// Production-only lowercase platform types
type Platform = 'whatsapp' | 'instagram';
type ConversationStage = string;

// Action types for WhatsApp
type ActionType = 'ADD_TO_CART' | 'SHOW_PRODUCT' | 'CREATE_ORDER' | 
                 'COLLECT_INFO' | 'ESCALATE' | 'SCHEDULE_TEMPLATE' | string;

// Global type augmentations
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      DATABASE_URL?: string;
      ENABLE_TELEMETRY?: string;
      META_APP_SECRET?: string;
      IG_VERIFY_TOKEN?: string;
      PORT?: string;
    }
  }
}

export {}; // Ensure module scope