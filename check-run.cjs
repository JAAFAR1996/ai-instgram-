console.log('Checking build artifacts and legal files...');
const fs = require('fs'); 
const p = require('path');

['dist/production-index.js', 'legal/privacy.html', 'legal/deletion.html']
  .forEach(f => { 
    if (!fs.existsSync(p.join(process.cwd(), f))) { 
      console.error('Missing:', f); 
      process.exitCode = 1; 
    } else {
      console.log('✅', f);
    }
  });

if (process.exitCode) {
  console.error('❌ Pre-start check failed');
} else {
  console.log('✅ Pre-start check passed');
}