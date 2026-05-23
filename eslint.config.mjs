// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // Paths ESLint should never look at.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '.claude/**',
      'packages/db/drizzle/**', // generated migrations + snapshots
    ],
  },

  // Base recommendations + type-aware TypeScript rules.
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Wire up the TypeScript project service so type-aware rules can run.
  // It resolves the nearest tsconfig for each file automatically.
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Declare callback-valued members as arrow properties, not methods.
      // Method syntax makes `this` bivariant and trips `unbound-method` when a
      // prop/return callback is referenced unbound (idiomatic in React).
      '@typescript-eslint/method-signature-style': ['error', 'property'],
      // Boolean `a || b` is legitimate logical-or, not a nullish-coalescing
      // candidate — `??` would change behavior on `false`.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { boolean: true } },
      ],
      // `_`-prefixed identifiers are intentionally unused (interface params,
      // ignored destructured values, throwaway bindings).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true, // `const { omit, ...rest } = obj` idiom
        },
      ],
    },
  },

  // Node-side code: APIs, worker, and shared libraries.
  {
    files: [
      'apps/api/**/*.ts',
      'apps/ingestion-worker/**/*.ts',
      'packages/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
  },

  // Browser-side code: the React frontend.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Async functions passed to JSX event-handler props are idiomatic React;
      // React ignores the returned promise, so this isn't a misuse here.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

  // Test files: relax rules that fight idiomatic test code.
  // - require-await: fakes implement async interfaces / async generators where
  //   `async` with no `await` is intentional conformance, not a smell.
  // - no-unsafe-*/no-explicit-any/unbound-method: mocks, spies, and cast
  //   fixtures are inherently loosely-typed; enforcing type-safety here is
  //   high-noise/low-signal. Source code keeps full strictness.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off', // stub/mock callbacks
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Build/config files outside any tsconfig project. The project service only
  // auto-discovers `tsconfig.json`, so these (incl. vite.config.ts, which lives
  // in tsconfig.node.json) need type-aware parsing disabled.
  {
    files: [
      '**/*.{js,mjs,cjs}',
      'vitest.workspace.ts',
      'apps/web/vite.config.ts',
      'test/e2e/**/*.ts', // root e2e suite — has a vitest project but no tsconfig
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
