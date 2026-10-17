import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['@openimport/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@openimport/source'],
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/{core,csv,xlsx,json,xml,ai,worker}/test/**/*.test.ts', 'examples/*/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          include: ['packages/{react,ui}/test/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
        },
      },
    ],
  },
})
