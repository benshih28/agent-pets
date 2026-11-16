// ESLint 9 flat config。只抓真正的缺陷與專案慣例，不開任何 stylistic 規則（不引入 Prettier）。
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import { nodeTestClosure } from './scripts/node-test-closure.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const vueFiles = ['src/**/*.vue']
const tsFiles = ['src/**/*.ts', 'electron/**/*.ts', 'tests/**/*.mts', 'vite.config.mts']

// tests/*.test.mts 直接以 Node 執行，閉包內的值 import 只能用相對路徑。
const nodeClosure = nodeTestClosure(root).filter(file => file.endsWith('.ts'))

export default tseslint.config(
  { ignores: ['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**', 'tests/fixtures/**', 'docs/plugins/examples/**', 'public/**', '.claude/**', '.playwright-mcp/**'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],

  {
    files: [...vueFiles, ...tsFiles],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
  },
  {
    files: vueFiles,
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
      globals: globals.browser,
    },
  },
  { files: ['src/**/*.ts'], languageOptions: { globals: globals.browser } },
  { files: ['electron/**/*.ts', 'tests/**/*.mts', 'vite.config.mts'], languageOptions: { globals: globals.node } },
  { files: ['*.mjs', 'scripts/**/*.mjs', 'integrations/**/*.mjs'], languageOptions: { globals: globals.node } },

  {
    rules: {
      // 底線開頭代表刻意忽略（解構剔除欄位、必要的簽名參數）。
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // 空 catch 是專案既有的「盡力而為」寫法；只要求有註解或內容的區塊以外不管。
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 這些字元類別就是要比對控制字元（清除終端機跳脫序列、拒絕控制字元的輸入驗證）。
      'no-control-regex': 'off',
      // `components/ui/*` 的單字元件名（Button、Card…）是專案刻意的 UI 基礎元件命名。
      'vue/multi-word-component-names': 'off',
      // `<Transition>` 以 key 切換子節點（v-else-if 在 Transition 本身），不是子節點上的 v-if/v-show。
      'vue/require-toggle-inside-transition': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      // `as never` 能塞進任何型別，和 `any` 一樣跳過檢查；`const _x: never = value` 這類窮盡性檢查是型別註記，不受影響。
      'no-restricted-syntax': ['error',
        { selector: 'TSAsExpression > TSNeverKeyword.typeAnnotation', message: '不要用 `as never` 跳過型別檢查：測試假物件用 tests/support 的 helper，刻意的非法輸入用 `invalid<T>()`。' },
        { selector: 'TSTypeAssertion > TSNeverKeyword.typeAnnotation', message: '不要用 `<never>` 跳過型別檢查。' },
      ],
    },
  },

  // src 內的跨目錄 import 一律 `@/`（conventions §1）：禁止 `./`、`../`，CSS 的 side-effect import 同樣適用。
  {
    files: ['src/**/*.ts', 'src/**/*.vue'],
    ignores: nodeClosure,
    rules: {
      'no-restricted-imports': ['error', {
        // `../../electron/*` 是 src 之外的檔案，沒有 `@/` 可用。
        patterns: [{ group: ['./*', '../*', '.', '!../**/electron/*'], message: 'src 內的 import 一律使用 `@/`（conventions §1）。' }],
      }],
    },
  },
  // Node 測試閉包：沒有 bundler，值 import 只能用相對路徑；`@/` 只允許出現在 import type。
  {
    files: nodeClosure,
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['@/*'],
          allowTypeImports: true,
          message: '此檔案會被 tests/*.test.mts 以 Node 直接載入，執行期 import 必須用相對路徑（`@/` 只能用在 import type）。',
        }],
      }],
    },
  },

  // `*.vue` 模組宣告檔是 Vue 官方範本寫法（`{}`／`any`）。
  {
    files: ['src/env.d.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },

  // 主程序：未處理的 Promise 會直接變成 unhandledRejection，取代 lint-main-process.mjs 的 loadURL 檢查。
  {
    files: ['electron/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
)
