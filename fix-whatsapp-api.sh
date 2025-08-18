#!/bin/bash

echo "🔧 Fixing whatsapp-api.ts type issues..."

# Fix unknown type assertions for result
sed -i 's/result\.data/((result as any)\.data)/g' src/services/whatsapp-api.ts
sed -i 's/result\.messageId/((result as any)\.messageId)/g' src/services/whatsapp-api.ts
sed -i 's/result\.success/((result as any)\.success)/g' src/services/whatsapp-api.ts
sed -i 's/result\.error/((result as any)\.error)/g' src/services/whatsapp-api.ts
sed -i 's/result\.contacts/((result as any)\.contacts)/g' src/services/whatsapp-api.ts
sed -i 's/result\.messages/((result as any)\.messages)/g' src/services/whatsapp-api.ts

echo "✅ WhatsApp API type fixes applied"
