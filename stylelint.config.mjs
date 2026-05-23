/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['**/dist/**', '**/node_modules/**', '.claude/**'],
  rules: {
    // Class names are CSS Module identifiers referenced from JS (camelCase),
    // so the default kebab-case selector pattern doesn't apply.
    'selector-class-pattern': null,
    // Preserve conventionally camelCase identifiers (a font name and a
    // text-rendering keyword) instead of lowercasing them.
    'value-keyword-case': ['lower', { ignoreKeywords: ['BlinkMacSystemFont', 'optimizeLegibility'] }],
  },
};
