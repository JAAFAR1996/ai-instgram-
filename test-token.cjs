// Test what IG_VERIFY_TOKEN is actually set to
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN || 'test_token_123';

console.log('🔍 Environment Variable Check:');
console.log('============================');
console.log('IG_VERIFY_TOKEN value:');
console.log(`"${IG_VERIFY_TOKEN}"`);
console.log(`Length: ${IG_VERIFY_TOKEN.length}`);
console.log('Characters:');
for (let i = 0; i < IG_VERIFY_TOKEN.length; i++) {
  console.log(`${i}: "${IG_VERIFY_TOKEN[i]}" (${IG_VERIFY_TOKEN.charCodeAt(i)})`);
}

console.log('');
console.log('Test values:');
console.log('webhook_verify_ai_sales_2025 === IG_VERIFY_TOKEN:', 'webhook_verify_ai_sales_2025' === IG_VERIFY_TOKEN);
console.log('iHNDoPLa9sH8v59z5Twq+V5sVl1fzVyRzg6G9NpvjXAnF4kadaKlJKki0nmtNZpd === IG_VERIFY_TOKEN:', 'iHNDoPLa9sH8v59z5Twq+V5sVl1fzVyRzg6G9NpvjXAnF4kadaKlJKki0nmtNZpd' === IG_VERIFY_TOKEN);