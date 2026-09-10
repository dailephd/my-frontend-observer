import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', '.my-dev-kit/**', '.my-dev-kit-orchestrator/**', '.my-dev-kit-workflow/**', '.my-dev-kit-context/**', 'observations/**'],
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        // browser-only globals, referenced only inside Playwright page.evaluate() closures (executed in-page, never in this Node process).
        navigator: 'readonly',
        caches: 'readonly',
      },
    },
  },
);
