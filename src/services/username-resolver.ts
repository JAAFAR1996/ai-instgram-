import { getInstagramClient } from './instagram-api.js';
import { getLogger } from './logger.js';

const logger = getLogger({ component: 'UsernameResolver' });

/**
 * Normalize Instagram username for consistent storage/search
 */
function normalizeUsername(username: string): string {
  return username
    .toLowerCase()
    .replace(/^@/, '') // Remove @ prefix
    .trim();
}

/**
 * Resolve Instagram User ID from username using Business Discovery API
 * This is the official Meta way to derive ID from username
 */
export async function resolveIgIdByUsername(
  merchantId: string,
  businessAccountId: string,
  username: string
): Promise<string | null> {
  try {
    const normalizedUsername = normalizeUsername(username);
    logger.info('🔍 Resolving IG ID from username', { merchantId, username: normalizedUsername });
    
    // GET /{businessAccountId}?fields=business_discovery.username({username}){id,username}
    const path = `/${businessAccountId}`;
    const fields = `business_discovery.username(${normalizedUsername}){id,username}`;
    
    const client = await getInstagramClient(merchantId);
    const credentials = await client.loadMerchantCredentials(merchantId);
    if (!credentials?.accessToken) {
      logger.error('❌ No access token for merchant', { merchantId });
      return null;
    }
    
    const response = await client.graphRequest<{ business_discovery?: { id?: string } }>(
      'GET', 
      `${path}?fields=${fields}`,
      credentials.accessToken,
      undefined,
      merchantId,
      false // Return parsed data, not Response object
    ) as { business_discovery?: { id?: string } };
    
    const id = response?.business_discovery?.id;
    
    if (id) {
      logger.info('✅ Successfully resolved IG ID', { username: normalizedUsername, igId: id });
      return id;
    } else {
      logger.warn('⚠️ No IG ID found for username', { username });
      return null;
    }
    
  } catch (error) {
    logger.error('❌ Failed to resolve IG ID from username', { 
      username, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return null;
  }
}

/**
 * Batch resolve multiple usernames to IDs
 */
export async function resolveMultipleIgIdsByUsername(
  merchantId: string,
  businessAccountId: string,
  usernames: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  // Process in batches to avoid rate limits
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
    const batch = usernames.slice(i, i + BATCH_SIZE);
    
    await Promise.allSettled(
      batch.map(async (username) => {
        const id = await resolveIgIdByUsername(merchantId, businessAccountId, username);
        if (id) {
          results.set(username, id);
        }
      })
    );
    
    // Small delay between batches
    if (i + BATCH_SIZE < usernames.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}

/**
 * Resolve username from Instagram user ID using Business Discovery API
 */
export async function resolveUsernameByIgId(
  merchantId: string,
  igUserId: string
): Promise<string | null> {
  try {
    logger.info('🔍 Resolving username from IG user ID', { merchantId, igUserId });
    
    // Get Instagram client
    const client = await getInstagramClient(merchantId);
    const credentials = await client.loadMerchantCredentials(merchantId);
    
    if (!credentials) {
      logger.error('❌ No credentials found for merchant', { merchantId });
      return null;
    }
    
    // Use Instagram Basic Display API to get user info
    const apiClient = await getInstagramClient(merchantId);
    const creds = await apiClient.loadMerchantCredentials(merchantId);
    if (!creds?.accessToken) {
      logger.error('❌ No access token for merchant in username resolver', { merchantId });
      return null;
    }
    
    const response = await apiClient.graphRequest<{ username?: string }>(
      'GET',
      `/${igUserId}?fields=username`,
      creds.accessToken,
      undefined,
      merchantId,
      false // Return parsed data, not Response object
    ) as { username?: string };
    
    const username = response?.username;
    if (username) {
      const normalizedUsername = normalizeUsername(username);
      logger.info('✅ Resolved username from IG ID', { igUserId, username: normalizedUsername });
      return normalizedUsername;
    }
    
    logger.warn('⚠️ No username found for IG ID', { igUserId });
    return null;
    
  } catch (error) {
    logger.error('❌ Failed to resolve username from IG ID', {
      error: error instanceof Error ? error.message : String(error),
      merchantId,
      igUserId
    });
    return null;
  }
}
