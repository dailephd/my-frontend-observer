import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', '.my-dev-kit/**', '.my-dev-kit-orchestrator/**', '.my-dev-kit-workflow/**', '.my-dev-kit-context/**', 'observations/**'],
  },
  {
    // v0.9 demo foundation: the only browser-executed script in this
    // repository that is not built by Vite. It is a classic <script> in the
    // examples/v09-demo application, so it runs in a page and needs the two
    // DOM globals it actually touches.
    files: ['examples/v09-demo/app/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        window: 'readonly',
      },
    },
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
