import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default environment for non-DOM tests
    environment: 'node',
    environmentMatchGlobs: [
      // Use jsdom for DOM-related tests
      ['lib/__tests__/element-identification.test.ts', 'jsdom'],
      ['lib/__tests__/app.test.ts', 'jsdom'],
      ['lib/__tests__/generate-output.test.ts', 'jsdom'],
      ['lib/__tests__/freeze-animations.test.ts', 'jsdom'],
      ['lib/__tests__/react-detection.test.ts', 'jsdom'],
      ['ui/**/*.test.ts', 'jsdom'],
    ],
  },
});
