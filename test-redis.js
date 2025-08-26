import Redis from 'ioredis';

async function testRedisConnection() {
  const redisUrl = 'redis://default:AcJlAAIncDE5Y2EzZjcxY2JmM2Y0ZDMzOGU1YjNjMzI5M2E0ZWY5ZnAxNDk3NjU@welcome-oriole-49765.upstash.io:6379';
  
  console.log('🔄 Testing Redis connection...');
  
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 10000,
    commandTimeout: 5000,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    reconnectOnError: (err) => {
      console.log('❌ Reconnect error:', err.message);
      return false;
    }
  });

  try {
    console.log('📡 Connecting to Redis...');
    await redis.connect();
    
    console.log('✅ Connected successfully!');
    
    console.log('🏓 Testing PING...');
    const pingResult = await redis.ping();
    console.log('✅ PING result:', pingResult);
    
    console.log('📝 Testing SET/GET...');
    await redis.set('test-key', 'test-value', 'EX', 10);
    const getResult = await redis.get('test-key');
    console.log('✅ GET result:', getResult);
    
    await redis.del('test-key');
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    console.error('Error details:', error);
  } finally {
    await redis.disconnect();
    console.log('🔌 Disconnected from Redis');
  }
}

testRedisConnection();
