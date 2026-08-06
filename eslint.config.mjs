import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['src/**/*.ts', 'tests/**/*.ts'];

export default [
  {
    ignores: ['dist/**', 'release/**', 'coverage/**', 'node_modules/**'],
  },
  {
    ...eslint.configs.recommended,
    files: typescriptFiles,
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
];
