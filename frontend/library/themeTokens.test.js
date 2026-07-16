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

// postcss Rule#selectors(list.comma 기반)로 "최상위 콤마"만 분리한다. 이전 selector.split(',')는
// 무조건 모든 콤마를 끊어 `:is(.Decoy, .Target, .Other):hover`처럼 함수형 의사클래스 **안쪽**
// 콤마까지 쪼갰다 — 그러면 ".Target" 파트가 진짜 타겟과 완전 동일 문자열로 오매치된다(외부 검수
// 실증, o시나리오: 실제로는 :is(...):hover 전체가 하나의 셀렉터라 진짜 타겟과 다름). rule.selectors는
// postcss 자체 셀렉터 리스트 파서라 괄호 안 콤마를 보존해 이 오매치를 구조적으로 막는다.
// 각 파트는 공백 정규화 후 완전 동일 문자열로만 비교한다 — 부분/접두 매칭·의사클래스 연속
// (`:hover` 등)·자손 결합자 전부 불허(`SELECTOR:hover` != `SELECTOR`).
function selectorMatches(rule, targetSelectors) {
  const targets = new Set(Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors]);
  return rule.selectors.some((part) => targets.has(part.replace(/\s+/g, ' ').trim()));
}

// target 셀렉터를 가진 "root 직속" 규칙만 postcss AST로 찾는다. rule.parent.type이 'root'가
// 아니면(즉 @media/@supports 등 안쪽이면) 애초에 후보에서 제외 — 외부 검수가 실증한 "@media 안
// 두 번째 이후 규칙이 최상위처럼 추출됨" 구멍을 이 한 줄이 구조적으로 닫는다. 매치가 0건이면
// "셀렉터 자체가 사라짐(@media 이동 포함)"과 "선언 불일치"를 구분해 호출부가 각각 다르게 보고한다.
// 동일 셀렉터로 반복되는 규칙(예: 승격핀 뒤에 다시 나오는 override 블록)은 전부 배열에 담아
// 반환한다 — 최종 유효값 판정(effectiveValue)이 문서 순서 그대로 cascade를 재현하려면 규칙
// 하나만 골라선 안 되고 매치되는 규칙 전부가 필요하다.
function findRootRules(root, targetSelectors) {
  const rules = [];
  root.walkRules((rule) => {
    if (rule.parent.type === 'root' && selectorMatches(rule, targetSelectors)) rules.push(rule);
  });
  return rules;
}

// 일치 규칙들(문서 순서)을 walkDecls로 훑어 prop별 "최종 유효 선언 하나"를 CSS cascade 규칙대로
// 합성하는 공용 리듀서. !important는 non-important를 무조건 이기고, 같은 중요도끼리는 후행이 이긴다
// (custom property도 일반 프로퍼티와 동일한 cascade 규칙을 따른다 — `--x: A !important; --x: B;`의
// 계산값은 여전히 A. 외부 검수 7라운드째 실증: darkValues가 이 규칙 없이 "무조건 후행 승리"만 쓰던
// 시절엔 `--color-selected-indicator: rgba(107,114,128,0) !important;` 뒤에 `#6B7280;`이 오는
// 케이스에서 브라우저는 투명인데 테스트는 #6B7280을 읽어 false-green을 냈다). predicate로 대상
// decl만 골라 effectiveValue(prop 화이트리스트)와 darkValues 수집(전체 --커스텀 프로퍼티) 양쪽이
// 이 로직을 공유한다 — 로직 중복·drift 방지. 반환값은 `{ [prop]: { value, important } }`.
function reduceEffectiveDecls(rules, predicate) {
  const state = {};
  rules.forEach((rule) => {
    rule.walkDecls((decl) => {
      if (!predicate(decl)) return;
      const cur = state[decl.prop];
      if (cur && cur.important && !decl.important) return; // important가 후행 non-important를 이김
      state[decl.prop] = { value: decl.value.trim(), important: !!decl.important };
    });
  });
  return state;
}

// 이전의 "일치 규칙 전체를 some()으로 훑어 하나라도 있으면 통과"식 판정은 뒤에 오는 override(승격핀
// 뒤 동일 selector의 `border: none`, indicator핀 뒤 `box-shadow: none` 등)를 놓치고 stale 값으로
// GREEN 처리했다(외부 검수 실증, l시나리오). 호출부는 "최종값 하나"만 검사해야 하며(some() 폐기),
// 여기 없는 prop은 그 selector 조합에서 한 번도 선언되지 않았다는 뜻이다.
function effectiveValue(rules, props) {
  return reduceEffectiveDecls(rules, (decl) => props.has(decl.prop));
}

