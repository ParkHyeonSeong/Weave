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

describe('markdown codec parity (JS)', () => {
  it('케이스 15개 이상', () => expect(cases.length).toBeGreaterThanOrEqual(15));
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
