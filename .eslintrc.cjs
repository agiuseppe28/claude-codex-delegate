/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.eslint.json' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended-type-checked'],
  env: { node: true, es2022: true },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
  },
  ignorePatterns: ['dist/', 'node_modules/', 'tests/**/*.fixture.*'],
};
