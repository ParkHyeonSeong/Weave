import { describe, it, expect } from 'vitest';
import { markdownToHtml, hasMathBlock, hasInlineMath, looksLikeMarkdown, hasEmptyLabelLink } from './markdownMath';

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
  it('빈 라벨 링크 [](url)은 단독으로 true (무음 소실 방지)', () =>
    expect(looksLikeMarkdown('[](https://example.com)', { math: false })).toBe(true));
  it('일반 링크 [t](url)은 단독 신호가 아님 (D3 범위 불변)', () =>
    expect(looksLikeMarkdown('[문구](https://example.com)', { math: false })).toBe(false));
});

describe('hasEmptyLabelLink (lexer 기반 — 5·6차 케이스)', () => {
  it('실제 빈 link 토큰만 감지한다', () => {
    expect(hasEmptyLabelLink('[](https://example.com)')).toBe(true);
    expect(hasEmptyLabelLink('[](https://example.com "title")')).toBe(true);   // title 있는 유효 빈 링크
    expect(hasEmptyLabelLink('| [](https://x.com) |\n|---|\n| c |')).toBe(true); // table 셀(6차)
    expect(hasEmptyLabelLink('[][r]\n\n[r]: https://x.com')).toBe(true);        // ref-style 빈 링크(6차)
    expect(hasEmptyLabelLink('- [ ] [](https://x.com)')).toBe(true);            // task-first 목록(9차)
    expect(hasEmptyLabelLink('- a\n- [](https://x.com)')).toBe(true);           // bullet-first 목록(9차)
    expect(hasEmptyLabelLink('[문구](https://example.com)')).toBe(false);       // 일반 링크 — D3 범위 불변
    expect(hasEmptyLabelLink('[o [](https://in.test)](https://out.test)')).toBe(false); // 중첩(최상위 아님·6차)
    expect(hasEmptyLabelLink('![](https://example.com/i.png)')).toBe(false);    // 이미지
    expect(hasEmptyLabelLink('`[](https://example.com)`')).toBe(false);         // 코드스팬 속
    expect(hasEmptyLabelLink('\\[](https://example.com)')).toBe(false);         // 이스케이프
  });
});

describe('markdownToHtml direct 경로 — dialect·빈 라벨 폴백 (17차 P1)', () => {
  it('[](url)/bare URL이 direct marked 경로에서 폴백·de-link된다 (pure/heading/빈쌍/table/nested/list)', () => {
    expect(markdownToHtml('[](https://example.com)')).toContain('>https://example.com</a>'); // pure
    expect(markdownToHtml('# H\n\n[](https://example.com)')).toContain('>https://example.com</a>');
    expect(markdownToHtml('앞 [](https://example.com) 뒤')).toContain('>https://example.com</a>'); // inline
    expect(markdownToHtml('a []() b')).not.toContain('<a');                    // 빈쌍 → <a> 없음
    expect(markdownToHtml('| [](https://x.com) |\n|---|\n| c |')).toContain('>https://x.com</a>'); // table 셀
    // ⚠️ `<a` 부재만 보면 **URL 자체를 통째로 삭제**하는 오구현도 통과한다(17차 P1).
    //    bare URL: 텍스트가 URL 그대로 남고 링크만 없어야 한다.
    const task = markdownToHtml('- [ ] https://x.com');
    expect(task).not.toContain('<a');
    expect(task).toContain('https://x.com');                                   // URL 텍스트 보존
    // 빈 라벨: 텍스트가 URL이면서 **링크 href가 정확**해야 한다(리터럴 강등 오구현 배제)
    expect(markdownToHtml('- [ ] [](https://x.com)')).toContain('<a href="https://x.com">https://x.com</a>');
    expect(markdownToHtml('- a\n- [](https://x.com)')).toContain('<a href="https://x.com">https://x.com</a>');
    const nested = markdownToHtml('[o [](https://in.test)](https://out.test)'); // 중첩: outer만
    expect((nested.match(/<a /g) || []).length).toBe(1);
  });

  it('수식 혼합 문서에서도 빈 라벨 폴백이 동작한다 (mathMarked 경로)', () => {
    const html = markdownToHtml('$$x^2$$\n\n[](https://example.com)', { math: true });
    expect(html).toContain('data-type="block-math"');
    expect(html).toContain('>https://example.com</a>');
  });
});
