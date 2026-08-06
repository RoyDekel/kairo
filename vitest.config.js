import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.js',
      exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**', '**/tests-examples/**'],
      testTimeout: 25000,
    },
  })
);
