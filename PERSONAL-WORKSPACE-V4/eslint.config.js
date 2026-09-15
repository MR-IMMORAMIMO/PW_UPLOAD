import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'coverage/**',
      'playwright-report/**',
      'playwright-report-personal/**',
      'test-results/**',
      'output/**',
      'outputs/**',
      'tmp/**',
      'appPackage/build/**',
      'release/**',
      'release-*/**',
      'review-radio-station/**',
      'tools/luminaire-studio-v1.4.1/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2023 },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      // Keep stable hook correctness checks. These advisory compiler rules reject
      // established integration patterns in React Query and React Hook Form.
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['**/*.config.{js,ts}', 'scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.es2023 } },
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['apps/web-v4/studio/systems.js', 'apps/web-v4/studio/output-controls.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2023,
        C: 'readonly',
        p: 'writable',
        view: 'readonly',
        paths: 'writable',
        studioReady: 'readonly',
        rowHTML: 'writable',
        render: 'writable',
        h: 'readonly',
        btn: 'readonly',
        mark: 'readonly',
        studioSave: 'readonly',
        openEditor: 'writable',
        toast: 'readonly',
      },
    },
  },
  {
    // Browser globals occur only inside Playwright evaluate callbacks in these disposable checks.
    files: ['scripts/agreement-*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2023 } },
  },
  {
    files: ['apps/web-v4/studio/bridge.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2023,
        C: 'readonly',
        JSZip: 'readonly',
        download: 'readonly',
        $: 'readonly',
        p: 'writable',
        view: 'writable',
        dirty: 'writable',
        savedAt: 'writable',
        saveTimer: 'writable',
        templates: 'writable',
        render: 'readonly',
        updateStatus: 'readonly',
        toast: 'readonly',
        openEditor: 'readonly',
        search: 'writable',
      },
    },
  },
  {
    files: ['desktop/**/*.cjs', 'tools/render-luminaire-studio.cjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.commonjs, ...globals.es2023, fetch: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/web/public/theme-prepaint.js', 'apps/web-v4/public/theme-prepaint.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // V4 hard-isolation gate (Constitution: apps/web-v4 MUST NOT import
    // presentation code from apps/web). Mechanically enforced via
    // no-restricted-imports on the V4 package only.
    files: ['apps/web-v4/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['apps/web', 'apps/web/**', '../web', '../web/**', '../../web/**'],
              message:
                'apps/web-v4 must not import apps/web presentation code (Constitution Hard Isolation Rule).',
            },
          ],
        },
      ],
    },
  },
);
