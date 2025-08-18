#!/bin/bash

echo "🔧 Fixing SQL query syntax..."

# Fix sql.unsafe template literals to function calls in cross-platform-conversation-manager.ts
sed -i 's/sql\.unsafe`/sql.unsafe(`/g' src/services/cross-platform-conversation-manager.ts
sed -i 's/      `;/      `);/g' src/services/cross-platform-conversation-manager.ts
sed -i 's/        `;/        `);/g' src/services/cross-platform-conversation-manager.ts

# Fix the specific inline issues
sed -i "s/sql\.unsafe\`AND ml\.created_at BETWEEN/sql\`AND ml.created_at BETWEEN/g" src/services/cross-platform-conversation-manager.ts
sed -i "s/sql\.unsafe\`AND ml\.created_at >= NOW/sql\`AND ml.created_at >= NOW/g" src/services/cross-platform-conversation-manager.ts

echo "✅ SQL query syntax fixed"
