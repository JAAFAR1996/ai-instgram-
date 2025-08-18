#!/bin/bash

echo "🔧 Fixing remaining TypeScript errors..."

# Fix instagram-ai.ts ERROR_MAP type issue
sed -i 's/const ERROR_MAP = {/const ERROR_MAP: Record<string, string> = {/g' src/services/instagram-ai.ts

# Fix instagram-api.ts unknown type assertions
sed -i 's/result\.data/((result as any)\.data)/g' src/services/instagram-api.ts
sed -i 's/result\.messageId/((result as any)\.messageId)/g' src/services/instagram-api.ts

# Fix cross-platform SQL issues - remove parenthesis issues
sed -i 's/sql\.unsafe(`AND ml\.created_at BETWEEN/sql\`AND ml.created_at BETWEEN/g' src/services/cross-platform-conversation-manager.ts
sed -i 's/sql\.unsafe(`AND ml\.created_at >= NOW/sql\`AND ml.created_at >= NOW/g' src/services/cross-platform-conversation-manager.ts
sed -i 's/sql\.unsafe(``/sql\`/g' src/services/cross-platform-conversation-manager.ts

# Fix allProducts type in instagram-ai.ts
sed -i '657s/let allProducts = \[\];/let allProducts: any[] = [];/' src/services/instagram-ai.ts

echo "✅ TypeScript fixes applied"
