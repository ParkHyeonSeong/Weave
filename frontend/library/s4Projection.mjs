// frontend/library/s4Projection.mjs
// **projector 경로의 단일 구현.** s4-gen(fixture 생성)과 s4-promote-capture(승격)가
// 둘 다 이것을 쓴다.
//
// 왜 별도 모듈인가: s4-gen.mjs는 top-level 부작용이 있는 실행 스크립트라 import하면
// 생성이 그대로 돌아간다. 그렇다고 승격 쪽에 projection을 다시 적으면 두 구현이 갈라지고,
// 그때 어느 쪽이 정본인지가 사라진다 — 그래서 순수 부분만 여기로 뺀다.
//
// 이 모듈은 판정을 새로 만들지 않는다. SCSS 컴파일과 테마 값 수집이라는 **IO 배선**만
// 담당하고, 실제 계약 판정은 전부 s4Evaluator의 기존 함수가 한다.
import * as EV from './s4Evaluator.mjs';

// 테마 값 맵(라이트/다크). :root는 첫 선언 우선, 다크 selector는 후행 우선 —
// s4-gen이 쓰던 규칙 그대로다.
export function collectThemeValues({ frontDir, sass, postcss }) {
  const themeRoot = postcss.parse(sass.compile(`${frontDir}/styles/_themes.scss`).css);
  const rootVals = {}; const darkBlock = {};
  themeRoot.walkRules((r) => {
    if (r.selector === ':root') r.walkDecls(/^--/, (d) => { if (!(d.prop in rootVals)) rootVals[d.prop] = d.value; });
    if (EV.isDarkSelector(r.selector)) r.walkDecls(/^--/, (d) => { darkBlock[d.prop] = d.value; });
  });
  return { lightVals: rootVals, darkVals: { ...rootVals, ...darkBlock } };
}

// BASE 시점 소스 → 투영. gitShow/compileScss는 호출부가 준다(무거운 의존성을 여기서
// 끌어오지 않기 위해서다). 판정은 evaluateProjection이 한다.
export function buildProjection({ spec, gitShow, compileScss, frontDir, sass, postcss }) {
  const { lightVals, darkVals } = collectThemeValues({ frontDir, sass, postcss });
  const declsOf = (src, rel) => EV.collectDeclarations(postcss.parse(compileScss(src, rel)), rel);
  const baseSources = Object.fromEntries(Object.keys(spec.FILES)
    .map((k) => [k, gitShow(spec.BASE, spec.FILES[k].rel)]));
  const pr = EV.evaluateProjection(spec, baseSources, { compileDecls: declsOf, lightVals, darkVals });
  return { pr, baseSources, lightVals, darkVals, declsOf };
}

// 투영 결과 → fixture. smoke는 호출부가 만든다(생성기는 committed context를,
// 승격은 candidate bundle을 근거로 쓴다 — 그 차이가 이 함수 밖에 있어야 한다).
export function buildProjectedFixture({ spec, pr, fingerprint, smoke }) {
  return EV.buildFixture({
    base: spec.BASE, blobs: spec.FILES, baseDecls: pr.baseDecls, projectedDecls: pr.projDecls,
    conversions: spec.CONVERSIONS, attribution: pr.attribution, contrast: pr.contrast,
    fingerprint, smoke,
  });
}
