import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, compileString } from 'sass';
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

// setA 원소 중 setB에도 있는 것들 — 별칭·라이트 키 교집합 판정(P1)과 그 synthetic 단위 검증이 공유.
function keyIntersection(setA, setB) {
  return [...setA].filter((k) => setB.has(k));
}

describe('별칭 블록(3번째) 키가 라이트 블록과 배타적이다 (P1 — specificity 재선언 침묵 방지)', () => {
  // 별칭 블록은 라이트와 동일하게 ':root' 단독 셀렉터라 specificity가 같다 — 별칭이 라이트 키를
  // 재선언하면 파일 순서상 후행인 별칭 값이 라이트 실렌더를 조용히 덮어써도 아무 에러도 안 난다.
  // 위 대칭 검사는 라이트/다크만 비교해 이 경로를 못 잡는다 — 내부 리뷰 P1 지적. 별칭 키 집합과
  // 라이트 키 집합의 교집합이 비어 있어야 함을 직접 단정한다(현행 별칭 5토큰 전부 배타 — 즉시 통과).
  it('별칭 키 ∩ 라이트 키 = ∅', () => {
    expect(keyIntersection(aliases, light)).toEqual([]);
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
//
// prop 정규화(Minor 2, 8라운드 외부 검수 실증) — 표준 CSS 프로퍼티명은 스펙상 ASCII
// case-insensitive라 `BORDER: none;` 뒤에 오는 `border: 1px solid red;`는 같은 프로퍼티의 후행
// 재정의여야 한다. 정규화 없이 decl.prop을 그대로 키로 쓰면 대소문자만 다른 두 선언이 서로 다른
// state 엔트리로 남아 override를 놓친다. 커스텀 프로퍼티(`--`로 시작)는 스펙상 case-sensitive이므로
// 그대로 보존한다(`--Foo`와 `--foo`는 별개 토큰). predicate는 (decl, normalizedProp) 둘 다 받는다 —
// 화이트리스트 비교(effectiveValue)도 정규화된 prop 기준이어야 대소문자 변형을 놓치지 않는다.
// 12R F5(내부 리뷰 실증, 12라운드 리뷰 실증분) — decodeCssIdentifier를 먼저 통과시킨 뒤 기존 로직을
// 적용한다. 이전엔 원문 decl.prop을 그대로 판정해 escaped 선언(`\--color-x`, `\42order` 등)이 cascade
// predicate·state 키·BORDER_PROP_RE 매칭에서 전부 미매치로 실종됐다(hasProtectedPrefix만 자체
// 디코딩해 이 구멍 밖이었다). decodeCssIdentifier는 이 파일 내 유일한 decode 지점으로 normalizeProp
// 진입부에 단일화돼 있다 — hasProtectedPrefix는 별도 입력(raw decl.prop)에 독립 호출하므로 이중
// 디코딩 경로가 아니다(멱등성은 아래 12R F5 synthetic이 직접 단정).
function normalizeProp(prop) {
  const decoded = decodeCssIdentifier(prop);
  return decoded.startsWith('--') ? decoded : decoded.toLowerCase();
}
function reduceEffectiveDecls(rules, predicate) {
  const state = {};
  rules.forEach((rule) => {
    rule.walkDecls((decl) => {
      const prop = normalizeProp(decl.prop);
      if (!predicate(decl, prop)) return;
      const cur = state[prop];
      if (cur && cur.important && !decl.important) return; // important가 후행 non-important를 이김
      state[prop] = { value: decl.value.trim(), important: !!decl.important };
    });
  });
  return state;
}

// 이전의 "일치 규칙 전체를 some()으로 훑어 하나라도 있으면 통과"식 판정은 뒤에 오는 override(승격핀
// 뒤 동일 selector의 `border: none`, indicator핀 뒤 `box-shadow: none` 등)를 놓치고 stale 값으로
// GREEN 처리했다(외부 검수 실증, l시나리오). 호출부는 "최종값 하나"만 검사해야 하며(some() 폐기),
// 여기 없는 prop은 그 selector 조합에서 한 번도 선언되지 않았다는 뜻이다.
function effectiveValue(rules, props) {
  return reduceEffectiveDecls(rules, (decl, prop) => props.has(prop));
}

// ─────────────────────────────────────────────────────────────────────────────
// 17R 아키텍처 전환 — **브라우저 시뮬레이터 → canonical 구조 게이트**(2층)
//
// 왜 전환하는가(외부 검수 진단, 전면 수용): 16라운드까지 이 파일은 CSS value grammar·deferred
// validation·shorthand cascade·!important·invalid-declaration fallback을 **자체 구현**하고 그 모델을
// **정답 판정기(oracle)** 로 삼았다. 그래서 모델이 틀려도 319개가 서로 일관되게 GREEN이 될 수 있었다 —
// 매 라운드 새 false-green이 나온 진짜 원인이다(env(--x)·if()·hypot·-webkit-link·RGB(1 2 3 4)·
// RGB(foo(1) 2 3)·color-mix 구분자 오용 전부 우회 실증). 15·16R의 "근본 대책"(whitelist 반전·fuzz)도
// 같은 모델 **안에서의** 반전이라 같은 방식으로 뚫렸다.
//
// 결론: 게이트가 브라우저를 흉내 내는 일을 중단한다.
//   · 층 1(구조 게이트) — PINNED selector의 **relevant 선언**(border 계열·border-image 계열·box-shadow·
//     all)은 **CANONICAL_DECLS와 구조적으로 정확히 일치할 때만** 통과한다. 그 외 모든 형태는 유효/무효/
//     미지를 **추론하지 않고 무조건 RED**. `env(--x)`든 `hypot()`든 `RGB(1 2 3 4)`든 canonical이 아니면
//     RED — 이 층에는 CSS 유효성 판단 코드 경로가 **존재하지 않는다**.
//   · 층 2(제한 evaluator) — 층 1을 통과한 canonical 선언 + CSS-wide 키워드(initial/unset/inherit/
//     revert/revert-layer)·`all`만 계산한다. **무효 CSS를 폐기하고 이전 핀을 살리는 fallback 동작은
//     제거**했다(정적 회귀 게이트에서 non-canonical CSS는 그 자체로 실패다) — "이전 유효 선언 부활"
//     클래스가 소멸한다.
//
// 결과: **false-green이 원리적으로 불가능**하다(게이트는 canonical 외 전부 RED로 수렴). false-RED는
// 늘지만 회귀 게이트로선 올바른 방향이다 — 실제 코드가 canonical을 벗어나면 개발자가 알아야 한다.
// ─────────────────────────────────────────────────────────────────────────────

// 층 1 원자 — 전부 "정확한 리터럴 형태"만 인정하는 anchored whitelist. 부분 매칭·문자열 분해가 없으므로
// (전체 값 하나를 anchored 정규식으로 판정) 토크나이저 재구현이 필요 없고 우회할 틈도 없다.
//   · 길이: `0`(단위 없는 0) 또는 소수 포함 양수 + px|rem|em. 핀 실측은 `0`과 `1px`뿐 — 그 밖의 단위
//     (lh·dvw·cqw…)·부호·계산식(calc/min/clamp)·백분율은 전부 **비-canonical(RED)** 이다.
//   · 토큰 참조: 정확히 `var(--name)`. fallback(`var(--x, #ccc)`)·대문자 `VAR()`·escape·내부 공백은
//     전부 비-canonical(RED) — 값 쪽 escape 디코더·<dashed-ident> 모델이 통째로 불필요해진다.
//   · 스타일: 가시 border-style 키워드만. `none`/`hidden`은 의도적으로 canonical 밖(RED)이다.
const CANON_VISIBLE_BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'];
const CANON_LEN_SRC = '(?:0|[0-9]+(?:\\.[0-9]+)?(?:px|rem|em))';
const CANON_VAR_SRC = 'var\\(--[a-z0-9-]+\\)';
const CANON_STYLE_SRC = `(?:${CANON_VISIBLE_BORDER_STYLES.join('|')})`;
// 캡처판(모델 추출용) — 판정은 항상 아래 CANONICAL_DECLS.re(anchored)로만 한다.
const CANON_BORDER_RE = new RegExp(`^(${CANON_LEN_SRC}) (${CANON_STYLE_SRC}) var\\(--([a-z0-9-]+)\\)$`);
const CANON_SHADOW_OPAQUE_LAYER_RE = new RegExp(`^var\\(--([a-z0-9-]+)\\)$`);
const CANON_SHADOW_INSET_LAYER_RE = new RegExp(
  `^inset (${CANON_LEN_SRC}) (${CANON_LEN_SRC}) (${CANON_LEN_SRC}) (${CANON_LEN_SRC}) var\\(--([a-z0-9-]+)\\)$`,
);
const CANON_SHADOW_LAYER_SRC = `(?:${CANON_VAR_SRC}|inset ${CANON_LEN_SRC} ${CANON_LEN_SRC} ${CANON_LEN_SRC} ${CANON_LEN_SRC} ${CANON_VAR_SRC})`;

// CANONICAL_DECLS — **핀 8곳의 실제 컴파일 값에서 도출**한 canonical 형태 집합. 각 항목의 `pins`가
// 도출 근거다(아래 "CANONICAL_DECLS 도출 근거 고정" describe가 이 대응을 실파일로 재검증한다).
// 여기 없는 형태는 전부 비-canonical이며 게이트는 그 유효성을 **판단하지 않는다**.
const CANONICAL_DECLS = [
  {
    id: 'border-shorthand',
    level: 'value', // 선언 값 전체가 이 형태여야 한다
    prop: 'border',
    form: 'border: <length> <visible-style> var(--<token>)',
    re: new RegExp(`^${CANON_LEN_SRC} ${CANON_STYLE_SRC} ${CANON_VAR_SRC}$`),
    // 근거(실측 컴파일 값, 전부 `1px solid var(--color-input-border)`):
    pins: ['.CanvasEditor', '.CanvasEditorToolbar__ColorSwatch', '.FilterBuilder__OpToggle',
      '.MyTasks__ScopeToggle', '.HomeTabs', '.BrowseBranches__JoinBtn--joined'],
  },
  {
    id: 'box-shadow-inset-indicator-layer',
    level: 'box-shadow-layer', // box-shadow 값의 한 레이어(최상위 콤마 구분)
    prop: 'box-shadow',
    form: 'inset <length> <length> <length> <length> var(--<token>)',
    re: CANON_SHADOW_INSET_LAYER_RE,
    // 근거: 두 인디케이터 핀이 공통으로 쓰는 레이어 — 실측 `inset 0 0 0 1px var(--color-selected-indicator)`.
    pins: ['.MyTasks__ScopeBtn--active', '.HomeTabs__Tab.is-on'],
  },
  {
    id: 'box-shadow-opaque-var-layer',
    level: 'box-shadow-layer',
    prop: 'box-shadow',
    form: 'var(--<token>)',
    re: CANON_SHADOW_OPAQUE_LAYER_RE,
    // 근거: HomeTabs 다중 그림자의 첫 레이어 — 실측 `var(--shadow-xs)`(완전 그림자로 확장되는 불투명 레이어).
    pins: ['.HomeTabs__Tab.is-on'],
  },
];
// box-shadow 선언 값 전체 = canonical 레이어의 콤마 나열. **분해 없이** anchored 정규식으로 먼저
// 전체를 판정하므로(그 다음에야 모델 추출용 분해를 한다) "순진한 split이 canonical처럼 보이는 조각을
// 만들어내는" 부류의 우회가 구조적으로 불가능하다.
const CANON_SHADOW_VALUE_RE = new RegExp(`^${CANON_SHADOW_LAYER_SRC}(?:, ${CANON_SHADOW_LAYER_SRC})*$`);

// CSS-wide 키워드 — 층 2가 계산하는 유일한 non-canonical-form 입력. 정확히 소문자 단독일 때만 인정한다
// (명시 예외: `INITIAL` 같은 대문자 변형은 스펙상 유효하지만 여기선 비-canonical=RED로 fail-closed).
const CANON_CSS_WIDE_RE = /^(?:initial|inherit|unset|revert|revert-layer)$/;
const MODELED_RESET_KEYWORDS = new Set(['initial', 'unset']); // 비상속 속성이라 두 키워드는 동치
const BORDER_IMAGE_PROP_RE = /^border-image(?:-(?:source|slice|width|outset|repeat))?$/;

// relevant 선언 판정 — **프로퍼티 이름만** 본다(값 유효성 추론 없음). border로 시작하는 프로퍼티는
// 경계 무관이 확실한 것(radius/collapse/spacing)만 제외하고 전부 relevant다 — 논리 프로퍼티
// (border-inline-*/border-block-*)·border-image 계열·미지의 `border-*` 신설 프로퍼티까지 자동으로
// relevant에 들어와 canonical이 아니면 RED가 된다(15R "논리 프로퍼티 fail-closed" 계약의 일반화).
const IRRELEVANT_BORDER_PROP_RE = /^border-(?:collapse|spacing)$|-radius$/;
function isRelevantProp(prop) {
  if (prop === 'box-shadow' || prop === 'all') return true;
  if (!prop.startsWith('border')) return false;
  return !IRRELEVANT_BORDER_PROP_RE.test(prop);
}

// 값 정규화 — 공백 축약/trim **만** 한다(소문자화·escape 디코딩·토큰 분해 전부 없음). 대소문자와
// escape가 canonical 판정에 그대로 노출되므로 `VAR(--x)`·`tr\61 nsparent` 류는 자동으로 RED다.
function normalizeDeclValue(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

// box-shadow canonical 값 → 레이어 모델 배열(전체가 이미 canonical로 증명된 뒤에만 호출).
function canonicalShadowLayers(value) {
  if (!CANON_SHADOW_VALUE_RE.test(value)) return null;
  return value.split(', ').map((layer) => {
    const inset = CANON_SHADOW_INSET_LAYER_RE.exec(layer);
    if (inset) {
      return {
        kind: 'inset',
        offsetX: parseFloat(inset[1]),
        offsetY: parseFloat(inset[2]),
        blur: parseFloat(inset[3]),
        spread: parseFloat(inset[4]),
        token: inset[5],
      };
    }
    return { kind: 'opaque-var', token: CANON_SHADOW_OPAQUE_LAYER_RE.exec(layer)[1] };
  });
}

// 층 1 판정기 — relevant 선언 하나를 `canonical`(+form) 또는 `non-canonical`로 **이분**한다.
// 상태 모델(층 2 내부에서만 의미를 갖는다): syntax = canonical | non-canonical.
// non-canonical은 어느 분기에서든 RED이고 **어떤 부작용도 내지 않는다**(border-image reset 금지 포함 —
// 검수 finding 3의 `border: RGB(foo(1) 2 3)` 케이스가 이걸로 닫힌다).
function classifyRelevantDecl(prop, rawValue) {
  const value = normalizeDeclValue(rawValue);
  if (CANON_CSS_WIDE_RE.test(value)) return { syntax: 'canonical', form: 'css-wide', keyword: value, value };
  if (prop === 'border') {
    const m = CANON_BORDER_RE.exec(value);
    if (m) return { syntax: 'canonical', form: 'border', value, border: { width: parseFloat(m[1]), style: m[2], token: m[3] } };
  }
  if (prop === 'box-shadow') {
    const layers = canonicalShadowLayers(value);
    if (layers) return { syntax: 'canonical', form: 'box-shadow', value, layers };
  }
  return { syntax: 'non-canonical', prop, value };
}

// PINNED selector 규칙 수집. root 직속 규칙만 cascade에 참여시키고, **조건부 문맥(@media/@supports 등)
// 안의 동일 selector 규칙**은 별도로 반환한다 — 이전 구조는 이들을 조용히 무시했다(모델 불가를
// "없는 것"으로 취급 = 수집 누락 구멍). 이제 그 안에 relevant 선언이 하나라도 있으면 fail-closed RED다.
function collectPinnedRules(root, targetSelectors) {
  const rootRules = [];
  const conditionalRules = [];
  root.walkRules((rule) => {
    if (!selectorMatches(rule, targetSelectors)) return;
    (rule.parent.type === 'root' ? rootRules : conditionalRules).push(rule);
  });
  return { rootRules, conditionalRules };
}

// ─────────────────────────────────────────────────────────────────────────────
// 층 2 — 제한된 cascade evaluator. 다루는 입력은 canonical 선언 + CSS-wide 키워드·`all`뿐이라 범위가
// 극적으로 축소됐다. 모델링 대상은 선언 순서·!important·(canonical 폼 사이의) 도메인 관계뿐이다.
// **무효 CSS fallback(이전 핀 부활) 동작은 없다** — non-canonical이 하나라도 있으면 그 자체가 실패다.
// ─────────────────────────────────────────────────────────────────────────────
function evaluateCanonicalContract(rootRules, conditionalRules, contract) {
  const nonCanonical = [];
  const unmodelable = [];
  const border = { model: null, important: false }; // model=null → border initial(비가시)
  const shadow = { model: null, important: false }; // model=null → box-shadow initial(none)
  const applyCell = (cell, model, important) => {
    if (cell.important && !important) return; // important가 후행 non-important를 이김
    cell.model = model;
    cell.important = important;
  };

  conditionalRules.forEach((rule) => {
    rule.walkDecls((decl) => {
      if (!isRelevantProp(normalizeProp(decl.prop))) return;
      // 조건부 적용(뷰포트·기능 질의)은 정적 게이트가 계산할 수 없다 → 모델 불가로 표면화.
      unmodelable.push(`조건부 문맥 ${describeLocation(rule)} { ${decl.prop}: ${normalizeDeclValue(decl.value)} }`);
    });
  });

  rootRules.forEach((rule) => {
    rule.walkDecls((decl) => {
      const prop = normalizeProp(decl.prop); // escaped 식별자(\42order 등)는 여기서 실이름으로 복원된다
      if (!isRelevantProp(prop)) return;
      const cls = classifyRelevantDecl(prop, decl.value);
      const important = !!decl.important;
      if (cls.syntax === 'non-canonical') {
        nonCanonical.push(`${decl.prop}: ${cls.value}${important ? ' !important' : ''}`);
        return; // 부작용 금지 — 리셋도 설정도 하지 않는다
      }
      if (cls.form === 'border') { applyCell(border, cls.border, important); return; }
      if (cls.form === 'box-shadow') { applyCell(shadow, cls.layers, important); return; }
      // css-wide
      if (!MODELED_RESET_KEYWORDS.has(cls.keyword)) {
        unmodelable.push(`${decl.prop}: ${cls.keyword}`); // inherit/revert/revert-layer — 모델 불가(sticky)
        return;
      }
      if (prop === 'all') { applyCell(border, null, important); applyCell(shadow, null, important); return; }
      if (prop === 'box-shadow') { applyCell(shadow, null, important); return; }
      if (BORDER_IMAGE_PROP_RE.test(prop)) return; // border-image initial/unset = 도장 없음(경계 계약 무영향)
      applyCell(border, null, important); // 그 밖 border 계열 initial/unset
    });
  });

  const blocked = nonCanonical.length > 0 || unmodelable.length > 0;
  if (contract.kind === 'indicator') {
    const layers = shadow.model;
    const layer = layers ? layers.find((l) => l.kind === 'inset' && l.token === contract.token && l.spread > 0) : null;
    return { visible: !blocked && !!layer, nonCanonical, unmodelable, layers, layer };
  }
  const m = border.model;
  const visible = !blocked && !!m && m.width > 0 && m.token === contract.token;
  return { visible, nonCanonical, unmodelable, border: m };
}

// PINNED 본문과 모든 mutation synthetic이 통과하는 **단일 진입점**(계약 유지 — 13R I5).
function evaluatePinnedContract(cssText, selector, contract) {
  const root = postcss.parse(cssText);
  const { rootRules, conditionalRules } = collectPinnedRules(root, selector);
  if (rootRules.length === 0 && conditionalRules.length === 0) {
    return { visible: false, rulesFound: 0, reason: `${selector} 규칙(셀렉터 완전일치) 미발견` };
  }
  return { rulesFound: rootRules.length, ...evaluateCanonicalContract(rootRules, conditionalRules, contract) };
}
// synthetic 진입점 — SCSS는 PINNED과 동일하게 Sass compile을 거치고, Sass가 선-거부/선-접기 하는
// 벡터(명시 예외)는 raw CSS를 직접 태운다(P4 스윕이 raw .css도 훑으므로 실제 입력 경로다).
const evalBorderScss = (scss, token = 'color-input-border') =>
  evaluatePinnedContract(compileString(scss).css, '.X', { kind: 'border', token });
const evalIndicatorScss = (scss, token) =>
  evaluatePinnedContract(compileString(scss).css, '.X', { kind: 'indicator', token });
const evalBorderCss = (cssText, token = 'color-input-border') =>
  evaluatePinnedContract(cssText, '.X', { kind: 'border', token });
const evalIndicatorCss = (cssText, token) =>
  evaluatePinnedContract(cssText, '.X', { kind: 'indicator', token });
// needle(`var(--token)`)도 canonical 원자 매처로 토큰화한다 — 별도 파서 없음(정합성 보장).
function canonicalNeedleToken(needle) {
  const m = CANON_SHADOW_OPAQUE_LAYER_RE.exec(normalizeDeclValue(needle));
  if (!m) throw new Error(`PINNED needle이 canonical var(--token) 형태가 아님: ${needle}`);
  return m[1];
}

describe('컨트롤 보더/인디케이터 재분류 고정 — canonical 구조 게이트 (17R 아키텍처 전환)', () => {
  // 가변 fill 등으로 보더가 유일한 형상 단서인 컨트롤들 — 전수 재감사(2026-07-15)에서 승격 확정.
  // 대표: canvasEditor ColorSwatch(검정 프리셋이 다크 bg 대비 1.1:1이라 보더 없으면 소실).
  //
  // 6~16라운드에 걸쳐 이 핀 파이프라인이 닫아 온 우회들은 **이제 전부 층 1이 구조적으로 흡수**한다
  // (개별 grammar 판정을 없애고 "canonical이 아니면 RED"로 수렴시켰기 때문). 기록 목적의 대응표:
  //  ① `/* border: … */` 블록주석 — postcss Comment 노드라 walkDecls 미방문(유지).
  //  ② `--dead-border`/`border-radius`/`content:"border:…"` — isRelevantProp의 프로퍼티 이름 판정에서
  //     제외(값 유효성 추론 없음). 반대로 `border-*` 신설/논리 프로퍼티는 relevant로 들어와 RED가 된다.
  //  ③ `:hover`에만 남김 — selectorMatches의 완전 동일 문자열 비교(유지).
  //  ④ `@media` 안 규칙 — 이전엔 조용히 **무시**됐다(수집 누락). 이제 collectPinnedRules가 조건부 문맥
  //     규칙을 따로 모아 relevant 선언이 있으면 모델 불가(fail-closed RED)로 표면화한다.
  //  ⑤ 후행 override(`border:none`·`box-shadow:none`) — 층 2 cascade가 최종 셀 하나만 본다. 게다가
  //     `none`은 canonical이 아니므로 그 선언의 존재 자체가 RED다.
  //  ⑥ fallback 안 토큰 텍스트(`var(--a, var(--b))`) — canonical `var(--name)`은 fallback을 불허(RED).
  //  ⑦⑧⑨ 가시성(spread 0·width 0·style 없음·네 면 소실·calc width) — 층 2가 canonical 모델에서
  //     width>0 / spread>0 / 토큰 일치를 직접 계산하고, 그 밖의 형태는 애초에 canonical이 아니다.
  const PINNED = [
    { label: 'canvasEditor .CanvasEditor', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditor', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'canvasEditor ColorSwatch(Toolbar)', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditorToolbar__ColorSwatch', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'taskList FilterBuilder OpToggle', file: 'components/branch/taskList.scss', selector: '.FilterBuilder__OpToggle', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'myTasks ScopeToggle', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeToggle', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'home-shared HomeTabs', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'browseBranches JoinBtn--joined', file: 'components/browse/browseBranches.scss', selector: '.BrowseBranches__JoinBtn--joined', kind: 'border', needle: 'var(--color-input-border)' },
    // 선택 상태 인디케이터(수정 1, SC 1.4.11) — active 셀렉터가 토큰을 실제로 소비하는지만 여기서 고정.
    // 다크 값 자체의 시맨틱(투명 회귀 방지)은 아래 별도 describe에서 대비비로 고정한다.
    { label: 'home-shared HomeTabs__Tab.is-on', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs__Tab.is-on', kind: 'indicator', needle: 'var(--color-selected-indicator)' },
    { label: 'myTasks ScopeBtn--active', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeBtn--active', kind: 'indicator', needle: 'var(--color-selected-indicator)' },
  ];
  it.each(PINNED)('$label 의 relevant 선언이 전부 canonical이고 기대 토큰이 시각적으로 유효하다', ({ file, selector, kind, needle }) => {
    const expectedToken = canonicalNeedleToken(needle);
    const res = evaluatePinnedContract(compiledSiteCss(file), selector, { kind, token: expectedToken });
    expect(res.rulesFound, `${selector} 규칙(root 직속·셀렉터 완전일치)을 컴파일된 ${file}에서 찾지 못함`).toBeGreaterThan(0);
    expect(
      res.visible,
      `${selector} ${kind} 계약 위반(기대 토큰 "${expectedToken}") — ${JSON.stringify(res)}`,
    ).toBe(true);
  });

  // CANONICAL_DECLS의 **도출 근거**를 실파일로 재검증한다 — 상수의 pins 목록이 실제 컴파일 값과
  // 어긋나면(핀이 canonical을 벗어나거나 상수가 낡으면) 여기서 즉시 드러난다.
  it('CANONICAL_DECLS 도출 근거 고정 — 핀 8곳의 relevant 선언이 전부 canonical로 분류된다', () => {
    const seen = [];
    for (const { selector, file } of PINNED) {
      const root = postcss.parse(compiledSiteCss(file));
      const { rootRules, conditionalRules } = collectPinnedRules(root, selector);
      expect(conditionalRules, `${selector}: 조건부 문맥(@media 등) 규칙이 새로 생김 — 모델 불가`).toEqual([]);
      rootRules.forEach((rule) => rule.walkDecls((decl) => {
        const prop = normalizeProp(decl.prop);
        if (!isRelevantProp(prop)) return;
        const cls = classifyRelevantDecl(prop, decl.value);
        expect(cls.syntax, `${selector} { ${decl.prop}: ${decl.value} }`).toBe('canonical');
        seen.push(`${selector}|${decl.prop}: ${cls.value}`);
      }));
    }
    // 실측 고정(도출 근거 스냅샷): border 핀 6곳 + 인디케이터 핀 2곳 = relevant 선언 정확히 8개.
    expect(seen).toEqual([
      '.CanvasEditor|border: 1px solid var(--color-input-border)',
      '.CanvasEditorToolbar__ColorSwatch|border: 1px solid var(--color-input-border)',
      '.FilterBuilder__OpToggle|border: 1px solid var(--color-input-border)',
      '.MyTasks__ScopeToggle|border: 1px solid var(--color-input-border)',
      '.HomeTabs|border: 1px solid var(--color-input-border)',
      '.BrowseBranches__JoinBtn--joined|border: 1px solid var(--color-input-border)',
      '.HomeTabs__Tab.is-on|box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)',
      '.MyTasks__ScopeBtn--active|box-shadow: inset 0 0 0 1px var(--color-selected-indicator)',
    ]);
  });

  it('CANONICAL_DECLS 항목별 근거(pins)가 비어 있지 않다 — 근거 없는 canonical 확장 금지', () => {
    expect(CANONICAL_DECLS).toHaveLength(3);
    for (const entry of CANONICAL_DECLS) {
      expect(entry.pins.length, entry.id).toBeGreaterThan(0);
      expect(typeof entry.form, entry.id).toBe('string');
    }
  });
});

describe('핀 대상 컴포넌트 5파일 — 보호 토큰 네임스페이스 "선언" 전면 금지 (조상 스코프 오염 차단, 9라운드)', () => {
  // 위 PINNED가 이미 컴파일 중인 5파일(canvasEditor·taskList·myTasks·home-shared·browseBranches)은
  // var(--color-x) 같은 소비만 정상이다. `.Foo { --color-x: … }`처럼 어떤 selector에서든 보호
  // 네임스페이스를 재선언하면 그 조상 스코프 서브트리 전체의 캐스케이드 값을 오염시킨다 —
  // structuralGate와 동일한 판정(findProtectedDeclarations)을 컴파일된 사이트 CSS 전체에 적용해
  // 선언 자체의 존재를 금지한다(소비=var() 참조는 --접두 prop이 아니므로 애초에 안 걸린다).
  const PINNED_FILES = [
    'components/canvas/canvasEditor.scss',
    'components/branch/taskList.scss',
    'components/myTasks/myTasks.scss',
    'components/home/shared/home-shared.scss',
    'components/browse/browseBranches.scss',
  ];
  it.each(PINNED_FILES)('%s는 --color-/--track-/--shadow- 를 선언하지 않는다(소비만)', (file) => {
    const offenders = findProtectedDeclarations(compiledSiteCss(file));
    expect(offenders, `${file}에서 보호 토큰 선언 발견: ${offenders.join('; ')}`).toEqual([]);
  });
});

// .css 원문 정규화(Minor, 11라운드) — raw postcss 파싱은 escaped custom-property 이름
// (`--\63 olor-selected-indicator` = 유효 CSS, 실이름 --color-selected-indicator)을 리터럴 prop으로
// 남겨 hasProtectedPrefix(startsWith '--color-')를 우회시켰다(외부 검수 실증). Sass CSS-syntax 컴파일로
// 식별자 escape를 정규화한다 — 부분 hex 정규식·escape 수동 재구현 없이 파서에 위임한다. custom
// property는 스펙상 case-sensitive라 --Color-x는 그대로 보존되고(≠--color-x), var() 소비는 값이라 decl.prop
// 검사에 안 걸리며, `/* */` 블록주석은 Comment 노드로 분리돼 오검출되지 않는다. 컴파일 실패는 조용히
// 넘기지 않고 상위 sweepFileForProtectedDeclarations의 try/catch가 offender로 표면화해 RED로 떨어뜨린다.
function normalizeRawCss(source) {
  return compileString(String(source), { syntax: 'css' }).css;
}

// styles/ 아래 임의 파일(.scss는 컴파일, .css는 CSS-syntax 정규화)을 CSS 텍스트로 반환한다.
// scssCompileCache를 그대로 재사용해(relPath 키 공간이 겹치지 않으므로 안전) 핀 5파일과 캐시를
// 공유한다 — Important 1 수정 지시("컴파일 결과는 모듈 스코프 캐시(핀 5파일과 공유)로 1회만").
function siteCssText(relPath) {
  if (relPath.endsWith('.css')) {
    if (!scssCompileCache.has(relPath)) {
      scssCompileCache.set(relPath, normalizeRawCss(readFileSync(resolve(__dirname, '../styles', relPath), 'utf8')));
    }
    return scssCompileCache.get(relPath);
  }
  return compiledSiteCss(relPath);
}

// P4(Important 1, 외부 검수 10라운드) — 원문 스윕은 소스 정규식("같은 줄에서 이름:" 매칭) + .scss만
// 봐서 두 우회를 놓쳤다(외부 검수 실증): ① fonts.css(_app에서 _themes **뒤** import — 실측 확인,
// pages/_app.js: _themes.scss → globals.scss → fonts.css 순)에 보호 토큰 override를 넣어도 .css는
// 스윕 대상이 아니라 안 걸렸다. ② `--color-x`\n`: red;`처럼 콜론을 다음 줄로 보내면(유효 SCSS,
// 컴파일 결과는 동일) 같은-줄 정규식이 매치 실패했다. 컴파일(.scss) 또는 그대로(.css) → postcss AST
// walkDecls로 전환하면 원본 포맷(멀티라인·주석·중첩)과 무관하게 최종 선언만 보므로 두 우회 모두
// 구조적으로 막힌다 — findProtectedDeclarations(핀 5파일이 이미 쓰는 동일 판정 로직)를 styles/ 전체로
// 확장해 재사용한다(로직 중복·drift 방지). 고아 파일(_app 미import, 예: createIssue.scss)도 스윕
// 대상에 포함되지만 무해하다 — 선언 금지는 파일 로드 여부와 무관한 전역 계약이다. sass.compile
// 실패는 조용히 건너뛰지 않고(offender로 표면화) expect([]).toEqual([])를 RED로 떨어뜨린다.
function sweepFileForProtectedDeclarations(relPath) {
  try {
    return findProtectedDeclarations(siteCssText(relPath)).map((o) => `${relPath}: ${o}`);
  } catch (e) {
    return [`${relPath}: 컴파일/파싱 실패(FAIL로 표면화, 침묵 스킵 금지) — ${String((e && e.message) || e).split('\n')[0]}`];
  }
}

// P4 스윕 대상 판정(Important 2, 11라운드) — pure helper. 보호 토큰 선언 금지 계약의 대상 파일인가?
// 이전 필터는 `f.endsWith('_themes.scss')`로 예외를 걸어 루트 정본뿐 아니라 중첩 `components/example/
// _themes.scss`·접미 우연 일치 `components/rogue_themes.scss`까지 잘못 제외했다(외부 검수 실증). SCSS
// 예외는 루트 상대경로 exact '_themes.scss' **하나뿐**이어야 한다(endsWith 금지). .scss는 컴파일, .css는
// 정규화 후 AST 스윕 대상이며, 그 외 확장자는 대상이 아니다. 새 .scss/.css는 자동으로 포함된다.
function isProtectedSweepTarget(relPath) {
  if (relPath === '_themes.scss') return false; // 유일 예외: 토큰의 정본 거처(라이트/다크/별칭 3블록)
  return relPath.endsWith('.scss') || relPath.endsWith('.css');
}

describe('styles/ 전체 컴파일/AST 스윕 — 비핀 파일 보호 토큰 선언 금지 (P4, 컴파일 기반)', () => {
  const stylesDir = resolve(__dirname, '../styles');
  const allFiles = readdirSync(stylesDir, { recursive: true }).map(String);
  const targetFiles = allFiles.filter(isProtectedSweepTarget);

  // 확장자 커버리지를 "총개수 하한"으로 대체하지 않는다(Important 2) — 아래 exact 제외목록·역방향
  // 포함 단정이 실제 커버리지를 고정한다. 개수는 극단적 축소만 잡는 보조 신호로만 남긴다.
  it('스윕 대상 파일이 90개를 넘는다(극단 축소 보조 신호 — .scss 92 + .css 1 실측 기준)', () => {
    expect(targetFiles.length).toBeGreaterThan(90);
  });

  it('제외되는 .scss는 루트 정본 _themes.scss 하나뿐 (endsWith 우회 방지 — 중첩/접미 _themes.scss는 대상)', () => {
    const excludedScss = allFiles.filter((f) => f.endsWith('.scss') && !isProtectedSweepTarget(f));
    expect(excludedScss).toEqual(['_themes.scss']);
  });

  it('styles/**/*.css 전부가 스윕 대상에 포함된다 + fonts.css 직접 고정 (.css 분기 삭제 재발 검출)', () => {
    const allCss = allFiles.filter((f) => f.endsWith('.css'));
    expect(allCss.length, 'styles/ 아래 .css가 하나도 없다면 인벤토리 전제가 깨짐').toBeGreaterThan(0);
    for (const f of allCss) expect(targetFiles, `${f}가 스윕 대상에서 누락`).toContain(f);
    expect(targetFiles).toContain('fonts.css');
  });

  it('.css 분기를 뺀 대체 판정은 최소 하나의 .css를 놓친다 (누락 회귀를 역방향 포함 단정이 잡음을 확인)', () => {
    const withoutCssBranch = (relPath) => relPath !== '_themes.scss' && relPath.endsWith('.scss'); // .css 분기 제거 모사
    const mutated = allFiles.filter(withoutCssBranch);
    const allCss = allFiles.filter((f) => f.endsWith('.css'));
    expect(allCss.some((f) => !mutated.includes(f))).toBe(true);
  });

  it('.scss 전부(컴파일 후 AST)+.css 전부(정규화 후 파싱)가 --color-/--track-/--shadow- 를 선언하지 않는다', () => {
    const offenders = targetFiles.flatMap(sweepFileForProtectedDeclarations);
    expect(offenders, `보호 토큰 선언(또는 컴파일 실패) 발견: ${offenders.join('; ')}`).toEqual([]);
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
  // 엄격 CSS <number> 토큰만 허용(Important 1) — 느슨한 `[\d.]+`는 `1.`(trailing dot, CSS 불법 —
  // 브라우저는 이 선언을 폐기해 box-shadow가 none처럼 무효화된다)도 매치해 Number('1.')===1로
  // 정상 색상 취급했다(외부 검수 8라운드 실증). `\d+(?:\.\d+)?`(정수/소수)와 `\.\d+`(선행 점만) 두
  // 형태만 인정 — trailing dot·다중 소수점(`1.2.3`)·빈 채널은 전부 매치 실패로 null.
  const rgba = /^rgba?\(\s*(\d+(?:\.\d+)?|\.\d+)\s*,\s*(\d+(?:\.\d+)?|\.\d+)\s*,\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?\)$/.exec(str);
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

// 다크 셀렉터가 매칭 가능한 3가지 quote 변형(Sass 버전별 unquoted 출력 포함) — 파일 상단 주석 참고.
const DARK_SELECTORS = ['html[data-theme=dark]', "html[data-theme='dark']", 'html[data-theme="dark"]'];

// 보호 토큰 네임스페이스 — 이 접두사를 가진 custom property는 오직 flat 3블록(라이트/다크/별칭) 안에서만
// 선언될 수 있다. 어떤 selector·atrule로 감싸든(9라운드 이전에는 이 두 가지가 감시 목록 밖이라 통과했다)
// 이 세 블록 밖에서 나타나면 즉시 위반이다.
const PROTECTED_TOKEN_PREFIXES = ['--color-', '--track-', '--shadow-'];

// F1(12라운드) — 표준 CSS 식별자 escape 디코더. Sass는 내부 hex escape(--\63 olor-x)는 --color-x로
// 정규화하지만 **선행 하이픈**은 \- 형태로 재직렬화한다(\--color-x, -\-color-x, \2d -color-x→\--color-x,
// -\2d color-x→-\-color-x — 실측 확인). 이 escape 이름들은 전부 브라우저에서 --color-x로 해석되는 유효
// 선언인데 raw decl.prop이 startsWith('--color-')를 우회했다. 선행 escape 몇 개를 정규식으로 치환하는
// 접근은 leaky하므로(변종마다 뚫림) CSS Syntax Module의 escape 규칙대로 hex escape(\HH… 최대 6자리 +
// 선택 공백 1개)와 문자 escape(\X → X, 하이픈 포함)를 모두 해석해 의미 식별자를 복원한 뒤 접두를 검사한다.
// custom property는 스펙상 case-sensitive이므로 디코더는 대소문자를 보존한다(\43 →'C' → --Color-x 는
// 여전히 비보호). escape 없는 일반 prop(--color-x·border-color 등)은 그대로 반환(no-op)이라 무해하다.
function decodeCssIdentifier(ident) {
  const s = String(ident);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== '\\') { out += ch; i += 1; continue; }
    const next = s[i + 1];
    if (next === undefined) { out += '�'; break; } // 매달린 백슬래시 → U+FFFD(스펙)
    if (/[0-9a-fA-F]/.test(next)) {
      let hex = '';
      let j = i + 1;
      while (j < s.length && hex.length < 6 && /[0-9a-fA-F]/.test(s[j])) { hex += s[j]; j += 1; }
      if (j < s.length && /[ \t\n\f\r]/.test(s[j])) j += 1; // hex escape 뒤 공백 1개 소비
      const code = parseInt(hex, 16);
      out += (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) ? '�' : String.fromCodePoint(code);
      i = j;
    } else if (next === '\n' || next === '\f' || next === '\r') {
      i += 2; // 식별자 내 escaped newline은 방어적으로 무시
    } else {
      out += next; // 문자 escape: \X → X
      i += 2;
    }
  }
  return out;
}
function hasProtectedPrefix(prop) {
  const decoded = decodeCssIdentifier(prop);
  return PROTECTED_TOKEN_PREFIXES.some((p) => decoded.startsWith(p));
}

// FAIL 메시지에 위반 위치를 selector/atrule 체인(바깥→안, 예: `@media (min-width:0) > :root`)으로
// 이어붙인다 — 구조 게이트·컴포넌트 선언 금지 검사가 공유한다.
function describeLocation(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type !== 'root') {
    if (cur.type === 'rule') parts.unshift(cur.selector);
    else if (cur.type === 'atrule') parts.unshift(`@${cur.name}${cur.params ? ` ${cur.params}` : ''}`);
    cur = cur.parent;
  }
  return parts.join(' > ') || '(root)';
}

// 구조 계약(9라운드) — selector 문자열 열거(구 collectDarkSelectorRules)를 전면 폐기하고 _themes.scss의
// flat 3블록 계약을 postcss AST로 직접 강제한다. selector 열거 방식은 "감시할 selector 목록"을
// 유지하는 접근이었는데, 외부 검수가 그 목록 밖 selector로 두 가지 우회를 실증했다(둘 다 실렌더에서
// indicator 투명화를 일으키는데도 기존 방식으로는 37/37 GREEN이었다):
//  ① `@media (min-width:0){ :root { --color-selected-indicator: …0 !important } }` — `:root`는
//     DARK_SELECTORS 어떤 변형도 아니라서(선택자 문자열 자체가 다르다는 이유로) 다크 규칙으로
//     수집조차 안 됐다. 그런데 `:root`도 `html`에 적용되고 important가 승리하므로 실뷰포트에서는
//     이 규칙이 그대로 이긴다.
//  ② `@supports (display:block){ html[data-theme='dark']:root { …0 !important } }` — 이번엔 selector
//     문자열이 DARK_SELECTORS 어떤 변형과도 완전 동일 문자열이 아니라서(`:root` 접미가 붙어) 역시
//     안 걸렸다.
// 두 우회의 공통점은 "실렌더에서 이기는가"(root 직속 여부·important)와 무관하게 오직 "감시 목록에
// 있는 정확한 selector 문자열인가"만으로 판정했다는 것 — 그래서 selector 매칭 자체를 버리고, "보호
// 네임스페이스는 정해진 세 블록 밖 어디서도 선언될 수 없다"는 존재 자체 금지로 뒤집는다. selector가
// 무엇이든(`:root`든 `html[...]:root`든 그 무엇이든) 3블록 밖이면 무조건 FAIL — 우회 불가능한
// 화이트리스트(3블록만 예외)다.
function structuralGate(themesCss) {
  const root = postcss.parse(themesCss);
  const rootRules = [];
  root.walkRules((rule) => {
    if (rule.parent.type === 'root') rootRules.push(rule);
  });

  if (rootRules.length !== 3) {
    const where = rootRules
      .map((r) => `"${r.selector}"@${r.source?.start?.line}행`)
      .join(', ') || '(없음)';
    throw new Error(
      `_themes.scss 3블록 계약 위반: root 직속 규칙이 정확히 3개([라이트 :root, 다크 html[data-theme=dark], ` +
      `별칭 :root])여야 하는데 ${rootRules.length}개 발견 — ${where}`,
    );
  }

  const [lightRule, darkRule, aliasRule] = rootRules;
  const isPlainRoot = (rule) => rule.selectors.length === 1 && rule.selectors[0].trim() === ':root';
  const isDarkForm = (rule) =>
    rule.selectors.length === 1 && DARK_SELECTORS.includes(rule.selectors[0].replace(/\s+/g, ' ').trim());

  if (!isPlainRoot(lightRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 1번째 블록(라이트)은 ':root' 단독이어야 하는데 "${lightRule.selector}"(${lightRule.source?.start?.line}행)`);
  }
  if (!isDarkForm(darkRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 2번째 블록(다크)은 html[data-theme=dark] 계열(quote 무관) 단독이어야 하는데 "${darkRule.selector}"(${darkRule.source?.start?.line}행)`);
  }
  if (!isPlainRoot(aliasRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 3번째 블록(별칭)은 ':root' 단독이어야 하는데 "${aliasRule.selector}"(${aliasRule.source?.start?.line}행)`);
  }

  // 보호 토큰 네임스페이스 선언 전수 검사 — "위 3개 rule 노드와 identity가 같은가"로만 판정한다
  // (selector 문자열 재비교가 아니다). @media/@supports 등으로 감싸 selector 텍스트를 3블록과 완전히
  // 동일하게(①) 또는 다르게(②) 만들어도 그 rule 노드는 3블록과 별개 객체이므로 절대 우회 불가 —
  // walkDecls는 @media/@supports 등 atrule 내부·다른 selector·중첩 무관 전수를 방문한다.
  const legitBlocks = new Set(rootRules);
  const offenders = [];
  root.walkDecls((decl) => {
    if (!hasProtectedPrefix(decl.prop)) return;
    const inLegitBlock = decl.parent.type === 'rule' && legitBlocks.has(decl.parent);
    if (inLegitBlock) return;
    offenders.push(`${decl.prop}@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  if (offenders.length > 0) {
    throw new Error(
      `_themes.scss 3블록 계약 위반: 보호 토큰(${PROTECTED_TOKEN_PREFIXES.join('/')}) 선언이 3블록 밖에서 ` +
      `발견됨 — ${offenders.join('; ')}`,
    );
  }

  return { root, lightRule, darkRule, aliasRule };
}

// 핀 대상 컴포넌트(및 임의 사이트 파일)가 보호 네임스페이스를 "선언"하는지 전수 검사한다(9라운드).
// 이 파일들은 var(--color-x) 같은 소비만 정상이고, `.Foo { --color-x: … }`처럼 조상 스코프에
// 재선언하면 그 서브트리 전체의 캐스케이드 값을 오염시킨다 — 컴포넌트는 소비 전용 계약이다.
function findProtectedDeclarations(cssText) {
  const root = postcss.parse(cssText);
  const offenders = [];
  root.walkDecls((decl) => {
    if (!hasProtectedPrefix(decl.prop)) return;
    offenders.push(`${decl.prop}@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  return offenders;
}

// P3(역방향, 내부 리뷰 지적) — 위 스캔들은 전부 "보호 접두가 3블록 '밖'에서 선언되면 안 된다"는
// 한 방향만 본다. 반대 방향(3블록 '안'에 PROTECTED_TOKEN_PREFIXES 밖의 새 토큰 패밀리가 섞여도
// 아무도 안 잡는다)은 열린 구멍이었다 — 예: 4번째 접두(예: --spacing-)가 도입돼 3블록에 추가돼도
// findProtectedDeclarations/structuralGate 무엇도 감지 못한다. rules는 postcss Rule 노드 배열
// (구조 게이트가 반환한 lightRule/darkRule/aliasRule 또는 synthetic 단일 rule)이고, 각 rule의
// decl을 훑어 '--'로 시작하지만 보호 접두 3종 어디에도 안 속하는 선언을 offenders로 모은다.
// color-scheme 같은 일반 프로퍼티는 '--' 접두가 아니므로 애초에 대상이 아니다.
// I1(13라운드) — decl.prop을 **정확히 한 번 디코딩한 지역 변수**로 custom-property 여부와 보호 접두를
// 모두 판정한다. 이전엔 raw `decl.prop.startsWith('--')`를 디코딩 전에 검사해, 선행 하이픈이 escape된
// 이름(`\--unprotected-x`·`-\-unprotected-x`·`\2d -unprotected-x`·`-\2d unprotected-x` — 전부 디코딩
// 결과 --unprotected-x)이 raw로는 `--`로 시작하지 않아 탈락 → 역방향 게이트가 새 비보호 토큰 패밀리를
// 놓쳤다(offender 0). 기존 케이스(--\75 nprotected-x)는 raw가 이미 --로 시작해 이 구멍을 미검증했다.
// offender 메시지는 원문(raw) decl.prop을 유지한다(기존 계약).
function findUnprotectedDeclarations(rules) {
  const offenders = [];
  for (const rule of rules) {
    rule.walkDecls((decl) => {
      const decoded = decodeCssIdentifier(decl.prop); // 정확히 한 번 디코딩
      if (!decoded.startsWith('--')) return; // 디코딩값으로 custom-property 판정
      if (!PROTECTED_TOKEN_PREFIXES.some((p) => decoded.startsWith(p))) offenders.push(`${decl.prop}@${decl.source?.start?.line}행`);
    });
  }
  return offenders;
}

// P2(내부 리뷰, 기록만·코드 변경 없음): 위 스캔들(findProtectedDeclarations·structuralGate·
// findUnprotectedDeclarations)은 전부 decl.prop(일반 선언)만 본다 — CSS `@property --color-x {
// syntax: '<color>'; inherits: false; initial-value: #fff; }` 같은 typed custom property 등록
// at-rule은 프로퍼티명이 atrule.params에 있고 내부는 syntax/inherits/initial-value라는 별개
// 디스크립터 decl이라 이 형태를 아무도 감지하지 못한다. 현재 레포에 @property 사용처가 없어 실피해는
// 없으나, 도입 시 이 구멍이 열린다 — 향후 과제로만 기록, 이번 라운드는 미대응.

// structuralGate가 보장한 darkRule 하나에 cascade(reduceEffectiveDecls — !important 우선, 동급은
// 후행 승리)를 적용해 "다크 블록의 최종 유효 커스텀 프로퍼티 값" 맵을 만든다. 다크 selected-indicator
// 대비 단정(아래)과 대칭 구멍 B의 --color-input-border(-hover) 대비 단정이 이 헬퍼를 공유한다(로직
// 중복·drift 방지) — prop 키는 "--" 접두를 뗀 형태(예: "color-bg")로 정규화해 둔다.
function buildDarkValues(themesCss) {
  const { darkRule } = structuralGate(themesCss);
  const darkState = reduceEffectiveDecls([darkRule], (decl, prop) => prop.startsWith('--'));
  const values = {};
  for (const [prop, { value }] of Object.entries(darkState)) values[prop.slice(2)] = value;
  return values;
}

describe('_themes.scss 구조 계약 — flat 3블록 강제 (selector 매칭→구조 게이트 전환, 9라운드)', () => {
  it('실 파일이 3블록 계약을 만족한다(형태·순서·보호 토큰 3블록 밖 배타성)', () => {
    expect(() => structuralGate(css)).not.toThrow();
  });
});

describe('3블록 내 모든 custom property는 보호 접두 3종 중 하나 (P3 — 역방향 완전성)', () => {
  it('라이트/다크/별칭 블록의 모든 --custom-property가 --color-/--track-/--shadow- 중 하나로 시작한다', () => {
    const { lightRule, darkRule, aliasRule } = structuralGate(css);
    const offenders = findUnprotectedDeclarations([lightRule, darkRule, aliasRule]);
    expect(
      offenders,
      `보호 접두 밖 토큰 발견 — 새 토큰 패밀리면 PROTECTED_TOKEN_PREFIXES에 추가하라: ${offenders.join('; ')}`,
    ).toEqual([]);
  });
});

describe('다크 selected-indicator 값 시맨틱 고정 (SC 1.4.11 비텍스트 대비 3:1)', () => {
  // 9라운드: dark 블록의 존재·유일성·root-직속 여부·형태(selector 문자열)는 이제 structuralGate
  // (flat 3블록 계약, 파일 상단 참고)가 구조적으로 보장한다 — 위반 시 이 시점에 즉시 throw(위치
  // 포함 명시 메시지)한다. 구 collectDarkSelectorRules의 selector 열거 방식은 폐기됐다: 그 방식은
  // "감시할 selector 문자열 목록"에 의존해 목록 밖 selector(`:root`, `html[...]:root` 등)로 감싼
  // 우회를 놓쳤지만, structuralGate는 selector가 무엇이든 3블록 밖 보호 토큰 선언 자체를 금지하므로
  // 우회 불가능하다. 여기서는 구조가 보장된 darkRule 하나에 캐스케이드(reduceEffectiveDecls —
  // !important 우선, 동급은 후행 승리 — 실제 CSS cascade와 동일)를 적용해 darkValues를 합성한다 —
  // darkRule "내부"의 중복 선언에도 !important가 개입할 수 있어 단순 후행 승리로는 부족하다(외부
  // 검수 7라운드 실증). buildDarkValues는 대칭 구멍 B(아래 --color-input-border 대비 describe)와
  // 공유하는 모듈 헬퍼다.
  const darkValues = buildDarkValues(css);

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

describe('다크 --color-input-border(-hover) 대비 고정 (대칭 구멍 B — 컨트롤러 탐색, 10라운드)', () => {
  // indicator(위 describe)만 대비 단정이 있었고 컨트롤 경계 토큰 자체(승격핀 6곳 중 5곳이 실제로
  // 소비하는 --color-input-border)는 무보호였다 — 다크 값을 --color-border(#26282E, 비-input 톤)로
  // 강등해도 대비 단정이 하나도 없어 전 테스트가 GREEN이었다(Task 6 "다크 대비 보정"의 존재 이유가
  // 무너지는 회귀). 알파 선합성 경로(compositeOver/contrastOverBg)를 그대로 재사용해 두 토큰 각각을
  // bg·surface·input-bg 3가지 배경과 3:1 이상으로 고정한다.
  const darkValues = buildDarkValues(css);
  const BG_TOKENS = ['color-bg', 'color-surface', 'color-input-bg'];
  const BORDER_TOKENS = ['color-input-border', 'color-input-border-hover'];
  for (const borderToken of BORDER_TOKENS) {
    for (const bgToken of BG_TOKENS) {
      it(`${borderToken} vs ${bgToken} 3:1 이상`, () => {
        expect(
          contrastOverBg(darkValues[borderToken], darkValues[bgToken]),
          `${borderToken}=${darkValues[borderToken]} vs ${bgToken}=${darkValues[bgToken]}`,
        ).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

// 게이트 자체 상설 검증 — 이전 라운드들은 각 결함을 "실파일을 임시로 훼손 → vitest 실행 → 복원"하는
// 수동 시뮬로만 검증했다(재현 스크립트가 안 남아 다음 라운드가 같은 결함을 다시 심어도 못 잡았다).
// 여기서는 postcss.parse한 합성 CSS 문자열로 헬퍼(parseColor/structuralGate/findProtectedDeclarations/
// reduceEffectiveDecls + 17R 신설 canonical 매처/층 2 evaluator)를 직접 단정해, 시뮬 재현 없이도 이후
// 라운드의 회귀를 상시 검출한다 — 8·9라운드 외부 검수 대응.
describe('게이트 자체 검증 (synthetic CSS)', () => {
  describe('parseColor — 엄격 CSS number (Important 1)', () => {
    it('trailing dot(1.)은 CSS 불법 number — null', () => {
      expect(parseColor('rgba(107,114,128,1.)')).toBeNull();
    });
    it('스펙 밖 alpha(10)는 파싱되고 clamp로 a=1', () => {
      expect(parseColor('rgba(60,60,60,10)')).toEqual({ r: 60, g: 60, b: 60, a: 1 });
    });
    it('leading dot(.5)은 유효 CSS number', () => {
      expect(parseColor('rgba(0,0,0,.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    });
    it('음수 채널은 애초에 정규식 매치 실패 — null', () => {
      expect(parseColor('rgba(-1,0,0,1)')).toBeNull();
    });
    it('다중 소수점(1.2.3)·빈 채널은 매치 실패 — null', () => {
      expect(parseColor('rgba(1.2.3,0,0,1)')).toBeNull();
      expect(parseColor('rgba(,0,0,1)')).toBeNull();
    });
  });

  describe('structuralGate — flat 3블록 계약 + 보호 토큰 3블록 밖 배타성 (Important, 9라운드)', () => {
    // 검수 실증 우회 ①·②는 둘 다 selector 열거(구 collectDarkSelectorRules)의 "감시 목록에 없는
    // selector"를 타고 들어왔다 — 아래 두 케이스는 그 정확한 재현이다. structuralGate는 selector
    // 문자열이 무엇이든 3블록 밖 보호 토큰 선언 자체를 금지하므로 두 우회 모두 FAIL해야 한다.
    it('정상 3블록이면 통과하고 darkRule을 반환한다', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      const { darkRule } = structuralGate(cssText);
      expect(darkRule.selector).toBe(`html[data-theme='dark']`);
    });
    it('우회① media-:root — :root도 html에 적용되고 important가 승리하는데 선택자 목록 밖이라 놓쳤던 케이스, 이제 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        @media (min-width: 0px) {
          :root { --color-selected-indicator: rgba(0,0,0,0) !important; }
        }
      `;
      expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
    });
    it('우회② @supports dark:root — DARK_SELECTORS 어떤 변형과도 문자열이 달라 놓쳤던 케이스, 이제 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        @supports (display: block) {
          html[data-theme='dark']:root { --color-selected-indicator: rgba(0,0,0,0) !important; }
        }
      `;
      expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
    });
    it('4번째 root 블록이 있으면 블록 개수 불일치로 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        :root { --color-c: 4; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/3블록/);
    });
    it('!important가 후행 non-important를 이긴다(다크 블록 내부 cascade, custom property도 동일 규칙)', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --x: A !important; --x: B; }
        :root { --color-b: 3; }
      `;
      const { darkRule } = structuralGate(cssText);
      const state = reduceEffectiveDecls([darkRule], (decl, prop) => prop.startsWith('--'));
      expect(state['--x'].value).toBe('A');
    });

    // synthetic 보충(concern 2, 내부 리뷰) — 순서/형태 오류 각 1건을 명시 FAIL로 단정한다.
    it('블록 순서가 뒤바뀌면(다크가 1번째) FAIL', () => {
      const cssText = `
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-a: 1; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/1번째 블록\(라이트\)/);
    });
    it('블록이 다중 셀렉터(:root, .Sneak)면 단독 :root가 아니므로 FAIL', () => {
      const cssText = `
        :root, .Sneak { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/1번째 블록\(라이트\)/);
    });
    it("2번째 블록이 html[data-theme='dark']:root 형태(:root 접미 오염)면 FAIL", () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark']:root { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/2번째 블록\(다크\)/);
    });
  });

  describe('findProtectedDeclarations — 컴포넌트 보호 토큰 "선언" 금지 (9라운드)', () => {
    it('.Foo{--color-x:red} 처럼 조상 스코프 재선언은 FAIL 대상 목록에 잡힌다', () => {
      const offenders = findProtectedDeclarations('.Foo { --color-x: red; }');
      expect(offenders.length).toBe(1);
      expect(offenders[0]).toMatch(/--color-x/);
    });
    it('var() 참조로 소비만 하면 통과 — 빈 배열', () => {
      const offenders = findProtectedDeclarations('.Foo { border-color: var(--color-x); }');
      expect(offenders).toEqual([]);
    });
  });

  describe('P4 컴파일 기반 스윕 synthetic (Important 1, 10라운드) — 원문 정규식이 놓친 우회 재현', () => {
    // 실 레포는 위반 0건이라 실 스윕(위 "styles/ 전체 컴파일/AST 스윕")만으로는 FAIL 분기가 한 번도
    // 실행되지 않는다 — compileString(파일 I/O 없이 SCSS 문자열을 바로 컴파일)으로 합성 소스를 만들어
    // findProtectedDeclarations/sweepFileForProtectedDeclarations의 FAIL·엣지 경로를 직접 검증한다.
    it('멀티라인 선언(콜론이 다음 줄)도 컴파일 후 AST로 검출 — 원문 같은-줄 정규식은 이 케이스를 놓쳤다', () => {
      const cssText = compileString('.Foo {\n  --color-x\n    : red;\n}\n').css;
      expect(findProtectedDeclarations(cssText)).toHaveLength(1);
    });
    it('블록주석(/* --color-x: red; */) 내부 텍스트는 Comment 노드라 선언으로 오검출 안 함', () => {
      const cssText = compileString('.Foo {\n  /* --color-x: red; */\n  color: blue;\n}\n').css;
      expect(findProtectedDeclarations(cssText)).toEqual([]);
    });
    it('.css 파일(합성, fonts.css 우회 재현) — postcss.parse 직접으로도 보호 토큰 선언 검출', () => {
      const cssText = ':root { --color-selected-indicator: red; }';
      expect(findProtectedDeclarations(cssText)).toEqual(['--color-selected-indicator@1행(위치: :root)']);
    });
    it('소비(var(--color-x))는 선언이 아니므로 무시(기존 findProtectedDeclarations 계약 재확인)', () => {
      const cssText = compileString('.Foo { border-color: var(--color-x); }\n').css;
      expect(findProtectedDeclarations(cssText)).toEqual([]);
    });
    it('sweepFileForProtectedDeclarations — sass 컴파일 실패(존재하지 않는 파일)는 침묵 스킵 대신 offender로 표면화', () => {
      const offenders = sweepFileForProtectedDeclarations('__does-not-exist__.scss');
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatch(/__does-not-exist__\.scss: 컴파일\/파싱 실패/);
    });
  });

  describe('isProtectedSweepTarget — P4 스윕 대상 판정 (Important 2, 11라운드)', () => {
    it('루트 정본 _themes.scss(exact)만 예외 — false', () => {
      expect(isProtectedSweepTarget('_themes.scss')).toBe(false);
    });
    it('중첩 components/example/_themes.scss는 대상 — true (endsWith 우회 없음)', () => {
      expect(isProtectedSweepTarget('components/example/_themes.scss')).toBe(true);
    });
    it('접미 우연 일치 components/rogue_themes.scss도 대상 — true', () => {
      expect(isProtectedSweepTarget('components/rogue_themes.scss')).toBe(true);
    });
    it('fonts.css(.css 커버리지)도 대상 — true', () => {
      expect(isProtectedSweepTarget('fonts.css')).toBe(true);
    });
    it('비 scss/css(예: .js)는 대상 아님 — false', () => {
      expect(isProtectedSweepTarget('components/foo.js')).toBe(false);
    });
  });

  describe('normalizeRawCss — raw .css escaped custom-property 정규화 (Minor, 11라운드)', () => {
    // 원문 raw 파싱은 `--\63 olor-…`(유효 CSS, 실이름 --color-…)를 리터럴 prop으로 남겨 보호 접두 검사를
    // 우회시켰다. Sass CSS-syntax 컴파일로 식별자 escape를 정규화한 뒤 findProtectedDeclarations에 태운다.
    it('escaped 선언(--\\63 olor-…)이 정규화 후 실이름 --color-selected-indicator로 검출된다', () => {
      const norm = normalizeRawCss(':root { --\\63 olor-selected-indicator: red; }');
      const offenders = findProtectedDeclarations(norm);
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatch(/--color-selected-indicator/);
    });
    it('일반(비escape) 보호 선언도 그대로 검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss(':root { --color-x: red; }'))).toHaveLength(1);
    });
    it('--Color-…(대문자)는 case-sensitive 유지 → 보호 접두(--color-) 아니므로 미검출(오검출 방지)', () => {
      expect(findProtectedDeclarations(normalizeRawCss(':root { --Color-x: red; }'))).toEqual([]);
    });
    it('블록주석 안 escaped 선언은 Comment 노드라 미검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss('.Foo { /* --\\63 olor-x: red; */ color: blue; }'))).toEqual([]);
    });
    it('소비(var(--\\63 olor-x))는 선언이 아니라 값이므로 미검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss('.Foo { border-color: var(--\\63 olor-x); }'))).toEqual([]);
    });
  });

  describe('keyIntersection — 별칭·라이트 교집합 판정 (P1 synthetic)', () => {
    it('별칭이 라이트 키를 재선언하면 교집합에 잡힌다(specificity 동일 → 후행 재선언이 침묵 오염)', () => {
      const lightKeys = new Set(['color-a', 'color-b']);
      const aliasKeys = new Set(['color-a', 'color-c']);
      expect(keyIntersection(aliasKeys, lightKeys)).toEqual(['color-a']);
    });
    it('배타적이면 빈 배열', () => {
      expect(keyIntersection(new Set(['color-c']), new Set(['color-a', 'color-b']))).toEqual([]);
    });
  });

  describe('findUnprotectedDeclarations — 보호 접두 역방향 판정 (P3 synthetic)', () => {
    it('보호 접두 밖 토큰(--brand-new)을 검출', () => {
      const root = postcss.parse(':root { --color-a: 1; --brand-new: 2; }');
      const offenders = findUnprotectedDeclarations([root.first]);
      expect(offenders).toEqual(['--brand-new@1행']);
    });
    it('보호 접두 3종만 있으면 빈 배열', () => {
      const root = postcss.parse(':root { --color-a: 1; --track-b: 2; --shadow-c: 3; }');
      expect(findUnprotectedDeclarations([root.first])).toEqual([]);
    });
    it('일반 프로퍼티(color-scheme 등)는 애초에 대상 아님', () => {
      const root = postcss.parse(':root { color-scheme: light; --color-a: 1; }');
      expect(findUnprotectedDeclarations([root.first])).toEqual([]);
    });
  });

  // ── 17R 전환: 아래 4개 describe는 폐기된 grammar 모델 헬퍼(outermostVarTokens·splitTopLevelLayers·
  //    assertVisibleInsetShadowLayer·synthesizeBorderSides 계열)의 단위 단정이었다. **계약 의미는
  //    보존하되** 판정 주체를 canonical 매처/층 2 evaluator로 이관한다 — 각 벡터가 "canonical이 아니라서
  //    RED"임을 그 자체 상태로 단정하므로 기존 계약(중첩 var 미수집·fallback 텍스트 오매치·spread 0
  //    비가시·네 면 소실 등)이 전부 같은 결론으로 유지된다.
  describe('canonical var 원자 — 구 outermostVarTokens/topLevelVarTokens 계약 이관(10~15R 벡터 보존)', () => {
    // 구 계약: "최상위 var()의 첫 인자만 수집, 중첩/fallback·유사 함수명은 미수집".
    // 신 계약: canonical 토큰 참조는 **정확히 `var(--name)`** 뿐이다 — 아래 변종은 전부 비-canonical.
    it.each([
      ['fallback + 중첩 var(10R r5)', 'var(--a, "(", var(--b))'],
      ['값 전체가 문자열', '"var(--x)"'],
      ['비ASCII 접두 함수명(λvar)', 'λvar(--x)'],
      ['식별자 접미 함수명(fakevar)', 'fakevar(--x)'],
      ['escaped 식별자 함수명(fake\\ var)', 'fake\\ var(--x)'],
      ['calc 안 var + 콤마 나열', 'calc(1px + var(--a)), var(--b)'],
      ['fallback 안 escape', 'var(--a, \\(, var(--b))'],
      ['문자열 밖 escaped quote', '\\" , var(--x)'],
      ['콤마 없는 잔여 인자(13R I2a)', 'var(--color-input-border garbage)'],
      ['fallback 있는 var(12R/13R GREEN이었음)', 'var(--x, #ccc)'],
      ['중첩 malformed fallback(14R I3)', 'var(--color-input-border, var(--bad garbage))'],
      ['정상 중첩 fallback(14R I3 대조, 이전 GREEN)', 'var(--color-input-border, var(--fallback))'],
      ['대문자 VAR()(14R I3에서 인정했던 형태)', 'VAR(--x)'],
      ['비ASCII dashed-ident(15R I4)', 'var(--é)'],
      ['언더스코어 dashed-ident(14R I3)', 'var(--_name)'],
      ['escape 포함 이름(15R I4)', 'var(--\\65 x)'],
    ])('%s 는 canonical 토큰 참조가 아니다 → border color 자리에서 RED', (_label, value) => {
      expect(CANON_SHADOW_OPAQUE_LAYER_RE.test(normalizeDeclValue(value))).toBe(false);
      expect(classifyRelevantDecl('border', `1px solid ${value}`).syntax).toBe('non-canonical');
    });
    it('GREEN(무회귀): 정확한 var(--name)만 canonical 토큰 참조', () => {
      expect(canonicalNeedleToken('var(--color-input-border)')).toBe('color-input-border');
      expect(canonicalNeedleToken(' var(--color-selected-indicator) ')).toBe('color-selected-indicator');
      expect(() => canonicalNeedleToken('var(--x, #ccc)')).toThrow(/canonical/);
    });
  });

  describe('canonical box-shadow 레이어 분해 — 구 splitTopLevelLayers 계약 이관', () => {
    it('단일 레이어(핀 형태)는 레이어 1개로 모델링', () => {
      const layers = canonicalShadowLayers('inset 0 0 0 1px var(--x)');
      expect(layers).toHaveLength(1);
      expect(layers[0]).toEqual({ kind: 'inset', offsetX: 0, offsetY: 0, blur: 0, spread: 1, token: 'x' });
    });
    it('다중 그림자(HomeTabs 핀)는 최상위 콤마로만 분해 — var() 내부 콤마와 혼동 없음(fallback var는 애초에 canonical 아님)', () => {
      const layers = canonicalShadowLayers('var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)');
      expect(layers.map((l) => l.kind)).toEqual(['opaque-var', 'inset']);
      expect(layers[0].token).toBe('shadow-xs');
      expect(layers[1].token).toBe('color-selected-indicator');
    });
    it('canonical이 아닌 값은 분해 자체를 하지 않는다(null) — 조각이 canonical처럼 보이는 우회 차단', () => {
      expect(canonicalShadowLayers('foo(a, inset 0 0 0 1px var(--t))')).toBeNull();
      expect(canonicalShadowLayers('var(--shadow-xs) , junk')).toBeNull();
      expect(canonicalShadowLayers('none')).toBeNull();
    });
  });

  describe('canonical 인디케이터 가시성 — 구 assertVisibleInsetShadowLayer 계약 이관(10~13R 벡터 보존)', () => {
    const IND = 'color-selected-indicator';
    const ivis = (value) => evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible;
    it('정상 형태(inset+4 length+spread>0)는 visible', () => {
      expect(ivis(`inset 0 0 0 2px var(--${IND})`)).toBe(true);
    });
    it.each([
      ['var(--t) 단독 레이어(치환 후 불법값이면 선언 무효화)', 'var(--color-selected-indicator)'],
      ['spread 0(렌더 폭 없음)', 'inset 0 0 0 0 var(--color-selected-indicator)'],
      ['inset 키워드 없음(outset 그림자)', '0 0 0 2px var(--color-selected-indicator)'],
      ['length 4개 미만(spread 없음)', 'inset 0 0 2px var(--color-selected-indicator)'],
      ['unitless 비영 spread(불법 CSS)', 'inset 0 0 0 5 var(--color-selected-indicator)'],
      ['1% spread(% 불허)', 'inset 0 0 0 1% var(--color-selected-indicator)'],
      ['negative blur', 'inset 0 0 -1px 1px var(--color-selected-indicator)'],
      ['length 5개(개수 초과)', 'inset 0 0 0 1px 2px var(--color-selected-indicator)'],
      ['stray word 잔여(junk)', 'inset 0 0 0 1px junk var(--color-selected-indicator)'],
      ['미지원 함수 잔여(calc)', 'inset 0 0 0 1px calc(2px) var(--color-selected-indicator)'],
      ['top-level slash div 잔여', 'inset 0 0 0 / 1px var(--color-selected-indicator)'],
    ])('RED: %s', (_label, value) => {
      expect(ivis(value)).toBe(false);
    });
    it('spread 0은 canonical이지만 층 2 가시성 계산에서 탈락한다(층 분리 확인)', () => {
      const cls = classifyRelevantDecl('box-shadow', `inset 0 0 0 0 var(--${IND})`);
      expect(cls.syntax).toBe('canonical');
      expect(cls.layers[0].spread).toBe(0);
      expect(ivis(`inset 0 0 0 0 var(--${IND})`)).toBe(false);
    });
    it('무회귀: 단위 있는 spread(1px)는 offset/blur가 0이어도 계속 visible', () => {
      expect(ivis(`inset 0 0 0 1px var(--${IND})`)).toBe(true);
    });
  });

  describe('canonical border 가시성 + 구 4면 cascade 엔진 계약 이관(11R 대칭 구멍 A)', () => {
    const TOKEN = 'color-input-border';
    const V = 'var(--color-input-border)';
    it('canonical shorthand는 width>0·토큰 일치일 때만 가시(층 2 계산)', () => {
      expect(evalBorderScss(`.X{border:1px solid ${V}}`, TOKEN).visible).toBe(true);
      expect(evalBorderScss(`.X{border:0 solid ${V}}`, TOKEN).visible).toBe(false); // canonical이나 width 0
      expect(evalBorderScss(`.X{border:1px solid var(--color-border)}`, TOKEN).visible).toBe(false); // 다른 토큰
    });
    it('canonical 판정과 가시성 계산은 분리된 층이다 — width 0도 syntax는 canonical', () => {
      const cls = classifyRelevantDecl('border', `0 solid ${V}`);
      expect(cls.syntax).toBe('canonical');
      expect(cls.border).toEqual({ width: 0, style: 'solid', token: TOKEN });
    });
    it('비가시 style(none/hidden)은 canonical 밖 — 선언 존재 자체가 RED', () => {
      expect(classifyRelevantDecl('border', `1px none ${V}`).syntax).toBe('non-canonical');
      expect(classifyRelevantDecl('border', `1px hidden ${V}`).syntax).toBe('non-canonical');
    });
    it('여러 root 규칙(문서 순서)에 걸쳐도 relevant 선언 전수를 본다 — 후행 규칙의 비-canonical이 RED로 이긴다', () => {
      expect(evalBorderScss(`.X{border:1px solid ${V}} .X{border-bottom-width:0}`, TOKEN).visible).toBe(false);
    });
    it('border-radius/border-collapse/border-spacing은 relevant 아님(경계 무관) — 그 외 border-*는 relevant', () => {
      expect(isRelevantProp('border-radius')).toBe(false);
      expect(isRelevantProp('border-top-left-radius')).toBe(false);
      expect(isRelevantProp('border-collapse')).toBe(false);
      expect(isRelevantProp('border-spacing')).toBe(false);
      expect(isRelevantProp('border')).toBe(true);
      expect(isRelevantProp('border-width')).toBe(true);
      expect(isRelevantProp('border-image-source')).toBe(true);
      expect(isRelevantProp('border-inline-width')).toBe(true); // 논리 프로퍼티 fail-closed(15R 계약)
      expect(isRelevantProp('border-future-thing')).toBe(true); // 미지 border-* 도 relevant(fail-closed)
      expect(isRelevantProp('box-shadow')).toBe(true);
      expect(isRelevantProp('all')).toBe(true);
      expect(isRelevantProp('color')).toBe(false);
      expect(isRelevantProp('--dead-border')).toBe(false);
    });
    it('border-radius만 있으면 border 선언이 전무 → initial(비가시) RED', () => {
      expect(evalBorderScss('.X{border-radius:8px;border-collapse:collapse}', TOKEN).visible).toBe(false);
    });
    it('조건부 문맥(@media) 안 동일 셀렉터의 relevant 선언은 모델 불가로 표면화된다(구 수집 누락 폐쇄)', () => {
      const cssText = `.X{border:1px solid ${V}}@media (min-width:0px){.X{border:none}}`;
      const res = evalBorderCss(cssText, TOKEN);
      expect(res.visible).toBe(false);
      expect(res.unmodelable.join(' ')).toMatch(/조건부 문맥/);
    });
    it('조건부 문맥이라도 relevant 아닌 선언만 있으면 무해(과잉 RED 방지)', () => {
      const cssText = `.X{border:1px solid ${V}}@media (min-width:0px){.X{border-radius:4px}}`;
      expect(evalBorderCss(cssText, TOKEN).visible).toBe(true);
    });
  });

  describe('대칭 구멍 B synthetic — --color-input-border 다크 강등값이 대비 단정에 실제로 걸린다', () => {
    // 실 레포 현재 값(#6B7280 on #0E0F11 계열)은 위 실파일 describe에서 이미 GREEN으로 고정됐다 —
    // 여기서는 "만약 --color-border(비-input 톤, #26282E)로 강등되면 이 단정이 실제로 RED가 되는가"를
    // darkValues 재구성 없이 대비 함수를 직접 단정해 검증한다(합성 CSS로 강등값을 재현).
    it('강등값(#26282E, 일반 border 톤) vs 실제 다크 bg(#0E0F11)는 3:1 미만 — 대비 단정이 실제로 이 회귀를 잡는다', () => {
      const degraded = '#26282E';
      const darkBg = buildDarkValues(css)['color-bg'];
      expect(contrastOverBg(degraded, darkBg)).toBeLessThan(3);
    });
  });

  describe('reduceEffectiveDecls — prop 정규화 (Minor 2)', () => {
    it('일반 property는 case-insensitive 통합 — BORDER 뒤 border가 후행 승리', () => {
      const root = postcss.parse('.x { BORDER: none; border: 1px solid red; }');
      const state = reduceEffectiveDecls([root.first], () => true);
      expect(Object.keys(state)).toEqual(['border']);
      expect(state.border.value).toBe('1px solid red');
    });
    it('커스텀 프로퍼티는 case-sensitive 유지 — --Foo와 --foo는 별개 키', () => {
      const root = postcss.parse('.x { --Foo: A; --foo: B; }');
      const state = reduceEffectiveDecls([root.first], () => true);
      expect(state['--Foo'].value).toBe('A');
      expect(state['--foo'].value).toBe('B');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12라운드 회귀 게이트(보존분) — 식별자 디코더 계열은 이번 전환 대상이 아니다(핀 외 게이트). 보호 토큰
// 네임스페이스·cascade prop 정규화는 그대로 유지된다.
// ─────────────────────────────────────────────────────────────────────────────

describe('12R F1 — escaped 선행 하이픈 보호 토큰 우회 (표준 식별자 디코더)', () => {
  // Sass는 내부 hex(--\63 olor-x)는 --color-x로 정규화하지만 선행 하이픈은 \- 로 재직렬화한다
  // (\--color-x, -\-color-x, \2d -color-x→\--color-x, -\2d color-x→-\-color-x). 이 escape 이름들은
  // 전부 Chrome에서 --color-x로 해석되는 유효 선언인데 decl.prop raw가 startsWith('--color-')를
  // 우회했다 — 표준 CSS 식별자 디코더로 의미값을 복원해 검출한다. raw .css(normalizeRawCss) +
  // compiled .scss(compileString) 양쪽 P4 경로를 모두 검증한다.
  const rawDetect = (prop) => findProtectedDeclarations(normalizeRawCss(`:root { ${prop}: red; }`));
  const scssDetect = (prop) => findProtectedDeclarations(compileString(`.Foo { ${prop}: red; }`).css);
  it.each([
    ['\\--color-x'],
    ['-\\-color-x'],
    ['\\2d -color-x'],
    ['-\\2d color-x'],
  ])('raw .css: %s 는 실이름 --color-…로 검출된다(RED)', (prop) => {
    expect(rawDetect(prop)).toHaveLength(1);
  });
  it('compiled .scss 경로: \\--color-x 도 검출된다(RED)', () => {
    expect(scssDetect('\\--color-x')).toHaveLength(1);
  });
  it('기존 내부 hex(--\\63 olor-x)도 계속 검출(GREEN 유지)', () => {
    expect(rawDetect('--\\63 olor-x')).toHaveLength(1);
  });
  it('--Color-x(대문자)는 case-sensitive 비보호 → 미검출(GREEN 유지, 오검출 방지)', () => {
    expect(rawDetect('--Color-x')).toEqual([]);
  });
  it('escaped 대문자(-\\43 olor-x=-Color-x)도 case-sensitive 비보호 → 미검출(GREEN)', () => {
    // M2 주석 오기 정정 — 입력은 `-\43 olor-x`: 선행 `-` + \43(=0x43='C') + `olor-x` = **-Color-x**
    // (단일 하이픈, --Color-x 아님). custom property도 아니고 보호 접두도 아니라 미검출이 맞다.
    expect(rawDetect('-\\43 olor-x')).toEqual([]);
  });
  it('블록주석 안 escaped 이름은 Comment 노드라 미검출(GREEN)', () => {
    expect(findProtectedDeclarations(normalizeRawCss('.Foo { /* \\--color-x: red; */ color: blue; }'))).toEqual([]);
  });
  it('소비(var(\\--color-x))는 값이라 미검출(GREEN)', () => {
    expect(findProtectedDeclarations(normalizeRawCss('.Foo { border-color: var(\\--color-x); }'))).toEqual([]);
  });
});

// F1의 decodeCssIdentifier는 hasProtectedPrefix에만 배선되고 normalizeProp(cascade predicate·state 키)
// 에는 미적용이었다(내부 리뷰 실증, 12라운드) — escaped 선언이 reduceEffectiveDecls/핀 relevant 수집
// 양쪽에서 predicate 탈락으로 cascade에서 통째로 실종됐다. normalizeProp이 decodeCssIdentifier로 먼저
// 디코딩하도록 고치면 두 소비처(다크 cascade·핀 relevant 판정)가 한 번에 닫힌다.
// 17R 전환 후에도 이 배선은 **필수**다: escaped `\42order`가 relevant 판정을 우회하면 canonical 게이트
// 자체가 그 선언을 못 보고 지나친다(= canonical 매칭 우회 경로). 아래 세 번째 it이 그 폐쇄를 고정한다.
describe('12R F5 — normalizeProp CSS 식별자 디코더 선통과 (relevant 수집 우회 폐쇄)', () => {
  const escapedIndicatorThemes = `
    :root { --color-bg: #FFFFFF; --color-selected-indicator: transparent; }
    html[data-theme=dark] {
      --color-bg: #0E0F11;
      --color-selected-indicator: #6B7280;
      \\--color-selected-indicator: transparent;
    }
    :root { --color-alias-unused: 0; }
  `;

  it('다크 블록: 후행 escaped 선언(\\--color-selected-indicator: transparent)이 cascade에서 승리 — stale #6B7280이 아니라 transparent가 최종값', () => {
    const darkValues = buildDarkValues(escapedIndicatorThemes);
    expect(darkValues['color-selected-indicator']).toBe('transparent');
  });

  it('위 escaped 후행 선언 채택 시 인디케이터 vs bg 대비가 3:1 미만(RED) — transparent 합성이 대비 단정을 실제로 무너뜨린다', () => {
    const darkValues = buildDarkValues(escapedIndicatorThemes);
    expect(contrastOverBg(darkValues['color-selected-indicator'], darkValues['color-bg'])).toBeLessThan(3);
  });

  it('border: 후행 \\42order:none(디코딩=border)이 relevant 선언으로 수집돼 canonical 위반 RED가 된다', () => {
    const V = 'var(--color-input-border)';
    // 이 테스트는 normalizeProp의 **raw 식별자 디코딩**을 검증한다 — Sass는 escape를 선(先)정규화하므로
    // (\42order→Border) compileString을 태우면 decode 경로가 실행되지 않는다. 따라서 공용 evaluator를
    // 호출하되 cssText는 raw로 넣어 postcss.parse가 escape를 보존하게 한다.
    const res = evalBorderCss(`.X{border:1px solid ${V};\\42order:none}`);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/order: none/);
  });

  // 회귀 안전 확인(코드 변경과 무관 — hasProtectedPrefix가 이미 자체 디코딩) — P3 역방향도 escaped
  // 비보호 토큰을 놓치지 않는다.
  it('findUnprotectedDeclarations: escaped 비보호 토큰(--\\75 nprotected-x=--unprotected-x)도 검출', () => {
    const root = postcss.parse(':root { --color-a: 1; --\\75 nprotected-x: 2; }');
    const offenders = findUnprotectedDeclarations([root.first]);
    expect(offenders).toEqual(['--\\75 nprotected-x@1행']);
  });

  it('멱등성: decodeCssIdentifier/normalizeProp을 이미 디코딩된(또는 1회 디코딩된) 식별자에 재적용해도 무변화 — 이중 디코딩 지점 없음 보증', () => {
    const alreadyDecoded = ['--color-selected-indicator', 'border', 'border-top-color', '--Foo-Bar', 'all'];
    for (const ident of alreadyDecoded) {
      expect(decodeCssIdentifier(decodeCssIdentifier(ident))).toBe(decodeCssIdentifier(ident));
      expect(normalizeProp(normalizeProp(ident))).toBe(normalizeProp(ident));
    }
    // 현실 escape 패턴(leading-hyphen escape) 1회 디코딩 결과에는 백슬래시가 남지 않으므로 재통과해도
    // 무변화 — decode 지점이 정확히 한 곳(normalizeProp 진입부)이면 이중 호출 경로가 생겨도 안전하다.
    const onceDecoded = decodeCssIdentifier('\\--color-selected-indicator');
    expect(onceDecoded).toBe('--color-selected-indicator');
    expect(decodeCssIdentifier(onceDecoded)).toBe(onceDecoded);
  });

  // M2(13라운드) — **음성 mutation**: 이름에 \5c(백슬래시 자체의 hex escape)가 들어가면 1회 디코딩이
  // 리터럴 백슬래시를 낳아, **재디코딩하면 값이 달라진다**. 이는 "정확히 한 번만 디코딩"(단일 decode
  // 지점=normalizeProp 진입부) 계약을 고정한다.
  it('멱등성 음성 대조: \\5c(백슬래시 hex escape) 포함 이름은 1회≠2회 디코딩 — 단일 소비 계약 고정', () => {
    const once = decodeCssIdentifier('--color\\5c x'); // \5c → 리터럴 '\' , 뒤 공백 1개 소비
    expect(once).toBe('--color\\x'); // 리터럴 백슬래시 1개 남음
    expect(decodeCssIdentifier(once)).toBe('--colorx'); // 재디코딩: \x → x (백슬래시 소비) → 값 변함
    expect(decodeCssIdentifier(once)).not.toBe(once); // 비-멱등: 이 지점을 두 번 태우면 오독됨을 명시
  });
});

describe('13R I1 — findUnprotectedDeclarations 선행 하이픈 escape 역방향 검출', () => {
  // 디코딩 결과가 전부 --unprotected-x(비보호 custom property)인데 raw는 --로 시작하지 않아 놓쳤던 4종.
  it.each([
    ['\\--unprotected-x'],
    ['-\\-unprotected-x'],
    ['\\2d -unprotected-x'],
    ['-\\2d unprotected-x'],
  ])('선행 하이픈 escape %s 는 실이름 --unprotected-x로 검출된다(RED)', (prop) => {
    const root = postcss.parse(`:root { --color-a: 1; ${prop}: 2; }`);
    expect(findUnprotectedDeclarations([root.first])).toHaveLength(1);
  });
  it('기존 케이스(--\\75 nprotected-x, raw가 이미 --로 시작)도 계속 검출(GREEN 유지)', () => {
    const root = postcss.parse(':root { --color-a: 1; --\\75 nprotected-x: 2; }');
    expect(findUnprotectedDeclarations([root.first])).toEqual(['--\\75 nprotected-x@1행']);
  });
  it('보호 접두 3종만 있으면 escape 여부 무관 빈 배열(오검출 방지)', () => {
    const root = postcss.parse(':root { --color-a: 1; \\--track-b: 2; }'); // \--track-b = --track-b(보호)
    expect(findUnprotectedDeclarations([root.first])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11R~17R 회귀 벡터 코퍼스 — 6라운드에 걸쳐 축적된 mutation 벡터 전량을 **canonical 게이트 기대**로
// 이관한다(삭제 금지 원칙). 각 항목은 원 라운드 ID를 유지하고, 기대가 바뀐 것은 `note`에 갱신 사유를
// 병기한다. 기대 갱신의 유일한 원인은 아키텍처 전환 자체다:
//   · 구 모델의 "invalid(폐기) → **이전 유효 선언 fallback** → GREEN" 부류는 전부 RED가 된다.
//     정적 회귀 게이트에서 non-canonical CSS는 그 자체로 실패이고, 브라우저의 폐기 의미론을 흉내 내는
//     일(=false-green의 근원)을 중단했기 때문이다.
//   · 구 모델이 "유효 grammar"로 인정하던 non-canonical 형태(directional longhand 조립·border-width:0
//     복원·border-image:none 등)도 canonical 밖이므로 RED다(false-RED 방향 — 회귀 게이트로선 올바름).
// 반대로 **canonical + CSS-wide만으로 구성된 GREEN**(핀 실형태·`all:initial` 후 canonical box-shadow·
// `border-image:initial` 등)은 그대로 GREEN으로 남는다 — 층 2가 그 조합만 계산하기 때문이다.
// ─────────────────────────────────────────────────────────────────────────────
const CIB = 'color-input-border';
const IND = 'color-selected-indicator';
const V = 'var(--color-input-border)';
const IV = 'var(--color-selected-indicator)';
// 구 false-green의 단골 형태(M13 패턴): 활성 border-image + important 성분 longhand. 구 모델은 "무효
// shorthand가 border-image를 reset해 important longhand가 드러남"으로 GREEN을 냈다. 17R에선 성분
// longhand·border-image 모두 canonical 밖이라 어느 경로로도 GREEN이 될 수 없다.
const M13 = (candidate) => `.X{border-width:1px !important;border-style:solid !important;`
  + `border-color:${V} !important;border-image:url(a.png);border:${candidate}}`;

const CORPUS = [
  // ── 11R 대칭 구멍 A(border 4면 cascade) — RED 10종은 그대로 RED, GREEN 4종은 기대 갱신.
  { id: '11R-A1', kind: 'border', label: 'shorthand 후 border-width:0', src: `.X{border:1px solid ${V};border-width:0}`, visible: false },
  { id: '11R-A2', kind: 'border', label: 'shorthand 후 border-style:none', src: `.X{border:1px solid ${V};border-style:none}`, visible: false },
  { id: '11R-A3', kind: 'border', label: 'shorthand 후 border-color:transparent', src: `.X{border:1px solid ${V};border-color:transparent}`, visible: false },
  { id: '11R-A4', kind: 'border', label: 'border: calc(100% - 2px) solid var(…)', src: `.X{border:calc(100% - 2px) solid ${V}}`, visible: false },
  { id: '11R-A5', kind: 'border', label: 'border-width:0 !important', src: `.X{border:1px solid ${V};border-width:0 !important}`, visible: false },
  { id: '11R-A6', kind: 'border', label: 'border-width:0 !important 후 shorthand', src: `.X{border-width:0 !important;border:1px solid ${V}}`, visible: false },
  { id: '11R-A7', kind: 'border', label: 'directional border-left-width:0', src: `.X{border:1px solid ${V};border-left-width:0}`, visible: false },
  { id: '11R-A8', kind: 'border', label: '논리 프로퍼티 border-inline-width:0', src: `.X{border:1px solid ${V};border-inline-width:0}`, visible: false },
  { id: '11R-A9', kind: 'border', label: '`all: unset` 리셋(층 2가 계산: border initial → 비가시)', src: `.X{border:1px solid ${V};all:unset}`, visible: false },
  { id: '11R-A10', kind: 'border', label: 'border: 5 solid var(…)(unitless 비영 width)', src: `.X{border:5 solid ${V}}`, visible: false },
  { id: '11R-B1', kind: 'border', label: 'border-width:0 후 shorthand 복원', src: `.X{border-width:0;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-width는 canonical 폼이 아니다. 구 모델은 shorthand가 성분을 복원한다고 **계산**했지만, 전환 후 게이트는 non-canonical 선언의 의미를 추론하지 않는다(fail-closed).' },
  { id: '11R-B2', kind: 'border', label: 'shorthand !important 후 border-width:0(non-imp)', src: `.X{border:1px solid ${V} !important;border-width:0}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유 — !important 우선순위 계산 이전에 border-width:0 자체가 canonical 밖이다.' },
  { id: '11R-B3', kind: 'border', label: 'directional 성분으로 4면 조립', src: `.X{border-width:1px;border-style:solid;border-color:${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 성분 longhand 조립은 핀이 쓰지 않는 형태라 canonical 집합에 없다. 실제 핀이 이 형태로 바뀌면 개발자가 알아야 한다(게이트의 의도된 신호).' },
  { id: '11R-B4', kind: 'border', label: 'border-style 4값 확장(전면 solid)', src: `.X{border:1px solid ${V};border-style:solid solid solid solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-style longhand는 canonical 밖.' },

  // ── 12R F2 wrapper 색함수(직접 var 아님) — 전부 RED 유지.
  { id: '12R-F2a', kind: 'border', label: 'color-mix 0% wrapper', src: `.X{border:1px solid color-mix(in srgb,${V} 0%,transparent)}`, visible: false },
  { id: '12R-F2b', kind: 'border', label: 'rgb(var) wrapper', src: `.X{border:1px solid rgb(${V})}`, visible: false },
  { id: '12R-F2c', kind: 'border', label: 'rgb(from var …/0) wrapper', src: `.X{border:1px solid rgb(from ${V} r g b / 0)}`, visible: false },
  { id: '12R-F2d', kind: 'indicator', label: 'inset 인디케이터 color-mix wrapper', src: `.X{box-shadow:inset 0 0 0 1px color-mix(in srgb,${IV} 0%,transparent)}`, visible: false },
  { id: '12R-F2-GREEN', kind: 'border', label: '직접 var(--expected)(핀 실형태)', src: `.X{border:1px solid ${V}}`, visible: true },

  // ── 12R F3 border-image 도장.
  { id: '12R-F3a', kind: 'border', label: 'border 뒤 투명 border-image', src: `.X{border:1px solid ${V};border-image:linear-gradient(transparent,transparent) 1}`, visible: false },
  { id: '12R-F3b', kind: 'border', label: 'border-image 뒤 winning border shorthand', src: `.X{border-image:linear-gradient(transparent,transparent) 1;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 구 모델은 border shorthand의 border-image initial 리셋을 계산했다. 전환 후엔 border-image 선언(비 CSS-wide)이 존재하는 것 자체가 canonical 위반이다 — reset 부작용 모델이 통째로 사라졌다(finding 3 클래스 소멸).' },
  { id: '12R-F3c', kind: 'border', label: 'important border-image를 non-important border가 못 덮음', src: `.X{border-image:linear-gradient(transparent,transparent) 1 !important;border:1px solid ${V}}`, visible: false },
  { id: '12R-F3d', kind: 'border', label: 'border-image-source longhand(non-none)', src: `.X{border:1px solid ${V};border-image-source:linear-gradient(transparent,transparent)}`, visible: false },
  { id: '12R-F3e', kind: 'border', label: 'border-image-source:none(명시적)', src: `.X{border:1px solid ${V};border-image-source:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): `none`은 CSS-wide 키워드가 아니라 border-image-source의 property별 값이다 — canonical 집합 밖이라 RED. 리셋 의도라면 `initial`/`unset`이 층 2의 모델 대상이다(12R-F3f 참고).' },
  { id: '12R-F3f', kind: 'border', label: 'border-image-source:initial(CSS-wide 리셋)', src: `.X{border:1px solid ${V};border-image-source:initial}`, visible: true },
  { id: '12R-F3g', kind: 'border', label: 'border-image-slice non-initial(명시 예외 A)', src: `.X{border:1px solid ${V};border-image-slice:5}`, visible: false },

  // ── 12R F4 border 문법 전 노드 소비 — 전부 RED 유지 + 폐기 fallback GREEN 갱신.
  { id: '12R-F4a', kind: 'border', label: '1% width', src: `.X{border:1% solid ${V}}`, visible: false },
  { id: '12R-F4b', kind: 'border', label: '1px/solid(slash div 잔여)', src: `.X{border:1px/solid ${V}}`, visible: false },
  { id: '12R-F4c', kind: 'border', label: '1px,solid(comma div 잔여)', src: `.X{border:1px,solid ${V}}`, visible: false },
  { id: '12R-F4d', kind: 'border', label: 'string junk 잔여', src: `.X{border:1px solid ${V} "junk"}`, visible: false },
  { id: '12R-F4e', kind: 'border', label: 'border-width comma 무효 → 구 모델은 이전 0으로 fallback', src: `.X{border-width:0;border-style:solid;border-color:${V};border-width:1px,1px}`, visible: false },
  { id: '12R-F4f', kind: 'border', label: '무효 border-width 뒤 유효 shorthand fallback', src: `.X{border:1px solid ${V};border-width:1px,1px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 구 모델의 "무효 선언 폐기 → 이전 유효 선언 fallback" 동작을 제거했다. 층 2는 무효 CSS를 계산하지 않고, non-canonical 선언의 존재를 실패로 본다.' },

  // ── 13R I2 var 문법 / box-shadow 선언 전체 유효성.
  { id: '13R-I2a', kind: 'border', label: 'border color가 var(--x garbage)', src: `.X{border:1px solid var(--color-input-border garbage)}`, visible: false },
  { id: '13R-I2b1', kind: 'indicator', label: 'inset 중복', src: `.X{box-shadow:inset inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '13R-I2b2', kind: 'indicator', label: 'color 2개(transparent + var)', src: `.X{box-shadow:inset 0 0 0 1px transparent ${IV}}`, visible: false },
  { id: '13R-I2b3', kind: 'indicator', label: '무효 형제 레이어(junk)', src: `.X{box-shadow:junk, inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '13R-I2b-G1', kind: 'indicator', label: '유효 단일 inset 레이어(핀 실형태)', src: `.X{box-shadow:inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '13R-I2b-G2', kind: 'indicator', label: '다중 그림자(HomeTabs 핀 실형태)', src: `.X{box-shadow:var(--shadow-xs), inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '13R-I2b-G3', kind: 'indicator', label: '무효 box-shadow(junk) 후행 → 구 모델은 앞선 유효 선언 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 동작 제거(층 2 재설계). junk 선언이 존재하는 것 자체가 실패다.' },

  // ── 13R I3 directional 잔여 노드.
  { id: '13R-I3a', kind: 'border', label: 'directional 잔여노드(1px "junk")', src: `.X{border-width:0;border-style:solid;border-color:${V};border-top-width:1px "junk";border-right-width:1px "junk";border-bottom-width:1px "junk";border-left-width:1px "junk"}`, visible: false },
  { id: '13R-I3b', kind: 'border', label: '잔여 없는 유효 directional(1px)', src: `.X{border-width:0;border-style:solid;border-color:${V};border-top-width:1px;border-right-width:1px;border-bottom-width:1px;border-left-width:1px}`, visible: false,
    note: '기대 갱신(GREEN→RED): directional 성분 longhand는 canonical 밖(11R-B3와 동일 사유).' },

  // ── 13R I4 border-image shorthand 양방향.
  { id: '13R-I4a', kind: 'border', label: 'border-image:none이 stale slice를 리셋', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): `none`·`5`가 모두 canonical 밖이다(12R-F3e와 동일 사유). CSS-wide `initial`판은 13R-I4c가 GREEN으로 유지한다.' },
  { id: '13R-I4b', kind: 'border', label: '무효 shorthand(border:junk)는 리셋 안 함', src: `.X{border-image:linear-gradient(transparent,transparent) 1;border-width:1px !important;border-style:solid !important;border-color:${V} !important;border:junk}`, visible: false },
  { id: '13R-I4c', kind: 'border', label: 'border-image:initial(CSS-wide 리셋)', src: `.X{border:1px solid ${V};border-image:initial}`, visible: true },

  // ── 13R 잔여1 deferred(var 포함 문법위반) — 구 모델의 3분기가 전부 하나로 수렴한다.
  { id: '13R-D1', kind: 'indicator', label: 'spread 자리 var(--zero) → deferred', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero) ${IV}}`, visible: false },
  { id: '13R-D2', kind: 'border', label: 'width 자리 var(--w) → 슬롯 중복 deferred', src: `.X{border:1px solid ${V};border:var(--w) solid ${V}}`, visible: false },
  { id: '13R-D3', kind: 'indicator', label: 'var 없는 위반(length 5개) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px 2px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '13R-D4', kind: 'border', label: 'var 없는 위반(width 슬롯 중복) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border:1px 2px solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '13R-D5', kind: 'indicator', label: 'well-formed 아닌 var만 포함한 위반 → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero garbage)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거. well-formed 여부 판정 자체가 사라졌다.' },
  { id: '13R-D6', kind: 'border', label: 'well-formed 아닌 var만 포함한 border 위반', src: `.X{border:1px solid ${V};border:solid var(--w garbage)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },

  // ── 14R I1 border longhand 삼분(CSS-wide·named color·deferred).
  { id: '14R-I1a', kind: 'border', label: 'border-top-color: var(…) "junk"(deferred)', src: `.X{border:1px solid ${V};border-top-color:${V} "junk"}`, visible: false },
  { id: '14R-I1b', kind: 'border', label: 'border-style: initial', src: `.X{border:1px solid ${V};border-style:initial}`, visible: false },
  { id: '14R-I1c', kind: 'border', label: 'border-color: red(named color override)', src: `.X{border:1px solid ${V};border-color:red}`, visible: false },
  { id: '14R-I1d', kind: 'border', label: 'border-color: inherit(모델 불가)', src: `.X{border:1px solid ${V};border-color:inherit}`, visible: false },
  { id: '14R-I1e', kind: 'border', label: 'border-width: unset(CSS-wide 리셋 → border initial)', src: `.X{border:1px solid ${V};border-width:unset}`, visible: false,
    note: '기대 갱신(GREEN→RED): 층 2는 성분별 셀을 모델하지 않는다 — border 계열 CSS-wide 리셋은 경계 전체를 initial(비가시)로 접는다(의도적 과잉 안전, fail-closed).' },
  { id: '14R-I1f', kind: 'border', label: '잔여 없는 유효 directional(border-top-color: V)', src: `.X{border:1px solid ${V};border-top-color:${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): directional 성분 longhand는 canonical 밖(11R-B3 사유).' },
  { id: '14R-I1g', kind: 'border', label: 'var 없는 순수 문법위반(border-top-color: red blue) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-top-color:red blue}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I1h', kind: 'border', label: 'border: initial(shorthand 전체 CSS-wide)', src: `.X{border:1px solid ${V};border:initial}`, visible: false },

  // ── 14R I2 indicator CSS-wide·all·negative blur.
  { id: '14R-I2a', kind: 'indicator', label: 'box-shadow: initial', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:initial}`, visible: false },
  { id: '14R-I2b', kind: 'indicator', label: 'all: initial → box-shadow none', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:initial}`, visible: false },
  { id: '14R-I2c', kind: 'indicator', label: 'all: initial 후 canonical box-shadow가 이김(순서 대칭)', src: `.X{all:initial;box-shadow:inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '14R-I2d', kind: 'indicator', label: 'all: initial !important 는 후행 non-important를 이김', src: `.X{all:initial !important;box-shadow:inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '14R-I2e', kind: 'indicator', label: 'negative blur(var 없음) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 -1px 1px #000}`, visible: false,
    note: '기대 갱신(GREEN→RED): 14R에서 브라우저 폐기 의미론에 맞춰 GREEN으로 정정했던 항목. 전환 후엔 브라우저 의미론 재현을 중단했으므로 non-canonical 존재 = RED.' },
  { id: '14R-I2f', kind: 'indicator', label: 'negative blur + well-formed var(deferred)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 -1px 1px ${IV}}`, visible: false },

  // ── 14R I3 재귀 var·색함수 문법·대문자 VAR.
  { id: '14R-I3a', kind: 'border', label: 'fallback 내부 malformed 중첩 var', src: `.X{border:1px solid var(--color-input-border, var(--bad garbage))}`, visible: false },
  { id: '14R-I3b', kind: 'border', label: 'fallback이 정상 var인 중첩(구 모델은 토큰 정상 수집)', src: `.X{border:1px solid var(--color-input-border, var(--fallback))}`, visible: false,
    note: '기대 갱신(GREEN→RED): canonical 토큰 참조는 fallback 없는 `var(--name)`뿐이다.' },
  { id: '14R-I3c', kind: 'indicator', label: 'rgb(from junk r g b) 형제 레이어', src: `.X{box-shadow:0 0 rgb(from junk r g b), inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '14R-I3d', kind: 'border', label: '대문자 VAR()(구 모델은 유효 인정)', src: `.X{border:1px solid VAR(--color-input-border)}`, visible: false,
    note: '기대 갱신(암묵 GREEN→RED): 함수명 대소문자 정규화를 중단했다 — canonical은 소문자 `var(` 정확일치.' },

  // ── 14R I4 border-image 삼분 + CSS-wide.
  { id: '14R-I4a', kind: 'border', label: 'stale slice:5 후 border-image:initial', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:initial}`, visible: false,
    note: '기대 갱신(GREEN→RED): `border-image-slice:5`가 canonical 밖이라 그 존재만으로 RED(후행 리셋 여부와 무관 — 상태 복구 모델 없음).' },
  { id: '14R-I4b', kind: 'border', label: 'border-image: junk 후 source:none', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:junk;border-image-source:none}`, visible: false },
  { id: '14R-I4c', kind: 'border', label: 'border-image: inherit(모델 불가)', src: `.X{border:1px solid ${V};border-image:inherit}`, visible: false },

  // ── 14R I5 필수 전이 3형태 × border·indicator.
  { id: '14R-I5-1b', kind: 'border', label: '① 유효 → 후행 순수 문법위반(값 5개) → 구 모델은 fallback', src: `.X{border:1px solid ${V};border-color:red red red red red}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I5-1i', kind: 'indicator', label: '① indicator 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px 2px 3px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I5-2b', kind: 'border', label: '② 유효 → 후행 deferred → fail-closed', src: `.X{border:1px solid ${V};border-color:${V} "junk"}`, visible: false },
  { id: '14R-I5-2i', kind: 'indicator', label: '② indicator deferred fail-closed', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero) ${IV}}`, visible: false },
  { id: '14R-I5-3b', kind: 'border', label: '③ deferred 후 유효 winner가 이김', src: `.X{border:${V} "junk";border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 후행 canonical winner가 있어도 앞선 non-canonical 선언의 존재가 실패다(층 1은 순서 무관 전수 판정).' },
  { id: '14R-I5-3i', kind: 'indicator', label: '③ indicator deferred 후 유효 winner', src: `.X{box-shadow:inset 0 0 0 var(--zero) ${IV};box-shadow:inset 0 0 0 1px ${IV}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유.' },

  // ── 14R 잔여1 시스템 색.
  { id: '14R-R1a', kind: 'border', label: 'border-color: AccentColor', src: `.X{border:1px solid ${V};border-color:AccentColor}`, visible: false },
  { id: '14R-R1b', kind: 'indicator', label: 'box-shadow … ButtonText', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px ButtonText}`, visible: false },
  { id: '14R-R1c', kind: 'border', label: 'accentcolor(소문자)', src: `.X{border:1px solid ${V};border-color:accentcolor}`, visible: false },
  { id: '14R-R1d', kind: 'border', label: 'deprecated 시스템 색(ThreeDFace)', src: `.X{border:1px solid ${V};border-color:ThreeDFace}`, visible: false },
  { id: '14R-R1e', kind: 'border', label: '미지 ident(NotAColor) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-color:NotAColor}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거. "유효 색인가"를 판정하지 않으므로 AccentColor와 NotAColor가 동일하게 RED로 수렴한다 — 이 수렴 자체가 전환의 요지다.' },

  // ── 14R 잔여2 border-image longhand.
  { id: '14R-R2a', kind: 'border', label: 'border-image-source: junk → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-image-source:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-R2b', kind: 'border', label: '이전 상태=활성 이미지일 때 junk', src: `.X{border:1px solid ${V};border-image-source:linear-gradient(red,blue);border-image-source:junk}`, visible: false },
  { id: '14R-R2c', kind: 'border', label: 'border-image-slice: var(--x)(deferred)', src: `.X{border:1px solid ${V};border-image-slice:var(--x)}`, visible: false },

  // ── 15R I1~I6(헤드리스 Chrome 대조 벡터).
  { id: '15R-M1', kind: 'border', label: 'all: var(--color-bg)(deferred)', src: `.X{border:1px solid ${V};all:var(--color-bg)}`, visible: false },
  { id: '15R-M2', kind: 'indicator', label: 'all: var(--color-bg)(indicator)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:var(--color-bg)}`, visible: false },
  { id: '15R-M3', kind: 'border', label: 'border-width: initial 1px(다값 CSS-wide)', src: `.X{border:0 solid ${V};border-width:initial 1px}`, visible: false },
  { id: '15R-M4', kind: 'border', label: 'border-style: initial solid → 구 모델은 선언 폐기 후 solid 유지', src: `.X{border:1px solid ${V};border-style:initial solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '15R-M5', kind: 'indicator', label: 'calc 포함 유효 shadow winner', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 calc(1px + 1vw) 1px #000}`, visible: false },
  { id: '15R-M6', kind: 'indicator', label: '인자 부족 색함수 rgb(from red) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px rgb(from red)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(색함수 arity 모델 삭제).' },
  { id: '15R-M6b', kind: 'border', label: 'border-color: color-mix(in srgb)(피연산자 부족)', src: `.X{border:1px solid ${V};border-color:color-mix(in srgb)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '15R-M7', kind: 'border', label: 'border-color: tr\\61 nsparent(escaped ident)', src: `.X{border:1px solid ${V};border-color:tr\\61 nsparent}`, visible: false },
  { id: '15R-M8', kind: 'indicator', label: 'box-shadow … r\\65 d(escaped ident)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px r\\65 d}`, visible: false },
  { id: '15R-M9', kind: 'border', label: 'border-color: var(--é) "junk"(비ASCII dashed-ident)', src: `.X{border:1px solid ${V};border-color:var(--é) "junk"}`, visible: false },
  { id: '15R-M10', kind: 'border', label: 'border-image: inherit 후 일반 longhand가 못 지움', src: `.X{border-image:inherit;border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-M11', kind: 'border', label: 'border-image: inherit 후 border-image: none 복구', src: `.X{border:1px solid ${V};border-image:inherit;border-image:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): 모델 불가(inherit/revert) 표시는 sticky다 — 후행 리셋으로 해제되지 않는다(의도적 과잉 안전). 게다가 `none`도 canonical 밖이다.' },
  { id: '15R-M12', kind: 'border', label: 'all: inherit 는 후행 longhand로 지워지지 않음', src: `.X{border:1px solid ${V};all:inherit;border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-M13', kind: 'border', label: '확인 불가 shorthand(border: foo())는 border-image를 reset하지 않음', src: M13('foo()'), visible: false },
  { id: '15R-M14', kind: 'border', label: '-webkit-image-set 도 <image>로 성립(활성 도장)', src: `.X{border:1px solid ${V};border-image-source:-webkit-image-set("a.png" 1x)}`, visible: false },
  { id: '15R-M15', kind: 'border', label: 'border-image-slice: junk → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-image-slice:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(border-image 성분 grammar 모델 삭제).' },
  { id: '15R-M16', kind: 'border', label: 'border-image-repeat: 3값(최대 2 초과)', src: `.X{border:1px solid ${V};border-image-repeat:stretch stretch stretch}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유.' },
  { id: '15R-ADV1', kind: 'border', label: 'image 활성 상태는 후행 일반 longhand로 안 지워짐(역방향)', src: `.X{border-image-source:linear-gradient(red,blue);border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-ADV2', kind: 'border', label: 'border shorthand(유효)가 image를 리셋(구 무회귀 계약)', src: `.X{border-image:inherit;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-image의 inherit은 모델 불가 sticky다. 구 모델은 shorthand의 리셋 부작용을 계산했지만 그 부작용 모델을 삭제했다.' },
  { id: '15R-EXC-A', kind: 'border', label: '명시 예외 A: source none이어도 non-initial slice면 RED', src: `.X{border:1px solid ${V};border-image-slice:5}`, visible: false },
  { id: '15R-EXC-B', kind: 'border', label: '명시 예외 B: outset:0px(단위만 다른 0)', src: `.X{border:1px solid ${V};border-image-outset:0px}`, visible: false },

  // ── 16R I1~I3 + 근본1.
  { id: '16R-I1a', kind: 'border', label: 'all: env(...)(substitution deferred)', src: `.X{border:1px solid ${V};all:env(safe-area-inset-top)}`, visible: false },
  { id: '16R-I1b', kind: 'indicator', label: 'all: env(...)(indicator)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:env(safe-area-inset-top)}`, visible: false },
  { id: '16R-I1c', kind: 'indicator', label: '후행 box-shadow에 env(length 자리)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 env(safe-area-inset-top,3px) 1px red}`, visible: false },
  { id: '16R-I2', kind: 'border', label: '무효 hex(#xyz) shorthand는 border-image를 reset하지 않음', src: M13('#xyz'), visible: false },
  { id: '16R-I3a', kind: 'border', label: '이중 슬래시 색함수는 reset하지 않음', src: M13('rgb(1 2 3 / / 1)'), visible: false },
  { id: '16R-I3b', kind: 'indicator', label: '이중 슬래시 색함수 후행 → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px hsl(0 50% 50% / / 1)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(색함수 구분자 grammar 모델 삭제).' },
  { id: '16R-I3c', kind: 'border', label: '색 개수 초과 color-mix', src: M13('color-mix(in srgb, red, blue, green)'), visible: false },
  { id: '16R-I3d', kind: 'border', label: '유효 토큰 shorthand 무회귀(핀 실형태)', src: `.X{border:1px solid ${V}}`, visible: true },
];

describe('11R~17R 회귀 벡터 코퍼스 — canonical 게이트 기대로 이관(계약 보존)', () => {
  it.each(CORPUS)('$id $label', ({ kind, src, visible, token }) => {
    const t = token || (kind === 'border' ? CIB : IND);
    const res = kind === 'border' ? evalBorderScss(src, t) : evalIndicatorScss(src, t);
    expect(res.visible, JSON.stringify(res)).toBe(visible);
  });
  it(`코퍼스 규모 하한(현재 ${CORPUS.length}종) — 벡터 유실 방지`, () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(90);
  });
  it('코퍼스 GREEN은 canonical(+CSS-wide)만으로 구성된 것뿐이다 — GREEN 목록 고정', () => {
    expect(CORPUS.filter((c) => c.visible).map((c) => c.id)).toEqual([
      '12R-F2-GREEN', '12R-F3f', '13R-I2b-G1', '13R-I2b-G2', '13R-I4c', '14R-I2c', '16R-I3d',
    ]);
  });
  it('기대 갱신 항목은 전부 사유(note)를 병기한다', () => {
    const updated = CORPUS.filter((c) => c.note);
    expect(updated.length).toBeGreaterThanOrEqual(25);
    for (const c of updated) expect(c.note, c.id).toMatch(/기대 갱신/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17R 최소 회귀 벡터 상설화 — 외부 검수가 "모델이 정답 판정기라서" 뚫린다고 실증한 8종. 전환 **전**
// 이 8종은 전부 GREEN이었다(선재현 확인: 현행 HEAD 사본에 8 단정을 붙여 8/8 통과 = false-green 확정).
// 전환 후에는 canonical이 아니라는 이유 하나로 전부 RED다 — 개별 grammar 판정이 사라졌으므로 이 부류의
// 우회는 원리적으로 재발할 수 없다.
// 명시 예외: 8종 중 다수는 Sass가 컴파일 단계에서 선-거부(전역 rgb() 인자 검증 실패)하거나
// 선-상수접기(sqrt/hypot 등 CSS Values 4 수학 함수 채택)한다 — SCSS 경로로는 벡터가 원형 그대로 도달할
// 수 없다. 따라서 **raw CSS 텍스트**를 공용 evaluator에 직접 태운다(P4 스윕이 raw .css도 훑으므로 실제
// 입력 경로이며, 17R 이전 라운드도 동일 구조의 예외를 명시해 왔다).
// ─────────────────────────────────────────────────────────────────────────────
const R17_REGRESSION_VECTORS = [
  { id: 'V1', label: 'env(--x, initial) — custom env는 var-전용 deferred 검사에 안 걸려 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};all:env(--x, initial)}` },
  { id: 'V2', label: 'if(style(--flag: true): initial; else: initial) — 조건 함수 미인식 → 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};all:if(style(--flag: true): initial; else: initial)}` },
  { id: 'V3', label: 'hypot(3px, 1vw) — MATH_FUNCTIONS 미등재 길이 함수 → length 연속성 위반으로 폐기→핀 부활',
    kind: 'indicator', css: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 hypot(3px, 1vw) 1px red}` },
  { id: 'V4', label: '-webkit-link — 벤더 색 키워드 미등재 → 미지 ident=폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:-webkit-link}` },
  { id: 'V5', label: 'RGB(from light-dark(red, blue) r g b) — relative-color origin 미인식 → 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:RGB(from light-dark(red, blue) r g b)}` },
  { id: 'V6', label: 'RGB(foo(1) 2 3) — known-fn 내부 미지 함수가 unsupported로 낙착해 border-image reset 부작용',
    kind: 'border', css: M13('RGB(foo(1) 2 3)') },
  { id: 'V7', label: 'RGB(1 2 3 4) — 채널 4개(슬래시 없음)를 arity 하한만 보고 valid 인정 → reset 부작용',
    kind: 'border', css: M13('RGB(1 2 3 4)') },
  { id: 'V8', label: 'color-mix 구분자 오용(in srgb red, blue) — 그룹 수 위반=폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:color-mix(in srgb red, blue)}` },
];
describe('17R 8 회귀 벡터 상설화 — 전환 전 false-green 8/8 → 전환 후 상설 RED', () => {
  it.each(R17_REGRESSION_VECTORS)('$id RED: $label', ({ kind, css: cssText }) => {
    const res = kind === 'border' ? evalBorderCss(cssText, CIB) : evalIndicatorCss(cssText, IND);
    expect(res.visible, JSON.stringify(res)).toBe(false);
    // RED의 **이유**까지 고정한다 — "우연히 다른 경로로 RED"가 아니라 canonical 위반으로 RED여야 한다.
    expect(res.nonCanonical.length + res.unmodelable.length, JSON.stringify(res)).toBeGreaterThan(0);
  });
  it('8종 전부 canonical 판정 자체가 non-canonical이다(값 유효성은 판단하지 않는다)', () => {
    expect(R17_REGRESSION_VECTORS).toHaveLength(8);
    const values = [
      ['all', 'env(--x, initial)'],
      ['all', 'if(style(--flag: true): initial)'],
      ['box-shadow', 'inset 0 0 hypot(3px, 1vw) 1px red'],
      ['border-color', '-webkit-link'],
      ['border-color', 'RGB(from light-dark(red, blue) r g b)'],
      ['border', 'RGB(foo(1) 2 3)'],
      ['border', 'RGB(1 2 3 4)'],
      ['border-color', 'color-mix(in srgb red, blue)'],
    ];
    for (const [prop, value] of values) {
      expect(classifyRelevantDecl(prop, value), `${prop}: ${value}`).toEqual({ syntax: 'non-canonical', prop, value: normalizeDeclValue(value) });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fuzz oracle 재설계(검수 권장 4) — 이전 배터리는 `not.toBe('valid')`류라 invalid-discard와 unsupported를
// 뭉뚱그려 **상태 전이를 검증하지 못했다**(브라우저-유효 `-webkit-link`를 넣어도 전부 통과하는데 실제론
// false-green). 이제 벡터를 브라우저 기준으로 3분류하고, **기대 상태 그 자체**를 단정한다:
//   · PROVEN_INVALID        — 브라우저도 폐기하는 값
//   · PROVEN_VALID_UNMODELED— 브라우저에서 유효한데 우리가 모델하지 않는 값(이전 false-green의 원천)
//   · UNKNOWN               — 브라우저 판정을 우리가 확정할 수 없는 값
// 새 아키텍처의 요지는 **세 분류가 동일한 상태로 수렴**한다는 것이다(전부 non-canonical → RED). 분류
// 자체가 판정에 영향을 주지 않는다는 사실이 곧 "유효성 추론 없음"의 증거다.
// Sass compile 실패 벡터를 조용히 필터링하지 않는다 — 전 벡터를 raw CSS 경로로 태워 필터가 아예 없다.
// ─────────────────────────────────────────────────────────────────────────────
const PROVEN_INVALID = [
  '#xyz', '#12', '#12345', '#1234567', '#gggggg', '#',
  'rgb(1 2 3 / / 1)', 'rgb(1,,3)', 'hsl(0 50% 50% / / 1)', 'rgb(from red)',
  'color-mix(in srgb)', 'color-mix(in srgb, red, blue, green)', 'RGB(1 2 3 4)',
  '5xyz', '10flex', 'notacolor', 'inherits', 'initiall', 'url(x) url(y)', '"astring"',
];
const PROVEN_VALID_UNMODELED = [
  '-webkit-link', 'AccentColor', 'ButtonText', 'ThreeDFace', 'red', 'transparent', 'currentcolor',
  'light-dark(#fff, #000)', 'color-mix(in srgb, red, blue)', 'rgb(1 2 3)', 'rgb(1 2 3 / 0.5)',
  '#aabbccdd', '#abc', 'calc(1px + 1vw)', 'hypot(3px, 1vw)', 'env(safe-area-inset-top)',
  'attr(data-x)', 'var(--color-input-border, #ccc)', 'VAR(--color-input-border)', 'tr\\61 nsparent',
];
const UNKNOWN = [
  'zzz()', 'foobar()', 'qux(1, 2)', 'foo-bar-baz()', 'attrx(data-x)',
  'oklab4()', 'lch2(1 2 3)', 'color-contrast(red vs blue)', 'super-gradient(red, blue)',
  'if(style(--flag: true): initial)', 'env(--x, initial)', 'RGB(foo(1) 2 3)',
  '3quux', 'bluish', 'foo-bar-baz', ',,', '/ /',
];
const FUZZ_CLASSES = [
  ['PROVEN_INVALID', PROVEN_INVALID],
  ['PROVEN_VALID_UNMODELED', PROVEN_VALID_UNMODELED],
  ['UNKNOWN', UNKNOWN],
];
describe('17R fuzz oracle 3분류 — 세 분류가 동일 상태(non-canonical/RED)로 수렴한다', () => {
  it('배터리 규모 하한(각 분류 ≥ 15, 합계 ≥ 50)', () => {
    for (const [name, list] of FUZZ_CLASSES) expect(list.length, name).toBeGreaterThanOrEqual(15);
    expect(PROVEN_INVALID.length + PROVEN_VALID_UNMODELED.length + UNKNOWN.length).toBeGreaterThanOrEqual(50);
  });

  it.each(FUZZ_CLASSES)('%s — 층 1은 정확히 non-canonical 상태를 반환한다(네 배치 전부)', (_name, list) => {
    for (const U of list) {
      // 기대 상태 **그 자체**를 단정한다(not-valid가 아니라 정확한 상태 객체).
      expect(classifyRelevantDecl('border', `1px solid ${U}`).syntax, `border:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('border', U).syntax, `border-value:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('box-shadow', `inset 0 0 0 1px ${U}`).syntax, `bs-color:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('all', U).syntax, `all:${U}`).toBe('non-canonical');
    }
  });

  it.each(FUZZ_CLASSES)('%s — cascade 시퀀스: 기존 GREEN → 후보 → RED, 후행 확정 override로도 복구 불가', (_name, list) => {
    for (const U of list) {
      // ① 기존 GREEN 뒤에 후보가 오면 RED
      expect(evalBorderCss(`.X{border:1px solid ${V};border-color:${U}}`, CIB).visible, `seq1:${U}`).toBe(false);
      // ② 후보 뒤에 **확정 canonical override**가 와도 RED(층 1은 순서 무관 전수 판정 — fallback 소멸)
      expect(evalBorderCss(`.X{border-color:${U};border:1px solid ${V}}`, CIB).visible, `seq2:${U}`).toBe(false);
      // ③ indicator 도메인 동일
      expect(evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:${U}}`, IND).visible, `seq3:${U}`).toBe(false);
    }
  });

  it.each(FUZZ_CLASSES)('%s — !important 조합에서도 동일 상태(중요도는 canonical 위반을 구제하지 못한다)', (_name, list) => {
    for (const U of list) {
      expect(evalBorderCss(`.X{border:1px solid ${V} !important;border-color:${U}}`, CIB).visible, `imp1:${U}`).toBe(false);
      expect(evalBorderCss(`.X{border:1px solid ${V};border-color:${U} !important}`, CIB).visible, `imp2:${U}`).toBe(false);
      expect(evalBorderCss(`.X{border-color:${U} !important;border:1px solid ${V} !important}`, CIB).visible, `imp3:${U}`).toBe(false);
    }
  });

  it('분류를 바꾸는 mutation은 판정을 바꾸지 못한다 — 세 분류의 상태 집합이 완전히 동일하다', () => {
    const stateOf = (U) => JSON.stringify([
      classifyRelevantDecl('border', `1px solid ${U}`).syntax,
      evalBorderCss(`.X{border:1px solid ${V};border-color:${U}}`, CIB).visible,
      evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:${U}}`, IND).visible,
    ]);
    const states = new Set([...PROVEN_INVALID, ...PROVEN_VALID_UNMODELED, ...UNKNOWN].map(stateOf));
    expect([...states]).toEqual([JSON.stringify(['non-canonical', false, false])]);
  });

  it('mutation 검출력 — 후보 자리에 canonical 폼이 오면 GREEN이 된다(위 RED 단정이 공허하지 않음)', () => {
    // 동일 위치·동일 구조에서 canonical만 GREEN을 낸다는 대조. 이 단정이 없으면 위 RED들은
    // "무엇을 넣어도 RED"인 공허한 게이트와 구분되지 않는다.
    expect(evalBorderCss(`.X{border:1px solid ${V}}`, CIB).visible).toBe(true);
    expect(evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV}}`, IND).visible).toBe(true);
    expect(evalBorderCss(`.X{border:1px solid ${V};border-color:zzz()}`, CIB).visible).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17R 적대적 자가 재검토 — **canonical 매칭 자체를 우회하는 경로**를 직접 단정한다(수집 누락·셀렉터
// 구멍·부작용 잔존·정규식 anchoring).
// ─────────────────────────────────────────────────────────────────────────────
describe('17R 적대적 자가 재검토 — canonical 매칭 우회 경로 폐쇄', () => {
  it('부작용 금지: 비-canonical 선언은 canonical 셀을 덮지 않으며, 그럼에도 RED다', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};border:RGB(foo(1) 2 3)}`, CIB);
    expect(res.border).toEqual({ width: 1, style: 'solid', token: CIB }); // 앞선 canonical 셀 그대로
    expect(res.nonCanonical).toHaveLength(1);
    expect(res.visible).toBe(false); // 부작용은 없지만 존재 자체가 실패(fail-closed)
  });
  it('relevant 수집 누락 없음: escaped prop(\\62 ox-shadow=box-shadow)도 relevant로 복원돼 판정된다', () => {
    const res = evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};\\62 ox-shadow:none}`, IND);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/ox-shadow: none/);
  });
  it('relevant 수집 누락 없음: 대문자 프로퍼티(BORDER)도 normalizeProp로 통합돼 판정된다', () => {
    expect(evalBorderCss(`.X{border:1px solid ${V};BORDER-COLOR:red}`, CIB).visible).toBe(false);
  });
  it('중첩 규칙 안 선언도 walkDecls 전수 방문 — root 직속 규칙 내부의 어떤 선언도 놓치지 않는다', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};border-style:dotted dotted}`, CIB);
    expect(res.nonCanonical).toHaveLength(1);
  });
  it('anchoring: canonical 정규식은 부분 매칭되지 않는다(접두/접미 잔여 거부)', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V} extra`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border', `x 1px solid ${V}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `inset 0 0 0 1px ${IV} extra`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `junk, inset 0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
  });
  it('canonical 폼은 프로퍼티에 묶여 있다 — 같은 문자열이라도 다른 프로퍼티에선 canonical이 아니다', () => {
    expect(classifyRelevantDecl('border', `inset 0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `1px solid ${V}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border-top', `1px solid ${V}`).syntax).toBe('non-canonical'); // 핀 미사용 형태
  });
  it('CSS-wide 인정은 값 전체가 소문자 단독일 때만(다값·대문자 변형 거부)', () => {
    expect(classifyRelevantDecl('all', 'initial').syntax).toBe('canonical');
    expect(classifyRelevantDecl('all', ' unset ').syntax).toBe('canonical'); // 공백 정규화만 허용
    expect(classifyRelevantDecl('all', 'INITIAL').syntax).toBe('non-canonical'); // 명시 예외(fail-closed)
    expect(classifyRelevantDecl('all', 'initial initial').syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border-width', 'initial 1px').syntax).toBe('non-canonical');
  });
  it('모델 불가(inherit/revert)는 sticky — 후행 canonical이 있어도 RED', () => {
    expect(evalBorderCss(`.X{all:inherit;border:1px solid ${V}}`, CIB).visible).toBe(false);
    expect(evalBorderCss(`.X{border:1px solid ${V};border-color:revert}`, CIB).visible).toBe(false);
    expect(evalIndicatorCss(`.X{box-shadow:revert-layer;box-shadow:inset 0 0 0 1px ${IV}}`, IND).visible).toBe(false);
  });
  it('셀렉터 미발견은 GREEN이 아니다(rulesFound 0 → RED)', () => {
    expect(evalBorderCss('.Y{border:1px solid var(--color-input-border)}', CIB).visible).toBe(false);
  });
  // 명시 예외(과대 종결 금지) — 아래 두 경로는 이번 라운드에서 닫지 **못했다**. 기록만 남긴다.
  //  ① 셀렉터 동치성: 완전 동일 문자열 비교라 `.is-on.HomeTabs__Tab`처럼 **순서만 다른 동일 복합
  //     셀렉터**나 `:is()` 표기 변형으로 쓴 규칙은 후보에 들어오지 않는다(selector 의미론 모델 미구현).
  //     핀 실파일은 단일 표기라 현재 실피해는 없다.
  //  ② 다른 셀렉터·다른 파일에서 오는 cascade(더 높은 specificity의 `.Foo .HomeTabs { border: none }`)는
  //     여전히 범위 밖이다 — 이 게이트는 "핀 셀렉터 자신의 선언이 canonical인가"만 본다.
  it('명시 예외 기록: 순서만 다른 복합 셀렉터는 후보에 안 들어온다(미폐쇄 경로 고정)', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V}}.b.a{border:none}`, CIB);
    expect(res.visible).toBe(true); // ← 이 GREEN은 계약이 아니라 **알려진 한계**의 고정이다
  });
});
