import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  resolve: {
    // 컴포넌트 체인(@/... 임포트)을 테스트에서 로드하기 위한 Next 스타일 별칭
    alias: { '@': root },
  },
  // .js 안의 JSX(칩 Popup 등)를 파싱 — md 코덱/스키마 스윕 테스트가
  // 에디터 확장 체인을 임포트하면서 필요해졌다
  esbuild: { loader: 'jsx', include: /\.[jt]sx?$/, exclude: [] },
  test: {
    environment: 'node',
    include: ['library/**/*.test.js'],
    environmentOptions: {
      // 칩 직렬화 origin 결정적 고정 — markdown_codec_cases.json의 내부 URL과 일치해야 함
      jsdom: { url: 'https://weave.test/' },
    },
  },
});
