/**
 * ===============================================
 * Architecture Guard - Username-Only Enforcement
 * Prevents any usage of Instagram IDs at runtime
 * ===============================================
 */

import { getLogger } from '../services/logger.js';
import fs from 'fs';
import path from 'path';

const logger = getLogger({ component: 'ArchitectureGuard' });

/**
 * Forbidden patterns that indicate ID usage
 */
const FORBIDDEN_PATTERNS = [
  'instagram_user_id',
  'igUserId', 
  'sender\\.id',            // literal 'sender.id' (Messenger-style), not 'sender_id'
  'event\\.sender\\.id',
  'event\\.value\\.from\\.id',
  'recipientId', // For direct Instagram API calls
  'user_\\d+', // Fallback username patterns
  'IG\\d+' // Seed data ID patterns
];

/**
 * Files allowed to use IDs for username resolution only
 */
const ID_RESOLUTION_ALLOWLIST = [
  'services/instagram-webhook.ts', // Converts incoming IDs to usernames
  'services/username-resolver.ts',  // ID->Username conversion service
  'services/instagram-oauth.ts'     // Merchant OAuth tokens (not customer IDs)
];

/**
 * Runtime guard: Check if codebase contains forbidden patterns
 */
export function validateArchitectureCompliance(): void {
  logger.info('🔍 Validating username-only architecture compliance...');
  
  const violations: string[] = [];
  const srcDir = path.join(process.cwd(), 'src');
  
  try {
    // Check key files for violations
    const criticalFiles = [
      'api/webhooks.ts',
      'services/instagram-webhook.ts',
      'services/instagram-manychat-bridge.ts',
      'services/manychat-api.ts',
      'services/instagram-message-sender.ts',
      'repositories/conversation-repository.ts'
    ];
    
    for (const file of criticalFiles) {
      const filePath = path.join(srcDir, file);
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Check if file is in allowlist for ID resolution
        const isAllowedForIDResolution = ID_RESOLUTION_ALLOWLIST.some(allowed => 
          file.endsWith(allowed) || file.includes(allowed)
        );
        
        for (const pattern of FORBIDDEN_PATTERNS) {
          const regex = new RegExp(pattern, 'g');
          const matches = content.match(regex);
          
          if (matches && matches.length > 0) {
            // Filter out comments and disabled code
            const lines = content.split('\n');
            const problematicLines = lines
              .map((line, index) => ({ line: line.trim(), number: index + 1 }))
              .filter(({ line }) => {
                if (!regex.test(line)) return false;
                if (line.startsWith('//') || line.startsWith('*')) return false;
                if (line.includes('DISABLED:') || line.includes('ARCHITECTURE ENFORCEMENT:')) return false;
                
                // Allow ID usage in allowlisted files if it's for resolution purposes
                if (isAllowedForIDResolution) {
                  if (line.includes('resolveUsernameByIgId') || 
                      line.includes('username resolution') ||
                      line.includes('Convert') || 
                      line.includes('OAuth') ||
                      line.includes('merchant token')) {
                    return false; // Skip - this is legitimate ID->username conversion
                  }
                }
                
                return true;
              });
            
            if (problematicLines.length > 0) {
              violations.push(`${file}: Found ${matches.length} violations of pattern "${pattern}"`);
              problematicLines.forEach(({ line, number }) => {
                violations.push(`  Line ${number}: ${line}`);
              });
            }
          }
        }
      }
    }
    
    if (violations.length > 0) {
      logger.error('❌ Architecture violations detected!');
      violations.forEach(violation => logger.error(`  ${violation}`));
      
      // In production, fail hard
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Username-only architecture violations detected - deployment blocked');
      } else {
        logger.warn('⚠️ Architecture violations detected in development mode');
      }
    } else {
      logger.info('✅ Username-only architecture compliance verified');
    }
    
  } catch (error) {
    logger.error('Failed to validate architecture compliance', error);
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
  }
}

/**
 * Runtime guard: Validate that a value is a username, not an ID
 */
export function validateUsername(value: string, context: string = ''): void {
  if (!value || typeof value !== 'string') {
    throw new Error(`Invalid username: empty or non-string value ${context ? `(${context})` : ''}`);
  }
  
  const trimmed = value.trim();
  
  // Check for ID patterns
  if (/^\d+$/.test(trimmed)) {
    throw new Error(`Username validation failed: looks like numeric ID "${trimmed}" ${context ? `(${context})` : ''}`);
  }
  
  if (/^user_\d+$/.test(trimmed)) {
    throw new Error(`Username validation failed: looks like fallback ID pattern "${trimmed}" ${context ? `(${context})` : ''}`);
  }
  
  if (/^IG\d+$/.test(trimmed)) {
    throw new Error(`Username validation failed: looks like Instagram ID "${trimmed}" ${context ? `(${context})` : ''}`);
  }
  
  // Valid username should be reasonable length and format
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new Error(`Username validation failed: invalid length "${trimmed}" ${context ? `(${context})` : ''}`);
  }
  
  logger.debug('✅ Username validated', { username: trimmed, context });
}

/**
 * Guard for ManyChat operations - ensures username-only
 */
export function guardManyChatOperation(
  merchantId: string, 
  username: string, 
  operation: string
): void {
  validateUsername(username, `ManyChat ${operation}`);
  
  if (!merchantId || typeof merchantId !== 'string') {
    throw new Error(`Invalid merchant ID for ManyChat ${operation}`);
  }
  
  logger.debug('✅ ManyChat operation guarded', { merchantId, username, operation });
}

/**
 * Guard for conversation operations - ensures username-only
 */
export function guardConversationOperation(
  merchantId: string, 
  username: string, 
  platform: string,
  operation: string
): void {
  validateUsername(username, `Conversation ${operation}`);
  
  if (platform === 'instagram' && (!username || username.includes('user_'))) {
    throw new Error(`Instagram conversation ${operation} requires valid username, not ID pattern`);
  }
  
  logger.debug('✅ Conversation operation guarded', { merchantId, username, platform, operation });
}
