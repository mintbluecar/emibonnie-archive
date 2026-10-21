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

const kindDomainSiblingPattern = {
  regex: '^(\\./|\\.\\./[^/]+/)(repo|presenter|search|index)(\\.js)?$',
  message: "src/kinds/<kind>/domain.js is pure: it may not import the kind's repo, presenter, search or index.",
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
    // A kind's domain.js follows the domain rules, and the dir globs above
    // can't see a relative import of its own siblings (./repo.js), so those
    // are blocked by name too (and the same files of any other kind).
    files: ['src/kinds/*/domain.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [domainRestrictedPatterns, kindDomainSiblingPattern] }],
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
