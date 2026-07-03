// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// MathJax 번들은 jsdom에서 로드하지 않는다 — window.MathJax 목으로 폴백 경로만 검증
vi.mock('mathjax/es5/tex-svg-full.js', () => {
  // 실제 번들처럼 import 직전 window.MathJax를 설정으로 읽는다 — 캡처해서 config 회귀 검증
  globalThis.__mathjaxConfigAtImport = { ...globalThis.window.MathJax };
  const svg = () => {
    const el = document.createElement('mjx-container');
    el.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    return el;
  };
  globalThis.window.MathJax = {
    startup: { promise: Promise.resolve(), typeset: false },
    tex2svgPromise: vi.fn(async () => svg()),
  };
  return {};
});

import { renderMathElement, renderMathIn, clearMathElement, MATHJAX_CONFIG } from './mathRender';

beforeEach(() => { document.body.innerHTML = ''; });

// 기존 window.MathJax(사용자 macros 등)가 있어도 보안 키가 이기는지 검증 —
// 첫 폴백(=모듈 import)보다 먼저 심어둔다
beforeAll(() => {
  window.MathJax = { tex: { macros: { RR: '\\mathbb{R}' } } };
});

describe('renderMathElement', () => {
  it('KaTeX가 그릴 수 있는 수식은 KaTeX로 렌더', async () => {
    const el = document.createElement('span');
    await renderMathElement(el, 'E=mc^2', { displayMode: false });
    expect(el.querySelector('.katex')).toBeTruthy();
    expect(el.querySelector('mjx-container')).toBeFalsy();
  });

  it('KaTeX 미지원 문법은 MathJax로 폴백 (출력 SVG는 sanitizeSvg 통과)', async () => {
    const el = document.createElement('div');
    // multline은 amsmath 환경이지만 KaTeX는 구현하지 않아 ParseError
    // (\begin{CD}는 KaTeX 0.16.35부터 네이티브 지원이라 폴백 트리거로 쓸 수 없어 대체)
    await renderMathElement(el, '\\begin{multline} A \\\\ B \\end{multline}', { displayMode: true });
    expect(el.querySelector('svg')).toBeTruthy();
    // mjx-container 래퍼는 버리고 정화된 svg만 삽입된다
    expect(el.querySelector('mjx-container')).toBeFalsy();
  });

  it('MathJax도 실패하면 KaTeX 에러 표시로 저하', async () => {
    window.MathJax.tex2svgPromise.mockImplementationOnce(async () => { throw new Error('boom'); });
    const el = document.createElement('div');
    await renderMathElement(el, '\\begin{multline} A \\end{multline}', { displayMode: true });
    expect(el.querySelector('.katex-error')).toBeTruthy();
  });

  it('경합 시 이전 비동기 폴백이 최신 렌더를 덮어쓰지 않음 (stale 방어)', async () => {
    const el = document.createElement('div');
    // 첫 렌더는 MathJax 폴백(비동기), 완료 전에 같은 엘리먼트에 KaTeX 렌더(동기)가 끼어든다
    const stale = renderMathElement(el, '\\begin{multline} A \\\\ B \\end{multline}', { displayMode: true });
    await renderMathElement(el, 'x^2', { displayMode: true });
    await stale;
    expect(el.querySelector('.katex')).toBeTruthy();
    expect(el.querySelector('svg')).toBeFalsy(); // 밀린 MathJax 출력이 덮어쓰지 않았다
  });

  it('clearMathElement가 진행 중인 폴백 렌더를 무효화 (빈 미리보기 stale 방어)', async () => {
    const el = document.createElement('div');
    const stale = renderMathElement(el, '\\begin{multline} A \\\\ B \\end{multline}', { displayMode: true });
    clearMathElement(el); // 값이 비워진 미리보기 — 토큰 갱신으로 pending 렌더 폐기
    await stale;
    expect(el.innerHTML).toBe('');
  });
});

describe('MathJax 보안 방어', () => {
  it('기존 window.MathJax(tex.macros)가 있어도 보안 키(packages)가 마지막에 고정됨', async () => {
    const el = document.createElement('div');
    await renderMathElement(el, '\\begin{multline} A \\\\ B \\end{multline}', { displayMode: true }); // 폴백 유도 → 모듈 import
    const cfg = globalThis.__mathjaxConfigAtImport;
    expect(cfg?.tex?.packages).toEqual(MATHJAX_CONFIG.tex.packages);
    expect(cfg?.tex?.macros).toEqual({ RR: '\\mathbb{R}' }); // 기존 설정은 보존 (shallow merge 회귀 방지)
  });

  it('폴백 SVG의 javascript: href는 sanitizeSvg가 제거 (2차 방어)', async () => {
    window.MathJax.tex2svgPromise.mockImplementationOnce(async () => {
      const wrap = document.createElement('mjx-container');
      wrap.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>x</text></a></svg>';
      return wrap;
    });
    const el = document.createElement('div');
    await renderMathElement(el, '\\begin{multline} A \\end{multline}', { displayMode: true });
    expect(el.innerHTML).not.toContain('javascript:');
  });
});

describe('renderMathIn', () => {
  it('data-type 수식 노드를 찾아 렌더하고, 렌더된 노드는 건너뜀', async () => {
    document.body.innerHTML =
      '<div id="r"><span data-type="inline-math" data-latex="x^2"></span>' +
      '<div data-type="block-math" data-latex="\\int_a^b f"></div>' +
      '<span data-type="inline-math"></span></div>'; // data-latex 없음 → 무시
    renderMathIn(document.getElementById('r'));
    await new Promise((r) => setTimeout(r, 0));
    const nodes = document.querySelectorAll('.katex');
    expect(nodes.length).toBe(2);
    // 재호출해도 중복 렌더 없음
    renderMathIn(document.getElementById('r'));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelectorAll('.katex').length).toBe(2);
  });
});
