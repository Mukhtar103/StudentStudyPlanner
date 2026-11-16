import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';

export default [
  { ignores: ['**/dist/**'] },
  js.configs.recommended,
  { files: ['**/*.js', '**/*.jsx'], languageOptions: { globals: globals.node, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { react }, rules: { 'react/jsx-uses-vars': 'error' } },
  { files: ['client/**/*.{js,jsx}'], languageOptions: { globals: globals.browser } },
];