// 값 문자열에서 "다른 var() 안에 중첩되지 않은" 최상위 var() 호출들의 첫 번째 인자(토큰)만 모아
// 집합으로 반환한다. 괄호 깊이를 추적해 매치된 var(...) 블록 전체(중첩 fallback 포함)를 통째로
// 건너뛰므로 fallback 안(`var(--a, var(--b))`의 `--b`)의 토큰은 절대 방문하지 않는다 — 이전
// includes(needle) 부분 문자열 매칭은 fallback 안에 기대 토큰이 있어도(예:
// `var(--color-input-border-hover, var(--color-input-border))`) true를 냈다(외부 검수 실증,
// m시나리오: 최상위 첫 인자는 `-hover` 별칭이라 실제로는 기대 토큰을 안 씀에도 통과했다).
// box-shadow처럼 콤마로 나열된 여러 최상위 var()(`var(--shadow-xs), inset … var(--color-selected-
// indicator)`)는 서로 중첩 관계가 아니므로 각각 독립적으로 전부 수집된다(HomeTabs 다중 그림자).
//
// 7라운드째 외부 검수가 실증한 잔여 구멍 2종을 이 수동 파서에 최소 침습으로 닫는다(postcss-
// value-parser로 AST 파서 전환도 제안됐으나, package.json에 선언된 의존성이 아니라 새 패키지 설치가
// 필요해 — 이 리포는 최소 변경을 선호하므로 quote-tracking + 경계 검사만 추가하는 쪽을 택했다):
//  r) 문자열 리터럴 문맥 미추적 — `box-shadow: "var(--color-selected-indicator)"`처럼 값 자체가
//     quoted 문자열이면 그 안의 `var(`는 CSS 함수 호출이 아니라 문자열 콘텐츠다. quote(`'`/`"`) 진입
//     시 매칭되는 종료 quote까지 통째로 건너뛴다(`\` escape도 추적해 `\"` 안에서 조기 종료 안 함).
//  r2) 식별자 경계 미검사 — `fakevar(--color-input-border)`의 `var(`는 `fakevar` 뒤에 접미로 붙은
//     문자열일 뿐 실제 var() 호출이 아니다. `var(` 직전 문자가 식별자 구성 문자([A-Za-z0-9_-])면
//     무시한다(1글자만 전진 — 이후 다른 진짜 var()는 계속 스캔).
function outermostVarTokens(value) {
  const str = String(value);
  const tokens = new Set();
  let i = 0;
  while (i < str.length) {
    const ch0 = str[i];
    if (ch0 === '"' || ch0 === "'") {
      const quote = ch0;
      let j = i + 1;
      while (j < str.length) {
        if (str[j] === '\\') { j += 2; continue; } // escape는 다음 문자까지 통째로 건너뜀
        if (str[j] === quote) { j += 1; break; } // 매칭 종료 quote
        j++;
      }
      i = j; // 문자열 리터럴 내부는 var() 스캔 대상에서 완전히 제외
      continue;
    }
    if (str.startsWith('var(', i)) {
      const prevChar = i > 0 ? str[i - 1] : '';
      if (/[A-Za-z0-9_-]/.test(prevChar)) { i++; continue; } // fakevar( 등 접미 매치는 진짜 var() 아님
      const parenOpen = i + 3; // '(' 위치
      let depth = 0;
      let closeIdx = -1;
      let commaIdx = -1;
      for (let j = parenOpen; j < str.length; j++) {
        const c = str[j];
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) { closeIdx = j; break; }
        } else if (c === ',' && depth === 1 && commaIdx === -1) {
          commaIdx = j; // 이 var(...) 최상위(fallback 구분) 콤마만 — 중첩 var() 안 콤마는 depth>1
        }
      }
      if (closeIdx === -1) { i += 4; continue; } // 괄호 불일치(비정상 값) — 이 지점만 건너뜀
      const argEnd = commaIdx === -1 ? closeIdx : commaIdx;
      const firstArg = str.slice(parenOpen + 1, argEnd).trim();
      const m = /^--([a-zA-Z0-9-]+)$/.exec(firstArg);
      if (m) tokens.add(m[1]);
      i = closeIdx + 1; // 이 var(...) 전체를 통째로 건너뜀 — 중첩/fallback 토큰은 절대 미방문
      continue;
    }
    i++;
  }
  return tokens;
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
  // 외부 검수 6라운드째가 실증한 잔여 false-green 2종은 AST를 이미 쓰고도 남아 있었다:
  //  ⑤ 일치 규칙 전체를 some()으로 보는 판정 — 승격핀 뒤에 같은 selector로 다시 오는
  //     `border: none;`(또는 indicator핀 뒤 `box-shadow: none;`)처럼 "선언은 있었지만 후행
  //     override로 무효화된" 경우도 "어딘가에 있었으니 통과"로 오판했다. effectiveValue가 문서
  //     순서·!important를 반영한 "최종값 하나"만 내놓으므로 이 케이스는 자연히 RED가 된다(`none`에는
  //     기대 var 토큰이 없다).
  //  ⑥ needle을 `.includes()`로 부분 문자열 매칭 — `var(--color-input-border-hover,
  //     var(--color-input-border))`처럼 fallback 안에 기대 토큰 텍스트가 그대로 들어 있으면
  //     실제로는 최상위에서 안 쓰는데도 매치됐다. outermostVarTokens는 각 값의 "최상위 var() 첫
  //     인자" 집합만 추출하므로 fallback 전용 토큰은 집합에 없다 — 기대 토큰이 그 집합의 원소인지만
  //     단정한다(문자열 부분 매칭 폐기).
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
  it.each(PINNED)('$label 가 컴파일된 규칙의 최종 유효 선언에서 기대 토큰을 사용', ({ file, selector, props, needle }) => {
    const root = postcss.parse(compiledSiteCss(file));
    const rules = findRootRules(root, selector);
    expect(rules.length, `${selector} 규칙(root 직속·셀렉터 완전일치)을 컴파일된 ${file}에서 찾지 못함`).toBeGreaterThan(0);
    const final = effectiveValue(rules, props); // 매치 규칙 전부에 cascade(!important·후행승리) 적용한 최종값
    const finalValues = Object.values(final).map((v) => v.value);
    const [expectedToken] = outermostVarTokens(needle); // needle 자체도 동일 파서로 토큰화(정합성 보장)
    const matched = finalValues.some((v) => outermostVarTokens(v).has(expectedToken));
    expect(matched, `${selector}의 최종 유효 [${[...props].join('/')}] 선언에서 outermost var 토큰 "${expectedToken}" 미발견 (finalValues=${JSON.stringify(finalValues)})`).toBe(true);
  });
});

