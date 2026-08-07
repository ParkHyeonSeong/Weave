import { describe, it, expect } from 'vitest';
import { ensureHtml, ensureRenderableHtml } from './ensureHtml';

describe('ensureHtml (기존 동작 유지)', () => {
  it('HTML은 그대로', () => {
    expect(ensureHtml('<p>x</p>')).toBe('<p>x</p>');
  });
  it('plain text 줄→<p> 래핑', () => {
    expect(ensureHtml('a\nb')).toBe('<p>a</p><p>b</p>');
  });
});

describe('ensureRenderableHtml (md 폴백 승격)', () => {
  it('HTML은 그대로 통과', () => {
    expect(ensureRenderableHtml('<p>hi <strong>b</strong></p>')).toBe('<p>hi <strong>b</strong></p>');
  });
  it('markdown이면 HTML로 렌더 (뭉개진 MCP 데이터 구제)', () => {
    const html = ensureRenderableHtml('# 제목\n\n- 항목1\n- 항목2');
    expect(html).toContain('<h1>제목</h1>');
    expect(html).toContain('<li>항목1</li>');
  });
  it('수식 md → data-latex 마크업 (useMathHydration이 이어받음)', () => {
    expect(ensureRenderableHtml('$$\nE=mc^2\n$$')).toContain('data-type="block-math"');
  });
  it('md 문법 없는 plain text는 기존 <p> 래핑 폴백', () => {
    expect(ensureRenderableHtml('그냥 한 줄\n둘째 줄')).toBe('<p>그냥 한 줄</p><p>둘째 줄</p>');
  });
  it('빈 값은 그대로', () => {
    expect(ensureRenderableHtml('')).toBe('');
    expect(ensureRenderableHtml(null)).toBe(null);
  });
  it('[](url) 빈 라벨 링크는 URL 라벨로 폴백 렌더된다 (WEAVE-37 무음 소실 방지)', () => {
    expect(ensureRenderableHtml('[](https://example.com)'))
      .toContain('<a href="https://example.com">https://example.com</a>');
  });
});
