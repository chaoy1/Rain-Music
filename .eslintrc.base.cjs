const baseRule = {
  'no-new': 'off',
  camelcase: 'off',
  'no-return-assign': 'off',
  'space-before-function-paren': ['error', 'never'],
  'no-var': 'error',
  'no-fallthrough': 'off',
  eqeqeq: 'off',
  'require-atomic-updates': ['error', { allowProperties: true }],
  'no-multiple-empty-lines': [1, { max: 2 }],
  'comma-dangle': [2, 'always-multiline'],
  'standard/no-callback-literal': 'off',
  'prefer-const': 'off',
  'no-labels': 'off',
  'node/no-callback-literal': 'off',
  'multiline-ternary': 'off',
}
const typescriptRule = {
  ...baseRule,
  '@typescript-eslint/strict-boolean-expressions': 'off',
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/space-before-function-paren': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/restrict-template-expressions': [1, {
    allowBoolean: true,
    allowAny: true,
  }],
  '@typescript-eslint/restrict-plus-operands': [1, {
    allowBoolean: true,
    allowAny: true,
  }],
  '@typescript-eslint/no-misused-promises': [
    'error',
    {
      checksVoidReturn: {
        arguments: false,
        attributes: false,
      },
    },
  ],
  // `void somePromise()` 是 typescript-eslint 官方认可的"显式表示故意丢弃"写法
  // （`no-floating-promises` 的文档里就推荐它）。Android 移植（阶段 3 / 线 E-2）里
  // `src/renderer/event/index.ts` 的 `subscribe()` 需要这种写法：那条降级路径内部
  // 已经 `.catch` 过，返回的 Promise 故意不接。默认配置会把它判成
  // `no-confusing-void-expression`，与本条规则自相矛盾，所以打开这个开关。
  '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreVoidOperator: true }],
  '@typescript-eslint/naming-convention': 'off',
  '@typescript-eslint/return-await': 'off',
  '@typescript-eslint/ban-ts-comment': 'off',
  '@typescript-eslint/comma-dangle': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
}
const vueRule = {
  ...typescriptRule,
  'vue/multi-word-component-names': 'off',
  'vue/max-attributes-per-line': 'off',
  'vue/singleline-html-element-content-newline': 'off',
  'vue/use-v-on-exact': 'off',
}

exports.base = {
  extends: ['standard'],
  rules: baseRule,
}

exports.html = {
  files: ['*.html'],
  plugins: ['html'],
}

exports.typescript = {
  files: ['*.ts'],
  rules: typescriptRule,
  parser: '@typescript-eslint/parser',
  extends: [
    'standard-with-typescript',
  ],
}

exports.vue = {
  files: ['*.vue'],
  rules: vueRule,
  parser: 'vue-eslint-parser',
  extends: [
    // 'plugin:vue/vue3-essential',
    'plugin:vue/base',
    'plugin:vue/vue3-recommended',
    'plugin:vue-pug/vue3-recommended',
    // "plugin:vue/strongly-recommended"
    'standard-with-typescript',
  ],
  parserOptions: {
    sourceType: 'module',
    parser: {
      // Script parser for `<script>`
      js: '@typescript-eslint/parser',

      // Script parser for `<script lang="ts">`
      ts: '@typescript-eslint/parser',
    },
    extraFileExtensions: ['.vue'],
  },
}
