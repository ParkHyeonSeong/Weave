import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'sass';
import postcss from 'postcss';

// _themes.scss 계약: 컴파일 결과에 flat 블록 3개 —
//   [0] :root(라이트) [1] html[data-theme='dark'](다크) [2] :root(테마불변 별칭)
// [0]/[1]의 --키 집합이 다르면 한쪽 테마에서 반대 테마 값이 상속 누출된다.
const css = compile(resolve(__dirname, '../styles/_themes.scss')).css;
// ⚠️ sass 1.97은 attribute selector의 불필요한 따옴표를 제거한다: html[data-theme=dark]
//    (따옴표 필수 매칭이면 별칭 블록을 dark로 오인 — 리뷰 재현 [52,5]) — unquoted 허용 필수.
const blocks = [...css.matchAll(/(?::root|html\[data-theme=(?:dark|["']dark["'])\])\s*\{([^}]*)\}/g)]
  .map((m) => new Set([...m[1].matchAll(/--([a-z0-9-]+)\s*:/g)].map((k) => k[1])));
const [light, dark, aliases = new Set()] = blocks;

describe('_themes.scss 토큰 대칭', () => {
  it('라이트/다크 블록이 존재하고 비어있지 않다', () => {
    expect(light?.size).toBeGreaterThan(30);
    expect(dark?.size).toBeGreaterThan(30);
  });
  it('라이트에만 있는 키가 없다', () => {
    expect([...light].filter((k) => !dark.has(k))).toEqual([]);
  });
  it('다크에만 있는 키가 없다', () => {
    expect([...dark].filter((k) => !light.has(k))).toEqual([]);
  });
});

// 라이트 무변화(핵심 수용 기준)를 값 수준으로 고정 — 키 대칭만으로는 라이트 값 오타를 못 잡는다.
// 기존 30토큰의 현행 리터럴(코어 팔레트)만 단정: 파생 토큰은 sass가 결정론 계산하므로 원본 고정으로 충분.
const LIGHT_BASELINE = {
  'color-bg': '#FFFFFF', 'color-surface': '#F9FAFB', 'color-surface-hover': '#F3F4F6',
  'color-primary': '#5E6AD2', 'color-primary-hover': '#4F5BC0',
  'color-primary-subtle': 'rgba(94, 106, 210, 0.08)',
  'color-text': '#1C1C1C', 'color-text-secondary': '#6B7280', 'color-text-tertiary': '#6B7280',
  'color-text-inverse': '#FFFFFF',
  'color-border': '#E5E5E5', 'color-border-hover': '#D1D5DB',
  'color-input-bg': '#FFFFFF', 'color-input-border': '#E5E5E5',
  'color-input-border-hover': '#D1D5DB',
  'color-selected-indicator': 'transparent',
  'color-error': '#DC2626', 'color-error-bg': '#FEF2F2',
  'color-success': '#16A34A', 'color-success-bg': '#F0FDF4',
  'color-warning': '#D97706', 'color-warning-bg': '#FFFBEB',
  'color-code-bg': '#F1F3F5', 'color-code-text': '#EB5757', 'color-code-block-bg': '#F6F8FA',
  'color-ref-doc': '#C2410C', 'color-ref-doc-bg': '#FFF7ED',
  'color-ref-issue': '#8B5CF6', 'color-ref-issue-bg': '#F5F3FF',
  'color-status-in-progress': '#1E40AF', 'color-status-in-progress-bg': '#DBEAFE',
};

describe('라이트 값 무변화 — 컴파일된 :root 값이 현행 팔레트와 동일', () => {
  it('코어 30토큰 값 일치', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/)[1];
    const values = Object.fromEntries(
      [...rootBlock.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
    for (const [k, v] of Object.entries(LIGHT_BASELINE)) {
      expect(values[k], `--${k}`).toBe(v);
    }
  });
});

describe('브리지 커버리지 — _variables.scss가 참조하는 var는 전부 정의돼 있어야 한다', () => {
  // Task 5 플립 전에는 참조 0개라 공허 통과, 플립 후부터 실효.
  // _variables에 토큰이 추가되는데 _themes에 빠지면(예: warning-bg 사후 추가) 여기서 잡힌다.
  it('미정의 참조 없음', () => {
    const bridge = readFileSync(resolve(__dirname, '../styles/_variables.scss'), 'utf8');
    const refs = [...bridge.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
    const defined = new Set([...light, ...aliases]);
    expect([...new Set(refs)].filter((r) => !defined.has(r))).toEqual([]);
  });
});

describe('브리지 완전성 — 모든 $color-*/$shadow-* 선언이 동일명 var()여야 한다', () => {
  // 새 토큰이 리터럴로 추가되면(브리지 우회) 여기서 잡힌다 — warning-bg 사후 추가 재발 방지.
  it('리터럴 잔존 없음', () => {
    const bridge = readFileSync(resolve(__dirname, '../styles/_variables.scss'), 'utf8');
    const decls = [...bridge.matchAll(/^\$((?:color|shadow)-[a-z0-9-]+)\s*:\s*([^;]+);/gm)];
    expect(decls.length).toBeGreaterThan(30);
    const bad = decls.filter((m) => m[2].trim() !== `var(--${m[1]})`)
      .map((m) => `${m[1]} = ${m[2].trim()}`);
    expect(bad).toEqual([]);
  });
});

describe('사이트 SCSS의 sass 색함수 $변수 입력 금지 (컴파일 의존 재유입 차단)', () => {
  it('rgba($…)/color.adjust($…)/color.scale($…) 잔존 없음', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const files = readdirSync(stylesDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.scss') && !f.endsWith('_themes.scss'));
    const offenders = [];
    for (const f of files) {
      readFileSync(resolve(stylesDir, f), 'utf8').split('\n').forEach((line, i) => {
        const code = line.split('//')[0]; // 주석 제외
        if (/(?:rgba|color\.adjust|color\.scale)\(\s*\$/.test(code)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('전 SCSS var(--…) 참조 커버리지', () => {
  // 테마 정의 ∪ 불변 별칭 ∪ 런타임 JS 주입 ∪ S5 이행 예정(context-menu 폴백 소비)만 허용.
  const RUNTIME_INJECTED = ['branch-color', 'status-color', 'accent', 'sticky-header-h'];
  // 예외는 경로+개수까지 고정 — 번지거나 늘어나면 즉시 검출, 이관(S4/S5)하면 목록·개수 갱신 신호.
  // S4: track.scss 기존 fallback 소비(848·859·1769·2171·2708 tertiary, 1208 secondary).
  //   ⚠️ fallback(#9ca3af)이 신 토큰 라이트값(--color-text-tertiary=#6B7280)과 달라 단순 치환 시
  //      라이트 색이 바뀐다 — S4에서 사이트별 의도 판정 필수.
  // S5: context-menu.scss의 미정의 var 폴백 소비 2건.
  const PENDING = {
    'track/track.scss': { 'text-secondary': 1, 'text-tertiary': 5 },
    'common/context-menu.scss': { 'color-hover': 1, 'color-border-subtle': 1 },
  };
  it('미정의 var 참조 없음 (예외는 경로·개수 고정)', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const defined = new Set([...light, ...aliases, ...RUNTIME_INJECTED]);
    const offenders = [];
    const seen = {}; // 예외 사용 실측 tally
    for (const f of readdirSync(stylesDir, { recursive: true }).map(String)
        .filter((f) => f.endsWith('.scss') && !f.endsWith('_themes.scss'))) {
      const src = readFileSync(resolve(stylesDir, f), 'utf8');
      const pendingFile = Object.keys(PENDING).find((sfx) => f.endsWith(sfx));
      for (const m of src.matchAll(/var\(--([a-z0-9-]+)/g)) {
        if (defined.has(m[1])) continue;
        if (pendingFile && PENDING[pendingFile][m[1]] != null) {
          seen[pendingFile] = seen[pendingFile] || {};
          seen[pendingFile][m[1]] = (seen[pendingFile][m[1]] || 0) + 1;
          continue;
        }
        offenders.push(`${f}: --${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(seen).toEqual(PENDING); // 개수가 줄어도(이관 완료) 알림 — 목록 갱신
  });
});

describe('track 로컬 별칭 완전성 — $track-x는 동일명 var(--track-x)', () => {
  it('별칭 잔존/오기 없음', () => {
    const src = readFileSync(resolve(__dirname, '../styles/components/track/track.scss'), 'utf8');
    const decls = [...src.matchAll(/^\$track-([a-z0-9-]+)\s*:\s*([^;]+);/gm)];
    expect(decls.length).toBe(7);
    const bad = decls.filter((m) => m[2].trim() !== `var(--track-${m[1]})`);
    expect(bad.map((m) => `track-${m[1]} = ${m[2].trim()}`)).toEqual([]);
  });
});

const scssCompileCache = new Map();
function compiledSiteCss(relPath) {
  if (!scssCompileCache.has(relPath)) {
    scssCompileCache.set(relPath, compile(resolve(__dirname, '../styles', relPath)).css);
  }
  return scssCompileCache.get(relPath);
}

// 콤마로 나눈 각 파트를 공백 정규화 후 완전 동일 문자열로만 비교한다 — 부분/접두 매칭·의사클래스
// 연속(`:hover` 등)·자손 결합자 전부 불허. 이전 flat 정규식 + ownsSelector의 "마지막 콤파운드
// 토큰이 접두 일치"식 판정은 `SELECTOR:hover`처럼 진짜와 무관한 강등(기본 셀렉터에서 제거하고
// hover에만 남김)까지 "소유"로 오인했다 — 완전 동일 문자열 비교는 이 경로를 구조적으로 차단한다.
function selectorMatches(ruleSelector, targetSelectors) {
  const targets = new Set(Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors]);
  return ruleSelector.split(',').some((part) => targets.has(part.replace(/\s+/g, ' ').trim()));
}

// target 셀렉터를 가진 "root 직속" 규칙만 postcss AST로 찾는다. rule.parent.type이 'root'가
// 아니면(즉 @media/@supports 등 안쪽이면) 애초에 후보에서 제외 — 외부 검수가 실증한 "@media 안
// 두 번째 이후 규칙이 최상위처럼 추출됨" 구멍을 이 한 줄이 구조적으로 닫는다. 매치가 0건이면
// "셀렉터 자체가 사라짐(@media 이동 포함)"과 "선언 불일치"를 구분해 호출부가 각각 다르게 보고한다.
function findRootRules(root, targetSelectors) {
  const rules = [];
  root.walkRules((rule) => {
    if (rule.parent.type === 'root' && selectorMatches(rule.selector, targetSelectors)) rules.push(rule);
  });
  return rules;
}

describe('컨트롤 보더/인디케이터 재분류 고정 — 컴파일 CSS postcss AST 기반 (외부 검수 회귀 방지)', () => {
  // 가변 fill 등으로 보더가 유일한 형상 단서인 컨트롤들 — 전수 재감사(2026-07-15)에서 승격 확정.
  // 대표: canvasEditor ColorSwatch(검정 프리셋이 다크 bg 대비 1.1:1이라 보더 없으면 소실).
  //
  // 정규식 기반 원문의 잔여 false-green 4종(외부 검수 실증)을 AST 구조로 전부 닫는다:
  //  ① `/* border: … */` CSS 블록주석 — postcss는 주석을 Comment 노드로 별도 분리하므로
  //     walkDecls가 애초에 방문하지 않는다(Sass `//` 라인주석은 컴파일 결과에 아예 안 남지만,
  //     `/* */` 블록주석은 Sass가 보존해 컴파일 CSS에 텍스트로 남는다 — 그래서 이 케이스가 성립).
  //  ② `--dead-border: var(…)` / `border-radius: var(…)` / `content: "border: var(…)"` —
  //     prop 화이트리스트 "정확 일치"(부분 문자열·접두 매칭 아님)라 `border-radius`는 `border`
  //     화이트리스트에 안 걸리고, 커스텀 프로퍼티(`--dead-border`)·`content`도 마찬가지.
  //  ③ 기본 셀렉터에서 제거하고 `:hover`에만 남김 — selectorMatches의 완전 동일 문자열 비교가
  //     `SELECTOR:hover` != `SELECTOR`로 판정해 애초에 findRootRules 후보에 안 들어온다.
  //  ④ `@media` 안 두 번째 이후 규칙이 최상위처럼 추출됨 — findRootRules의 root-직속 단정.
  //
  // needle은 값의 닫는 `)`까지 포함한 문자열(`var(--color-input-border)`)이라 `--color-input-
  // border-hover` 같은 별칭 컴파일 결과를 원천 차단한다(중간에 다른 문자가 오면 매치 실패).
  const BORDER_PROPS = new Set(['border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color']);
  const INDICATOR_PROPS = new Set(['box-shadow']);
  const PINNED = [
    { label: 'canvasEditor .CanvasEditor', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditor', props: BORDER_PROPS, needle: 'var(--color-input-border)' },
    { label: 'canvasEditor ColorSwatch(Toolbar)', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditorToolbar__ColorSwatch', props: BORDER_PROPS, needle: 'var(--color-input-border)' },
    { label: 'taskList FilterBuilder OpToggle', file: 'components/branch/taskList.scss', selector: '.FilterBuilder__OpToggle', props: BORDER_PROPS, needle: 'var(--color-input-border)' },
    { label: 'myTasks ScopeToggle', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeToggle', props: BORDER_PROPS, needle: 'var(--color-input-border)' },
    { label: 'home-shared HomeTabs', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs', props: BORDER_PROPS, needle: 'var(--color-input-border)' },
    { label: 'browseBranches JoinBtn--joined', file: 'components/browse/browseBranches.scss', selector: '.BrowseBranches__JoinBtn--joined', props: BORDER_PROPS, needle: 'var(--color-input-border)' },
    // 선택 상태 인디케이터(수정 1, SC 1.4.11) — active 셀렉터가 토큰을 실제로 소비하는지만 여기서 고정.
    // 다크 값 자체의 시맨틱(투명 회귀 방지)은 아래 별도 describe에서 대비비로 고정한다.
    { label: 'home-shared HomeTabs__Tab.is-on', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs__Tab.is-on', props: INDICATOR_PROPS, needle: 'var(--color-selected-indicator)' },
    { label: 'myTasks ScopeBtn--active', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeBtn--active', props: INDICATOR_PROPS, needle: 'var(--color-selected-indicator)' },
  ];
  it.each(PINNED)('$label 가 컴파일된 규칙에서 기대 선언을 사용', ({ file, selector, props, needle }) => {
    const root = postcss.parse(compiledSiteCss(file));
    const rules = findRootRules(root, selector);
    expect(rules.length, `${selector} 규칙(root 직속·셀렉터 완전일치)을 컴파일된 ${file}에서 찾지 못함`).toBeGreaterThan(0);
    const values = [];
    rules.forEach((rule) => rule.walkDecls((decl) => { if (props.has(decl.prop)) values.push(decl.value); }));
    expect(values.some((v) => v.includes(needle)), `${selector}의 [${[...props].join('/')}] 선언에서 "${needle}" 미발견 (found=${JSON.stringify(values)})`).toBe(true);
  });
});

// WCAG 2.x 상대휘도/대비비. hex 6자리와 rgb(a)(...) 둘 다 파싱한다(myTasks ScopeBtn--active의
// 반투명 배경 rgba(94, 106, 210, 0.1)를 합성색 계산에 그대로 써야 하므로 hex 전용으로는 부족하다).
// transparent 등 둘 다 아닌 값은 파싱 실패로 null → contrastRatio가 0을 반환해 아래 >=3 단정이
// RED가 된다(다크 인디케이터 투명 회귀 검출).
function parseColor(value) {
  const str = String(value).trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(str);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(str);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] != null ? Number(rgba[4]) : 1 };
  }
  return null;
}
// 반투명 전경(fgValue)을 불투명 배경(bgHex) 위에 알파 합성한 불투명 rgb 결과. 파싱 실패면 null.
function compositeOver(fgValue, bgHex) {
  const fg = parseColor(fgValue);
  const bg = parseColor(bgHex);
  if (!fg || !bg) return null;
  const a = fg.a;
  return { r: a * fg.r + (1 - a) * bg.r, g: a * fg.g + (1 - a) * bg.g, b: a * fg.b + (1 - a) * bg.b };
}
function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
// colorA/colorB는 hex/rgba 문자열 또는 이미 파싱된 {r,g,b} 객체(합성색) 둘 다 허용.
function contrastRatio(colorA, colorB) {
  const a = typeof colorA === 'string' ? parseColor(colorA) : colorA;
  const b = typeof colorB === 'string' ? parseColor(colorB) : colorB;
  if (!a || !b) return 0;
  const [lo, hi] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

describe('다크 selected-indicator 값 시맨틱 고정 (SC 1.4.11 비텍스트 대비 3:1)', () => {
  // _themes.scss는 원칙상 dark 블록이 1개지만, "html[data-theme=dark]" 셀렉터를 가진 root 직속
  // 규칙 전부를 문서 순서로 walk해 프로퍼티별 "마지막 선언 승리"(실제 CSS cascade와 동일)로
  // darkValues를 합성한다 — 첫 블록만 읽으면 뒤쪽 재정의(예: 원복 실수로 인디케이터를 다시
  // transparent로 되돌리는 블록 추가)를 놓치고 stale 값으로 GREEN 처리한다(외부 검수 실증).
  // 셀렉터는 quoted/unquoted 둘 다 허용(따옴표 유무는 Sass 버전에 좌우 — 최상단 주석 참고).
  const themesRoot = postcss.parse(css);
  const DARK_SELECTORS = ['html[data-theme=dark]', "html[data-theme='dark']", 'html[data-theme="dark"]'];
  const darkRules = findRootRules(themesRoot, DARK_SELECTORS);
  const darkValues = {};
  darkRules.forEach((rule) => rule.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) darkValues[decl.prop.slice(2)] = decl.value.trim();
  }));

  // ScopeToggle 실제 인접 합성색 — .MyTasks__ScopeBtn--active의 background(반투명 rgba)를
  // 컴파일된 myTasks CSS에서 postcss AST로 그대로 읽어(하드코딩 금지) 다크 surface 위에 알파
  // 합성한다. bg·surface 단독 대비만으로는 실제 렌더 결과보다 대비가 후하게 나와 회귀를 놓친다
  // (외부 검수 실증: indicator #5F6774일 때 bg 3.36·surface 3.11로 통과하지만 실제 합성색
  // #1E202E 대비는 2.83으로 실패). surface 값 자체도 위 darkValues(take-last)에서 읽는다.
  const myTasksRoot = postcss.parse(compiledSiteCss('components/myTasks/myTasks.scss'));
  const scopeBtnActiveRule = findRootRules(myTasksRoot, '.MyTasks__ScopeBtn--active')[0];
  let scopeBtnBg = null;
  scopeBtnActiveRule?.walkDecls((decl) => { if (decl.prop === 'background') scopeBtnBg = decl.value.trim(); });
  const scopeToggleAdjacent = compositeOver(scopeBtnBg, darkValues['color-surface']);

  // 4개 인접색 각각을 독립된 it()로 단정 — 하나로 합쳐 첫 실패에서 bail하면 이후 신호(특히
  // ScopeToggle 합성색)가 실행조차 안 돼 리포트에서 안 보인다. 분리해두면 어떤 인접색이
  // 얼마의 대비로 얼마나 못 미쳤는지 실패 로그에서 개별적으로 확인할 수 있다.
  const indicator = darkValues['color-selected-indicator'];
  it('vs bg 3:1 이상 — transparent 등으로 되돌리면 파싱 실패로 RED', () => {
    expect(contrastRatio(indicator, darkValues['color-bg']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs surface 3:1 이상', () => {
    expect(contrastRatio(indicator, darkValues['color-surface']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs surface-hover 3:1 이상', () => {
    expect(contrastRatio(indicator, darkValues['color-surface-hover']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs ScopeToggle 실제 합성색(반투명 active 배경 on 다크 surface) 3:1 이상', () => {
    expect(scopeToggleAdjacent, `ScopeToggle 합성색 계산 실패(배경 rgba 파싱 불가): bg=${scopeBtnBg}, surface=${darkValues['color-surface']}`).not.toBeNull();
    expect(contrastRatio(indicator, scopeToggleAdjacent), `indicator=${indicator} on (${scopeBtnBg} over ${darkValues['color-surface']})`).toBeGreaterThanOrEqual(3);
  });
});
