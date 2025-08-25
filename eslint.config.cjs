// eslint.config.cjs
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  // تجاهل مجلدات الإخراج
  { ignores: ['dist/', 'node_modules/', '*.js'] },

  // قواعد JavaScript الموصى بها
  js.configs.recommended,

  // قواعد TypeScript الموصى بها
  ...tseslint.configs.recommended,

  // إعدادات المشروع
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' }
    },
    rules: {
      // مطابقة إعدادك السابق: تجاهل المتغيرات التي تبدأ بـ _
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'off'
    }
  },

  // إعدادات مخصصة للملفات الاختبارية
  {
    files: ['**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': false, 'ts-expect-error': true }]
    },
    languageOptions: { globals: { node: true } }
  },

  // إعدادات مخصصة لملفات التعريف
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['off', { allowObjectTypes: true }]
    }
  }
);
