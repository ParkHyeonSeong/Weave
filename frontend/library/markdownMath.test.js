import { describe, it, expect } from 'vitest';
import { markdownToHtml, hasMathBlock, hasInlineMath, looksLikeMarkdown } from './markdownMath';

describe('markdownToHtml math', () => {
  it('블록 수식 $$...$$ → block-math div', () => {
    const html = markdownToHtml('$$\nE=mc^2\n$$', { math: true });
    expect(html).toContain('<div data-type="block-math" data-latex="E=mc^2">');
  });
  it('한 줄 블록 수식 $$x$$ (단독 라인)', () => {
    expect(markdownToHtml('$$x^2$$', { math: true }))
      .toContain('data-type="block-math"');
  });
  it('인라인 수식 $...$ → inline-math span', () => {
    const html = markdownToHtml('넓이는 $\\pi r^2$ 이다', { math: true });
    expect(html).toContain('<span data-type="inline-math" data-latex="\\pi r^2">');
  });
  it('문단 중간 $$...$$도 인라인 수식으로', () => {
    const html = markdownToHtml('식 $$a+b$$ 참고', { math: true });
    expect(html).toContain('<span data-type="inline-math" data-latex="a+b">');
  });
  it('data-latex 속성 이스케이프', () => {
    const html = markdownToHtml('$x<y \\text{"q"}$', { math: true });
    expect(html).toContain('data-latex="x&lt;y \\text{&quot;q&quot;}"');
    expect(html).not.toContain('<y');
  });
  it('금액 표기는 수식이 아님', () => {
    const html = markdownToHtml('가격은 $5 and $10 입니다', { math: true });
    expect(html).not.toContain('data-type="inline-math"');
  });
  it('공백 인접 $는 수식이 아님', () => {
    expect(markdownToHtml('a $ b $ c', { math: true })).not.toContain('inline-math');
  });
  it('math:false면 수식 변환 없이 marked 기본 동작', () => {
    const html = markdownToHtml('# 제목\n\n$$x$$', { math: false });
    expect(html).toContain('<h1>제목</h1>');
    expect(html).not.toContain('data-type');
  });
  it('기존 마크다운(헤더·리스트·breaks) 동작 유지', () => {
    const html = markdownToHtml('# H\n- a\n- b\n\n줄1\n줄2', { math: true });
    expect(html).toContain('<h1>H</h1>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<br>'); // breaks: true
  });
});

describe('hasMathBlock', () => {
  it('$$ 시작 라인 감지', () => expect(hasMathBlock('$$\nx\n$$')).toBe(true));
  it('수식 없으면 false', () => expect(hasMathBlock('plain $5 text')).toBe(false));
});

describe('hasInlineMath', () => {
  it('인라인 수식 감지', () => expect(hasInlineMath('넓이는 $\\pi r^2$ 이다')).toBe(true));
  it('금액 표기는 미감지', () => expect(hasInlineMath('가격은 $5 and $10 입니다')).toBe(false));
  it('공백 인접 $는 미감지', () => expect(hasInlineMath('a $ b $ c')).toBe(false));
});

describe('looksLikeMarkdown', () => {
  it('인라인 수식만 있어도 math 활성 시 true (붙여넣기 진입 가드)', () =>
    expect(looksLikeMarkdown('넓이는 $\\pi r^2$ 이다', { math: true })).toBe(true));
  it('math 비활성이면 인라인 수식은 신호가 아님', () =>
    expect(looksLikeMarkdown('넓이는 $\\pi r^2$ 이다', { math: false })).toBe(false));
  it('헤더는 단독으로 true', () => expect(looksLikeMarkdown('# 제목', { math: false })).toBe(true));
  it('평문은 false', () => expect(looksLikeMarkdown('그냥 텍스트', { math: true })).toBe(false));
});
