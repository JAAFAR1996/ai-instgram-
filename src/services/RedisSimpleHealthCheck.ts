/**
 * ===============================================
 * Simple Redis Health Check (Integrated Methods)
 * Basic health checking methods for RedisConnectionManager
 * ===============================================
 */

import type { Redis } from 'ioredis';

/**
 * Simple connection health check
 */
export async function isConnectionHealthy(
  connection: Redis, 
  timeoutMs: number = 2000
): Promise<boolean> {
  try {
    const start = Date.now();
    await Promise.race([
      connection.ping(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Health check timeout')), timeoutMs)
      )
    ]);
    
    const latency = Date.now() - start;
    return latency < timeoutMs * 0.8; // Healthy if under 80% of timeout
  } catch (error) {
    return false;
  }
}

/**
 * Basic Redis validation (ping + simple read/write test)
 */
export async function validateConnection(connection: Redis): Promise<void> {
  // 1. Ping test
  await connection.ping();
  
  // 2. Quick write/read test  
  const testKey = `health:${Date.now()}`;
  const testValue = 'ok';
  
  await connection.set(testKey, testValue, 'EX', 5);
  const result = await connection.get(testKey);
  await connection.del(testKey);
  
  if (result !== testValue) {
    throw new Error('Redis read/write validation failed');
  }
}

/**
 * Simple health check result
 */
export interface SimpleHealthResult {
  success: boolean;
  latency?: number;
  error?: string;
}

/**
 * Perform basic health check
 */
export async function performHealthCheck(connection: Redis): Promise<SimpleHealthResult> {
  try {
    const start = Date.now();
    await validateConnection(connection);
    const latency = Date.now() - start;
    
    return {
      success: true,
      latency
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}
