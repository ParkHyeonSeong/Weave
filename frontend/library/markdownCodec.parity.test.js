// @vitest-environment jsdom
// golden 픽스처 패리티 (JS 측) — 같은 파일을 S2에서 pytest(Python 변환기)가 소비한다.
// html_ingress가 null인 케이스는 Python 측이 스킵한다(칩 등 origin 의존 케이스는 영구 null).
// jsdom origin은 vitest.config.mjs에서 https://weave.test로 고정 — 칩 절대 URL과 일치.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { htmlToMarkdown, markdownToEditorHtml } from './markdownCodec';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';

const cases = JSON.parse(readFileSync(resolve(__dirname, '../../backend/tests/fixtures/markdown_codec_cases.json'), 'utf8'));
const EXTS = buildCanvasEditorExtensions({}); // 커스텀 노드 최대 포함 표면(module-level: 매니저 캐시 활용)

// WEAVE-37 dialect/폴백 계약을 지키는 필수 ingress case — fail-closed manifest.
// 이 case들은 삭제·이름변경·directions에서 md->html 제거·html_ingress null화가 즉시 RED여야 한다.
// (없으면 Python INGRESS parity가 html_ingress falsy를 skip해 계약이 조용히 사라진다 — 17차 P1.)
const REQUIRED_INGRESS_CASES = [
  'empty-label-link-fallback',
  'bare-url-not-autolinked',
  'paren-url-not-autolinked',
  'bare-email-not-autolinked',
];

describe('markdown codec parity (JS)', () => {
  it('케이스 15개 이상', () => expect(cases.length).toBeGreaterThanOrEqual(15));

  // fail-closed: '15개 이상'만으론 필수 case 삭제를 못 잡는다(다른 case가 채워 통과) — 이름·방향·
  // html_ingress 실값을 case별로 강제한다.
  describe('필수 ingress fixture 계약 (fail-closed)', () => {
    it.each(REQUIRED_INGRESS_CASES)('%s: 존재 + md->html + 비어있지 않은 html_ingress', (name) => {
      const c = cases.find((x) => x.name === name);
      expect(c, `필수 case "${name}"가 없다(삭제/이름변경?)`).toBeTruthy();
      expect(c.directions, `"${name}" directions에 md->html이 없다(축소/오탈자?)`).toContain('md->html');
      expect(
        typeof c.html_ingress === 'string' && c.html_ingress.length > 0,
        `"${name}" html_ingress가 null/빈값 — Python INGRESS parity가 skip해 가짜 green이 된다`,
      ).toBe(true);
    });
  });
  for (const c of cases) {
    describe(c.name, () => {
      if (c.directions.includes('html->md')) {
        it('html_tiptap → markdown', () => {
          expect(htmlToMarkdown(c.html_tiptap, EXTS)).toBe(c.markdown);
        });
      }
      if (c.directions.includes('md->html')) {
        it('markdown → html_tiptap', () => {
          expect(markdownToEditorHtml(c.markdown, EXTS)).toBe(c.html_tiptap);
        });
      }
      if (c.directions.includes('roundtrip')) {
        it('markdown 왕복 보존', () => {
          expect(htmlToMarkdown(markdownToEditorHtml(c.markdown, EXTS), EXTS)).toBe(c.markdown);
        });
      }
    });
  }
});
