import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';

/**
 * 前端 ESLint 扁平配置（ESLint 9 + Vue 3 SFC）。
 *
 * 为什么只用 `flat/essential` 而不是 `flat/recommended`：
 * recommended 里含大量排版类规则（属性换行、缩进、自闭合标签），
 * 会与本项目刻意保持的紧凑模板写法冲突，产出几百条纯噪音告警；
 * 而真正想拦住的（v-if/v-for 冲突、模板引用了未定义的变量、误用 console）都在 essential 里。
 * 排版统一交给 Prettier（见根目录 .prettierrc.json）。
 *
 * `no-undef` 关闭：所有 <script> 都是 lang="ts"，未定义标识符由 vue-tsc 判断，
 * 再让 ESLint 用运行时全局表校验既重复又容易误报（如 window/localStorage）。
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
  },
  {
    files: ['**/*.{ts,vue}'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // 组件名（views/*/index.vue）天然单词，不强制多单词
      'vue/multi-word-component-names': 'off',
      // 保留 debug 类输出，但禁止 console.log
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  }
);