// WCAG 2.x 상대휘도/대비비. hex 6자리와 rgb(a)(...) 둘 다 파싱한다(myTasks ScopeBtn--active의
// 반투명 배경 rgba(94, 106, 210, 0.1)를 합성색 계산에 그대로 써야 하므로 hex 전용으로는 부족하다).
// transparent 등 둘 다 아닌 값은 파싱 실패로 null → contrastRatio가 0을 반환해 아래 >=3 단정이
// RED가 된다(다크 인디케이터 투명 회귀 검출).
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function parseColor(value) {
  const str = String(value).trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(str);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(str);
  if (rgba) {
    // 브라우저 의미론대로 clamp — a는 [0,1], RGB 채널은 [0,255]. clamp 없이 Number()만 쓰면
    // `rgba(60,60,60,10)`(a=10)처럼 스펙 밖 값이 합성 수학을 붕괴시킨다: compositeOver의
    // `a*fg + (1-a)*bg`가 a=10일 때 음의 계수(1-a=-9)로 bg를 반대 방향으로 끌어당겨 비현실적인
    // 합성색을 만들고, 그 결과로 나온 대비가 실제 렌더(clamp된 a=1, 즉 완전 불투명)보다 훨씬 높게
    // 나와 회귀를 놓쳤다(외부 검수 실증, s시나리오: 실대비 ≈1.5~1.7인데 미클램프 시 25~74로 통과).
    return {
      r: clamp(Number(rgba[1]), 0, 255),
      g: clamp(Number(rgba[2]), 0, 255),
      b: clamp(Number(rgba[3]), 0, 255),
      a: rgba[4] != null ? clamp(Number(rgba[4]), 0, 1) : 1,
    };
  }
  return null;
}
// fgValue/bgValue는 hex/rgba 문자열이거나 이미 파싱·합성된 {r,g,b} 객체(체인 합성용) 둘 다 허용 —
// 객체면 alpha 필드가 없다는 뜻이므로 불투명(a=1)으로 취급한다(ScopeToggle처럼 배경 자체가 이미
// 알파 합성 결과인 체인 케이스, compositeOver(indicator, scopeToggleAdjacent) 등).
function toRGBA(value) {
  if (value && typeof value === 'object' && 'r' in value) return { a: 1, ...value };
  return parseColor(value);
}
// 반투명 전경(fgValue)을 배경(bgValue) 위에 알파 합성한 불투명 rgb 결과. 파싱 실패면 null.
function compositeOver(fgValue, bgValue) {
  const fg = toRGBA(fgValue);
  const bg = toRGBA(bgValue);
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
// ⚠️ 알파를 파싱만 하고 무시한다 — rgba(…, 0)(완전 투명) 같은 값도 hex와 동일하게 취급해 오통과
// 시킨다(외부 검수 실증, k시나리오). 인디케이터처럼 알파가 있을 수 있는 전경색은 절대 이 함수에
// 직접 넣지 말고 반드시 아래 contrastOverBg로 배경 위에 먼저 합성한 뒤 그 결과를 넣을 것.
function contrastRatio(colorA, colorB) {
  const a = typeof colorA === 'string' ? parseColor(colorA) : colorA;
  const b = typeof colorB === 'string' ? parseColor(colorB) : colorB;
  if (!a || !b) return 0;
  const [lo, hi] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}
// 인디케이터(fg)를 인접 배경(bg) 위에 먼저 알파 합성한 뒤, 그 합성색과 배경 자체의 대비를 잰다.
// contrastRatio(fg, bg)를 직접 부르면 fg의 알파가 무시돼 rgba(107,114,128,0)(완전 투명)도 불투명
// hex와 동일한 대비로 통과했다 — 합성을 먼저 거치면 알파=0일 때 결과가 배경과 완전히 같아져
// 1:1이 되고, 아래 >=3 단정이 자연히 RED가 된다(외부 검수 실증, k시나리오).
function contrastOverBg(fgValue, bgValue) {
  const composited = compositeOver(fgValue, bgValue);
  if (!composited) return 0;
  return contrastRatio(composited, bgValue);
}

describe('다크 selected-indicator 값 시맨틱 고정 (SC 1.4.11 비텍스트 대비 3:1)', () => {
  // _themes.scss는 원칙상 dark 블록이 1개지만, "html[data-theme=dark]" 셀렉터를 가진 root 직속
  // 규칙 전부를 문서 순서로 walk해 프로퍼티별 cascade 최종값(!important 우선, 동급은 후행 승리 —
  // 실제 CSS cascade와 동일)으로 darkValues를 합성한다 — 첫 블록만 읽으면 뒤쪽 재정의(예: 원복
  // 실수로 인디케이터를 다시 transparent로 되돌리는 블록 추가)를 놓치고 stale 값으로 GREEN
  // 처리한다(외부 검수 실증).
  // 셀렉터는 quoted/unquoted 둘 다 허용(따옴표 유무는 Sass 버전에 좌우 — 최상단 주석 참고).
  const themesRoot = postcss.parse(css);
  const DARK_SELECTORS = ['html[data-theme=dark]', "html[data-theme='dark']", 'html[data-theme="dark"]'];
  const darkRules = findRootRules(themesRoot, DARK_SELECTORS);
  // reduceEffectiveDecls(effectiveValue와 동일한 importance-aware 리듀서)로 합성 — 무조건 후행 승리로
  // 모으던 이전 버전은 custom property의 !important를 무시했다(위 함수 주석 참고, 외부 검수 7라운드
  // 실증). darkRules.length===1 단정만으로는 이 결함을 못 잡는다 — 같은 블록 "내부"의 중복 선언에도
  // !important가 개입할 수 있기 때문이다.
  const darkState = reduceEffectiveDecls(darkRules, (decl) => decl.prop.startsWith('--'));
  const darkValues = {};
  for (const [prop, { value }] of Object.entries(darkState)) darkValues[prop.slice(2)] = value;

  // 파일 상단 위치기반 추출(대칭·baseline·별칭)이 "dark 블록은 정확히 1개"를 암묵 가정한다 —
  // 뒤쪽 dark 재정의 블록이 생기면 여기서 즉시 RED(외부 검수: 유일성 또는 전면 cascade 요구).
  expect(darkRules.length).toBe(1);

  // ScopeToggle 실제 인접 합성색 — .MyTasks__ScopeBtn--active의 background를 컴파일된 myTasks
  // CSS에서 postcss AST로 그대로 읽어(하드코딩 금지) 다크 surface 위에 알파 합성한다. bg·surface
  // 단독 대비만으로는 실제 렌더 결과보다 대비가 후하게 나와 회귀를 놓친다(외부 검수 실증: indicator
  // #5F6774일 때 bg 3.36·surface 3.11로 통과하지만 실제 합성색 #1E202E 대비는 2.83으로 실패).
  // 매치 규칙 [0]만 읽던 이전 코드는 같은 selector로 뒤에 다시 오는 override(예: `background:
  // rgba(94,106,210,.2);` 재정의)를 놓치고 stale 값으로 GREEN 처리했다(외부 검수 실증, n시나리오)
  // — effectiveValue로 매치 규칙 전부에 cascade를 적용한 최종값 하나만 쓴다.
  const myTasksRoot = postcss.parse(compiledSiteCss('components/myTasks/myTasks.scss'));
  const scopeBtnActiveRules = findRootRules(myTasksRoot, '.MyTasks__ScopeBtn--active');
  const scopeBgFinal = effectiveValue(scopeBtnActiveRules, new Set(['background']))['background']?.value ?? null;
  // 최종값이 rgba/hex 리터럴이면 그대로 쓰고, `var(--token)` 참조면 darkValues(위 take-last 합성)로
  // 재귀 해석한다. 리터럴도 아니고 darkValues에 없는 토큰 참조도 아닌(복합 표현식 등) 값은 null —
  // 판정 불가를 "통과"가 아니라 "RED"로 떨어뜨리는 보수적 실패(호출부의 not.toBeNull() 단정).
  function resolveColorValue(value, darkValuesMap, depth = 0) {
    if (value == null || depth > 5) return null;
    if (parseColor(value)) return value;
    const m = /^var\(\s*--([a-z0-9-]+)\s*(?:,[\s\S]*)?\)$/i.exec(value.trim());
    if (!m) return null;
    const next = darkValuesMap[m[1]];
    if (next == null) return null;
    return resolveColorValue(next, darkValuesMap, depth + 1);
  }
  const scopeBgResolved = resolveColorValue(scopeBgFinal, darkValues);
  const scopeToggleAdjacent = scopeBgResolved != null
    ? compositeOver(scopeBgResolved, darkValues['color-surface'])
    : null;

  // 4개 인접색 각각을 독립된 it()로 단정 — 하나로 합쳐 첫 실패에서 bail하면 이후 신호(특히
  // ScopeToggle 합성색)가 실행조차 안 돼 리포트에서 안 보인다. 분리해두면 어떤 인접색이
  // 얼마의 대비로 얼마나 못 미쳤는지 실패 로그에서 개별적으로 확인할 수 있다.
  const indicator = darkValues['color-selected-indicator'];
  it('vs bg 3:1 이상 — transparent 등으로 되돌리면 파싱 실패로 RED', () => {
    expect(contrastOverBg(indicator, darkValues['color-bg']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs surface 3:1 이상', () => {
    expect(contrastOverBg(indicator, darkValues['color-surface']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs surface-hover 3:1 이상', () => {
    expect(contrastOverBg(indicator, darkValues['color-surface-hover']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs ScopeToggle 실제 합성색(반투명 active 배경 on 다크 surface) 3:1 이상', () => {
    expect(scopeToggleAdjacent, `ScopeToggle 배경 최종값 해석 실패: scopeBgFinal=${scopeBgFinal}`).not.toBeNull();
    expect(contrastOverBg(indicator, scopeToggleAdjacent), `indicator=${indicator} on scopeToggleAdjacent=${JSON.stringify(scopeToggleAdjacent)}`).toBeGreaterThanOrEqual(3);
  });
});
