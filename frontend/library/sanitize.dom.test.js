// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeSvg } from './sanitize.js';

describe('sanitizeSvg — 순수 SVG 구조 보존 (Typst 렌더가 깨지지 않음)', () => {
  it('svg/g/rect/path/text/use/defs 등 벡터 요소를 보존', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs>'
      + '<symbol id="g1"><path d="M0 0L10 10"></path></symbol></defs><g>'
      + '<rect x="0" y="0" width="10" height="10"></rect>'
      + '<use href="#g1"></use>'
      + '<use xlink:href="#g1"></use>'
      + '<text>hi</text>'
      + '</g></svg>';
    const out = sanitizeSvg(svg);
    expect(out).toContain('<svg');
    expect(out).toContain('<rect');
    expect(out).toContain('<path');
    expect(out).toContain('<text');
    expect(out).toContain('<use');
    expect(out).toContain('#g1');     // href 내부 참조 보존
    expect(out).toContain('xlink');   // typst.ts 버전에 따라 쓰는 xlink:href 변형도 보존
    expect(out).toContain('hi');
  });
});

describe('sanitizeSvg — XSS 벡터 제거', () => {
  it('script 태그 제거', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect></rect></svg>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<rect');
  });

  it('onload/onclick 등 이벤트 핸들러 제거', () => {
    const out = sanitizeSvg('<svg onload="alert(1)"><rect onclick="evil()"></rect></svg>');
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toContain('alert(1)');
  });

  it('javascript: href 제거', () => {
    const out = sanitizeSvg('<svg><a href="javascript:alert(1)"><rect></rect></a></svg>');
    expect(out).not.toContain('javascript:');
  });

  it('빈/널 입력은 그대로 반환', () => {
    expect(sanitizeSvg('')).toBe('');
    expect(sanitizeSvg(null)).toBe(null);
  });

  // 알려진 잔여(의도적): DOMPurify IS_ALLOWED_URI가 http/https를 허용하므로 외부 href는
  // 남는다. Typst WASM은 내부 #참조만 생성하므로 실제 경로엔 영향 없음 — 이 동작을 명시해
  // 미래에 통과하는 테스트를 잘못 "수정"하지 않도록 문서화한다.
  it('외부 use href는 살아남음(알려진 잔여)', () => {
    const out = sanitizeSvg('<svg><use href="http://external/file.svg#g1"></use></svg>');
    expect(out).toContain('<use');
  });

  it('외부 image href는 살아남음(알려진 잔여)', () => {
    const out = sanitizeSvg('<svg><image href="http://tracker.example/px.gif"></image></svg>');
    expect(out).toContain('<image');
  });
});

describe('sanitizeHtml — 회귀(기존 동작 유지)', () => {
  it('일반 태그 보존, script 제거', () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('<script');
  });
});
