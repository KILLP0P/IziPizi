const { default: js } = await import('@eslint/js');
const { default: ts } = await import('typescript-eslint');
export default ts.config({ ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**'] }, js.configs.recommended, ...ts.configs.recommended, {
 files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-explicit-any': 'error' }
}, { files: ['**/*.mjs','**/*.js'], languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', AbortSignal: 'readonly', fetch: 'readonly', Buffer: 'readonly' } } });
