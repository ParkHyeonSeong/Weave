import { defineConfig } from 'vitest/config';

// 순수 로직(아바타 헬퍼)만 테스트. jsdom 미사용 — node 환경.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['library/**/*.test.js'],
  },
});
