/**
 * ESLint 配置（Vue3 + TypeScript）。
 */
module.exports = {
  root: true,
  env: { browser: true, es2021: true, webextensions: true, node: false },
  // .vue 文件必须用 vue-eslint-parser 解析模板，脚本部分再交给 @typescript-eslint/parser
  parser: 'vue-eslint-parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parser: '@typescript-eslint/parser'
  },
  plugins: ['@typescript-eslint', 'vue'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended'
  ],
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-explicit-any': 'warn'
  },
  ignorePatterns: ['dist/**', 'node_modules/**', 'src/vendor/**']
};
