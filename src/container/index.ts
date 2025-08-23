/**
 * ===============================================
 * Dependency Injection Container
 * Production-ready IoC container for service management
 * ===============================================
 */

import { getPool } from '../db/index.js';
import { getConfig } from '../config/environment.js';
import { getMerchantCache, getTemplateCache, getSessionCache } from '../cache/index.js';
import { getLogger } from '../services/logger.js';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/environment.js';
import type { CacheService, MerchantCache, TemplateCache, SessionCache } from '../cache/index.js';

const log = getLogger({ component: 'di-container' });

// Service registry type definitions
export interface ServiceRegistry {
  // Core infrastructure
  pool: Pool;
  config: AppConfig;
  logger: ReturnType<typeof getLogger>;

  // Cache services
  merchantCache: MerchantCache;
  templateCache: TemplateCache;
  sessionCache: SessionCache;

  // Business services (will be populated)
  aiService?: any;
  instagramService?: any;
  webhookService?: any;
  utilityMessagesService?: any;
}

/**
 * Dependency Injection Container
 */
export class DIContainer {
  private static instance: DIContainer | null = null;
  private services: Partial<ServiceRegistry> = {};
  private singletons: Map<string, any> = new Map();

  private constructor() {
    this.initializeCoreServices();
  }

  public static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  /**
   * Initialize core infrastructure services
   */
  private initializeCoreServices(): void {
    try {
      // Core infrastructure
      this.services.pool = getPool();
      this.services.config = getConfig();
      this.services.logger = getLogger({ component: 'di-container' });

      // Cache services
      this.services.merchantCache = getMerchantCache();
      this.services.templateCache = getTemplateCache();
      this.services.sessionCache = getSessionCache();

      log.info('Core services initialized in DI container');
    } catch (error: any) {
      log.error('Failed to initialize core services:', error);
      throw error;
    }
  }

  /**
   * Register a service as singleton
   */
  public registerSingleton<T>(key: string, factory: () => T): void {
    if (this.singletons.has(key)) {
      log.warn(`Service ${key} is already registered, skipping`);
      return;
    }

    // Register factory function
    this.singletons.set(key, { factory, instance: null });
    log.debug(`Singleton registered: ${key}`);
  }

  /**
   * Register a service instance
   */
  public registerInstance<T>(key: string, instance: T): void {
    this.singletons.set(key, { factory: null, instance });
    log.debug(`Instance registered: ${key}`);
  }

  /**
   * Get service by key
   */
  public get<T>(key: keyof ServiceRegistry): T;
  public get<T>(key: string): T;
  public get<T>(key: string | keyof ServiceRegistry): T {
    // Check if it's a core service
    if (key in this.services) {
      return this.services[key as keyof ServiceRegistry] as T;
    }

    // Check singletons
    const registration = this.singletons.get(key as string);
    if (!registration) {
      throw new Error(`Service not found: ${key}`);
    }

    // Create singleton instance if needed
    if (!registration.instance && registration.factory) {
      try {
        registration.instance = registration.factory();
        log.debug(`Singleton created: ${key}`);
      } catch (error: any) {
        log.error(`Failed to create singleton ${key}:`, error);
        throw error;
      }
    }

    return registration.instance;
  }

  /**
   * Check if service is registered
   */
  public has(key: string): boolean {
    return key in this.services || this.singletons.has(key);
  }

  /**
   * Remove service from container
   */
  public remove(key: string): void {
    this.singletons.delete(key);
    log.debug(`Service removed: ${key}`);
  }

  /**
   * Get all registered service keys
   */
  public getRegisteredServices(): string[] {
    return [
      ...Object.keys(this.services),
      ...this.singletons.keys()
    ];
  }

  /**
   * Clear all services (for testing)
   */
  public clear(): void {
    this.singletons.clear();
    log.debug('All services cleared from container');
  }

  /**
   * Get container statistics
   */
  public getStats(): {
    coreServices: number;
    singletons: number;
    instantiated: number;
  } {
    const coreServices = Object.keys(this.services).length;
    const singletons = this.singletons.size;
    const instantiated = Array.from(this.singletons.values())
      .filter(reg => reg.instance !== null).length;

    return {
      coreServices,
      singletons,
      instantiated
    };
  }

  /**
   * Health check for registered services
   */
  public async healthCheck(): Promise<{
    healthy: boolean;
    services: Array<{ name: string; status: 'healthy' | 'error'; error?: string }>;
  }> {
    const results = [];

    // Check core services
    for (const [name, service] of Object.entries(this.services)) {
      try {
        if (name === 'pool') {
          // Test database connection
          await (service as Pool).query('SELECT 1');
        }
        results.push({ name, status: 'healthy' as const });
      } catch (error: any) {
        results.push({ 
          name, 
          status: 'error' as const, 
          error: error.message 
        });
      }
    }

    const healthy = results.every(r => r.status === 'healthy');

    return { healthy, services: results };
  }
}

/**
 * Service decorator for automatic registration
 */
export function Service(name?: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const serviceName = name || constructor.name;
    const container = DIContainer.getInstance();
    
    container.registerSingleton(serviceName, () => {
      return new constructor(container);
    });

    return constructor;
  };
}

/**
 * Inject decorator for dependency injection
 */
export function Inject(token: string) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    // Store metadata for dependency injection
    const existingTokens = Reflect.getMetadata('inject-tokens', target) || [];
    existingTokens[parameterIndex] = token;
    Reflect.defineMetadata('inject-tokens', existingTokens, target);
  };
}

// Global container instance
export const container = DIContainer.getInstance();

// Convenience functions
export function getService<T>(key: string): T {
  return container.get<T>(key);
}

export function registerService<T>(key: string, factory: () => T): void {
  container.registerSingleton(key, factory);
}

export function registerInstance<T>(key: string, instance: T): void {
  container.registerInstance(key, instance);
}