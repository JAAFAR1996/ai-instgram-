// Quick DATABASE_URL validation script
const url = 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a/ai_instgram';

try {
  const parsed = new URL(url);
  console.log('✅ URL parsing successful:');
  console.log('Protocol:', parsed.protocol);
  console.log('Host:', parsed.hostname);
  console.log('Port:', parsed.port || '5432');
  console.log('Database:', parsed.pathname.slice(1));
  console.log('Username:', parsed.username);
  console.log('Has Password:', !!parsed.password);
} catch (error) {
  console.log('❌ URL parsing failed:', error.message);
}