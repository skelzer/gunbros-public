// Flat config for @gunbros/shared.
//
// The shared package is the deterministic simulation: it must run bit-identically
// in every browser and on the server. These rules enforce that contract.
// No formatting rules on purpose.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Math members that are not correctly rounded across engines, plus Math.random. */
const bannedMath = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'exp',
  'expm1',
  'pow',
  'log',
  'log2',
  'log10',
  'log1p',
  'hypot',
  'cbrt',
  'sinh',
  'cosh',
  'tanh',
  'fround',
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {},
    },
    rules: {
      'no-restricted-properties': [
        'error',
        ...bannedMath.map((property) => ({
          object: 'Math',
          property,
          message:
            'Not deterministic across engines. Use math/trig.ts, math/prng.ts or plain + - * / and Math.sqrt.',
        })),
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'packages/shared must not touch the DOM.' },
        { name: 'document', message: 'packages/shared must not touch the DOM.' },
        { name: 'navigator', message: 'packages/shared must not touch the DOM.' },
        { name: 'localStorage', message: 'packages/shared must not touch the DOM.' },
        { name: 'fetch', message: 'packages/shared must not do I/O.' },
        { name: 'performance', message: 'packages/shared must stay free of ambient clocks.' },
        { name: 'process', message: 'packages/shared must not import or use Node APIs.' },
        { name: 'Buffer', message: 'packages/shared must not import or use Node APIs.' },
        { name: 'require', message: 'packages/shared is ESM-only.' },
        { name: '__dirname', message: 'packages/shared must not import or use Node APIs.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'packages/shared must not import Node built-ins.' },
            {
              group: [
                'fs',
                'path',
                'os',
                'crypto',
                'util',
                'events',
                'stream',
                'buffer',
                'worker_threads',
              ],
              message: 'packages/shared must not import Node built-ins.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'packages/shared must stay free of wall-clock time.',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'packages/shared must stay free of wall-clock time.',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Tests are never shipped: they may name the banned APIs in expectations and read
    // the source tree with node:fs to enforce the same rules a second time.
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['eslint.config.js', 'vitest.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
