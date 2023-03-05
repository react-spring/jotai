import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^jotai$/, replacement: './src/index.ts' },
      { find: /^jotai(.*)$/, replacement: './src/$1.ts' },
    ],
  },
  test: {
    name: 'jotai',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    dir: 'tests',
    reporters: 'basic',
    coverage: {
      reporter: ['text', 'json', 'html', 'text-summary'],
      reportsDirectory: './coverage/',
    },
  },
})
