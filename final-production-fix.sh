#!/bin/bash

echo "🔧 Final production fixes..."

# Fix Platform type issues - replace all UPPERCASE with lowercase
find src -name "*.ts" -exec sed -i "s/'WHATSAPP'/'whatsapp'/g; s/'INSTAGRAM'/'instagram'/g; s/\"WHATSAPP\"/\"whatsapp\"/g; s/\"INSTAGRAM\"/\"instagram\"/g" {} \;

# Fix OrderSource type
sed -i "s/export type OrderSource = 'WHATSAPP' | 'INSTAGRAM'/export type OrderSource = 'whatsapp' | 'instagram'/g" src/types/database.ts

# Fix security.ts duplicate export
sed -i '/export { SecurityContext };/d' src/middleware/security.ts
sed -i '/export type { SecurityContext };/d' src/middleware/security.ts

# Fix string maps
find src -name "*.ts" -exec sed -i 's/const TEMPLATES = {/const TEMPLATES: Record<string, string> = {/g' {} \;
find src -name "*.ts" -exec sed -i 's/const ERROR_MAP = {/const ERROR_MAP: Record<string, string> = {/g' {} \;

# Test build
echo "📦 Testing build..."
npx tsc -p tsconfig.build.json --noEmit 2>&1 | tail -10