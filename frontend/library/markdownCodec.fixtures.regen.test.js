// @vitest-environment jsdom
// golden 픽스처 재생성 도구 — 평소엔 skip. @tiptap/markdown 버전업 등으로 마크업이 바뀌면:
//   cd frontend && REGEN_MD_FIXTURES=1 npx vitest run library/markdownCodec.fixtures.regen.test.js
// 컨테이너에선 fixtures가 ro 마운트라 반드시 호스트에서 실행. 실행 후 git diff를
// 눈으로 검수하고 커밋한다 — 이 파일이 곧 회귀 스냅샷이다.
// markdown도 직렬화 dialect로 정규화(1회 왕복)해 roundtrip이 바이트 단위로 안정되게 한다.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { htmlToMarkdown, markdownToEditorHtml } from './markdownCodec';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';

const FIXTURE = resolve(__dirname, '../../backend/tests/fixtures/markdown_codec_cases.json');
const EXTS = buildCanvasEditorExtensions({});

describe.runIf(process.env.REGEN_MD_FIXTURES)('markdown 픽스처 재생성', () => {
  it('markdown 정규화 + html_tiptap 재생성', () => {
    const cases = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    for (const c of cases) {
      if (c.regen === false) continue; // html_tiptap 손입력(입력 전용) 케이스
      let md = c.markdown;
      let html = markdownToEditorHtml(md, EXTS);
      const canonical = htmlToMarkdown(html, EXTS);
      if (canonical !== md) {
        md = canonical;
        html = markdownToEditorHtml(md, EXTS);
      }
      expect(htmlToMarkdown(html, EXTS)).toBe(md); // 정착 확인(1회 내 수렴)
      c.markdown = md;
      c.html_tiptap = html;
    }
    writeFileSync(FIXTURE, `${JSON.stringify(cases, null, 2)}\n`);
  });
});
