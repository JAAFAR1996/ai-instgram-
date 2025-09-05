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
 * Basic Redis validation (ping only - simplified for stability)
 */
export async function validateConnection(connection: Redis): Promise<void> {
  // Simple ping test only - no read/write to avoid rate limiting
  await connection.ping();
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message
    };
  }
}
