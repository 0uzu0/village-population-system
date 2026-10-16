import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ESLint 扁平配置（ESLint 9）。
 *
 * 取舍说明：
 *  - 不开类型感知（typed linting）：需要 parserOptions.project，全量检查会明显变慢，
 *    而本项目最想守住的几条（未使用变量、误用 console、== 比较）都不需要类型信息。
 *  - `no-explicit-any` 关闭：SQL 是手写的，查询结果行结构随 SELECT 变化，
 *    这里 any 是刻意选择；真正的类型约束交给 zod 与手写 DTO。
 *  - `no-console` 设为 error：日志统一走 src/utils/logger.ts（结构化 JSON + stdout/stderr 分流），
 *    一旦有人再写 console.log，CI 会直接拦下。
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      // 运维/工具脚本：面向开发者输出，允许 console
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
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
      'no-console': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 代码里出现的全角空格（U+3000）都是刻意的：Excel 表头归一化
      // 用的 /[\s\u3000]/g 正则本身就要匹配它，不是误敲
      'no-irregular-whitespace': ['error', { skipStrings: true, skipRegExps: true }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  }
);
