import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // A leading underscore is this codebase's existing marker for "parameter
      // kept for signature/positional reasons, deliberately unused" — see
      // `_layoutMode` in utils/imageProcessing.ts and the several added while
      // making `tsc -b` pass. TypeScript already honours that convention via
      // `noUnusedParameters`; without this option eslint reported the very
      // parameters tsc was satisfied with, so the two tools disagreed about
      // the same code.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
])
