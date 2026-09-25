// Flat config for @gunbros/client. Deliberately minimal: the rules that matter for the
// simulation live in @gunbros/shared, and the client is allowed to be a browser.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        location: 'readonly',
        history: 'readonly',
        Image: 'readonly',
        console: 'readonly',
        devicePixelRatio: 'readonly',
        addEventListener: 'readonly',
        removeEventListener: 'readonly',
      },
    },
    rules: {
      // Anything that feeds MatchState must come from the shared PRNG and trig; only
      // pure presentation (particles, parallax jitter) may use the host's own maths.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { process: 'readonly' } },
  },
);
