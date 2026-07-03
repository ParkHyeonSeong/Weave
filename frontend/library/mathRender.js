import { useEffect } from 'react';
import katex from 'katex';
import { sanitizeSvg } from './sanitize';

// MathJax 설정 (통합 테스트가 같은 값을 검증하므로 export — JSON 직렬화 가능해야 함).
//
// 번들은 tex-svg-full(전 TeX 패키지 사전 로드)를 쓴다 — jsdom+실번들 실증 결과:
//  - 기본 tex-svg 번들은 amscd 등 확장을 autoload(동적 로드)하는데, 번들 환경에선
//    로드가 실패해 \begin{CD}가 "Unknown environment 'CD'" 에러로 렌더됨.
//    MathJax 폴백의 존재 이유가 KaTeX 미지원 확장 커버리지이므로 full이 맞다
//    (~2.2MB지만 KaTeX 실패 시에만 lazy 로드).
//  - full 번들엔 autoload 옵션 블록이 없어 tex.autoload 설정 객체는 invalid 경고를
//    내므로 쓰지 않는다 (패키지 목록에서 'autoload'를 빼는 것은 별개 — 아래).
//
// tex.packages에서 html·require·autoload 제외 (보안 1차 방어, sanitizeSvg가 2차 —
// MathJax 공식 보안 가이드도 combined component에서 require·autoload 제거를 권고):
//  - html: \href 등 URL 생성 매크로 차단 (sanitizeSvg는 Typst 사정상 외부 http(s)
//    href를 의도적으로 허용하므로 여기가 1차 방어).
//  - require 필수: 실증 결과 html만 빼면 \require{html}이 html 패키지를 문서 전역에
//    재로드해서 이후의 일반 \href까지 뚫린다.
//  - autoload: full 번들에선 로드 대상이 없어 no-op이지만, 누군가 번들을 non-full로
//    되돌리면 autoload가 \href에서 html을 자동 로드하는 경로가 살아난다 — 목록에서
//    미리 제외해 봉쇄 (실증: 제외해도 경고 없음, \href·\require 차단, CD·일반 수식 정상).
export const MATHJAX_CONFIG = {
  startup: { typeset: false },
  tex: {
    packages: { '[-]': ['html', 'require', 'autoload'] },
  },
};

// MathJax lazy 싱글톤 — mermaidConfig.js의 getMermaid() 패턴.
// KaTeX가 못 그리는 수식에서만 로드되므로 초기 번들 영향 없음.
let mathjaxPromise = null;
async function getMathJax() {
  if (typeof window === 'undefined') return null;
  if (mathjaxPromise) return mathjaxPromise;
  mathjaxPromise = (async () => {
    // es5 번들은 import 시점의 window.MathJax를 설정으로 읽는다 — import 전에 지정.
    // 기존 window.MathJax가 있어도(사용자 macros 등) 보안 방어 키(packages['[-]'])는
    // 반드시 마지막에 고정한다 — shallow merge로 tex가 통째로 덮이면 \href 차단이
    // 무력화된다.
    const existing = window.MathJax || {};
    window.MathJax = {
      ...existing,
      startup: { ...existing.startup, ...MATHJAX_CONFIG.startup },
      tex: {
        ...existing.tex,
        packages: { ...existing.tex?.packages, ...MATHJAX_CONFIG.tex.packages },
      },
    };
    await import('mathjax/es5/tex-svg-full.js');
    await window.MathJax.startup.promise;
    return window.MathJax;
  })();
  return mathjaxPromise;
}

/**
 * 수식 하이브리드 렌더: KaTeX 우선(빠름·동기), ParseError 시 MathJax(SVG) 폴백,
 * 둘 다 실패하면 KaTeX 에러 표시(빨간 원문)로 저하. 원문을 조용히 지우지 않는다.
 */
let renderSeq = 0;

export async function renderMathElement(el, latex, { displayMode = false } = {}) {
  // stale 방어 토큰: MathJax 폴백은 비동기라, await 사이에 같은 엘리먼트에 새 렌더가
  // 시작되면(AI 스트리밍 중 latex 갱신 등) 이전 Promise가 최신 출력을 덮어쓸 수 있다.
  // 엘리먼트에 시퀀스를 찍어두고 쓰기 직전에 비교, 밀린 렌더는 버린다.
  // (el.isConnected 검사는 안 씀 — detached 엘리먼트 렌더(테스트·프리렌더)가 유효한
  // 사용이고, 정합성은 토큰만으로 보장된다)
  const token = String(++renderSeq);
  el.dataset.mathToken = token;
  try {
    katex.render(latex, el, { throwOnError: true, displayMode });
    return;
  } catch {
    // KaTeX 미지원 문법 → MathJax 폴백
  }
  try {
    const MathJax = await getMathJax();
    if (el.dataset.mathToken !== token) return; // 밀린 렌더 폐기
    // 동기 tex2svg()는 내부 동적 로드가 필요한 순간 "MathJax retry" 에러를 던진다
    // (실증: tex-svg 번들의 \begin{CD}) — retry 경로를 처리하는 tex2svgPromise만 쓴다
    const container = await MathJax.tex2svgPromise(latex, { display: displayMode });
    if (el.dataset.mathToken !== token) return; // await 하나 지날 때마다 재확인
    // TeX 입력은 사용자 데이터 — \href{javascript:...} 같은 URL 벡터가 SVG로 나올 수
    // 있으므로 Typst와 동일하게 sanitizeSvg를 거친다 (mjx-container 래퍼는 버림)
    const svg = container.querySelector('svg');
    const clean = svg ? sanitizeSvg(svg.outerHTML) : '';
    if (!clean) throw new Error('empty MathJax output');
    el.innerHTML = clean;
  } catch {
    if (el.dataset.mathToken !== token) return;
    katex.render(latex, el, { throwOnError: false, displayMode });
  }
}

// 수식 엘리먼트 비우기 — 토큰을 새로 찍어 진행 중인 비동기 폴백 렌더를 무효화한다.
// (textContent = ''만 하면 pending MathJax SVG가 늦게 도착해 빈 엘리먼트를 다시 덮는다)
export function clearMathElement(el) {
  el.dataset.mathToken = String(++renderSeq);
  el.replaceChildren();
}

// 읽기 모드 루트 안의 수식 노드 전부 렌더. 이미 렌더된 노드는 건너뜀.
export function renderMathIn(rootEl) {
  if (!rootEl) return;
  const nodes = rootEl.querySelectorAll('[data-type="block-math"], [data-type="inline-math"]');
  nodes.forEach((el) => {
    const latex = el.getAttribute('data-latex');
    if (!latex || el.querySelector('.katex, svg')) return;
    const isBlock = el.getAttribute('data-type') === 'block-math';
    renderMathElement(el, latex, { displayMode: isBlock });
  });
}

// readonly 표면용 훅 — useRefHydration과 동일하게 deps는 고정 길이 배열.
export function useMathHydration(ref, deps, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    renderMathIn(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}
