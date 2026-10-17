import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: 'esm',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  fixedExtension: false,
})
