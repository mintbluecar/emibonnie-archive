// @ts-check
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

/**
 * Layer restrictions from docs/architecture.md ("Architecture and code rules",
 * rule 3, "Enforced layers"). Each glob below gets a `no-restricted-imports`
 * rule naming the layers it must not reach into.
 */
const domainRestrictedPatterns = {
  group: [
    'node:*',
    '**/repo/**',
    '**/services/**',
    '**/http/**',
    '**/routes/**',
    '**/kinds/**',
    '**/db/**',
    '**/sources/**',
    '**/site/**',
  ],
  message: 'src/domain is pure: no I/O, no clock, no imports from other layers.',
};

/**
 * A kind's domain.js is pure, by allowlist: its only (runtime) imports
 * are modules under src/domain/. Types it needs from elsewhere come in
 * through JSDoc `import('…')` types, which ESLint never sees as imports.
 */
const kindDomainAllowlistPattern = {
  regex: '^(?!\\.\\./\\.\\./domain/(?!.*\\.\\.)[\\w./-]+$)',
  message: "src/kinds/<kind>/domain.js is pure: it may import only from src/domain/ (use JSDoc import() types for anything else).",
};

/**
 * Services never name a kind (rule 3 and "Kinds are plugins"): from
 * src/kinds they may import only the registry and the contract.
 */
const servicesKindsPattern = {
  regex: '(^|/)kinds/(?!(_registry|defineKind)\\.js$)',
  message: 'src/services may import from src/kinds only _registry.js and defineKind.js: talk to a kind through the Kind contract.',
};

const baseRules = {
  'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
  complexity: ['error', 10],
  'max-params': ['error', 4],
};

export default [
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...baseRules,
      'import/no-cycle': 'error',
    },
  },
  {
    files: ['src/domain/**/*.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [domainRestrictedPatterns] }],
    },
  },
  {
    files: ['src/kinds/*/domain.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [kindDomainAllowlistPattern] }],
    },
  },
  {
    files: ['src/repo/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/**', '**/sources/**', '**/http/**', '**/routes/**', '**/kinds/**'],
              message: 'src/repo may not import services, sources, http, routes or kinds.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/db/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/repo/**', '**/services/**', '**/sources/**', '**/http/**', '**/routes/**', '**/kinds/**'],
              message: 'src/db may not import repo, services, sources, http, routes or kinds.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/services/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/http/**', '**/routes/**'],
              message: 'src/services may not import http or routes.',
            },
            servicesKindsPattern,
          ],
        },
      ],
    },
  },
  {
    files: ['src/routes/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/repo/**', '**/db/**'],
              message: 'src/routes may not import repo or db directly.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/sources/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/repo/**', '**/services/**', '**/http/**', '**/routes/**', '**/kinds/**'],
              message: 'src/sources may not import repo, services, http, routes or kinds.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['public/js/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/**'],
              message: "public/js is browser code: it may not import src/** (server-only code with Node built-ins). Read settings and copy from the absolute '/site/site.js' instead.",
            },
          ],
        },
      ],
      // '/site/site.js' is a real path once built (public/site/site.js, served at that URL), but
      // not one Node's resolver -- or eslint-plugin-import's -- can find from this source file.
      'import/no-unresolved': ['error', { ignore: ['^/site/'] }],
    },
  },
  {
    files: ['test/**/*.js', 'test/**/*.mjs'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off',
      'max-params': 'off',
    },
  },
  {
    ignores: ['node_modules/**', 'site/', 'public/build/**', 'public/site/**', 'src/site/generated.js', 'src/kinds/_registry.js'],
  },
];
