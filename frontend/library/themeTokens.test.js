import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, compileString } from 'sass';
import postcss from 'postcss';

// ─────────────────────────────────────────────────────────────────────────────
// I1(18R) — **CSS 공백 전용 정규화**. CSS 스펙의 whitespace는 정확히 5종(space·tab·LF·FF·CR)이다.
// JS `\s`와 `String#trim()`은 NBSP(U+00A0)·EM SPACE(U+2003)·ZWNBSP(U+FEFF)·vertical tab(U+000B)까지
// 공백으로 취급하는데, 이들은 CSS에서 공백이 **아니다**(앞 셋은 ident 문자, U+000B는 아예 불법 문자).
// 그래서 기존 `/\s+/`·`trim()` 정규화는 브라우저가 "다른 셀렉터" 또는 "무효 선언(계산값 none)"으로
// 보는 입력을 게이트가 **canonical로 고쳐서 통과**시켰다 — 손실 정규화형 false-green.
// 18R 선재현 실측(현행 HEAD): 4종 공백 × (셀렉터 / box-shadow 값 / border 값) = **12/12 false-green**
// (`.X<NBSP>`가 rulesFound=1로 핀에 수집, `inset<NBSP>0 0 0 1px var(…)`가 canonical/visible=true).
// 이후 이 파일의 모든 CSS 텍스트 정규화는 아래 두 헬퍼만 쓴다(JS `\s`·`trim()` 직접 사용 금지).
const CSS_WS_CLASS = ' \\t\\n\\f\\r';
const CSS_WS_RE = new RegExp(`[${CSS_WS_CLASS}]+`, 'g');
const CSS_WS_EDGE_RE = new RegExp(`^[${CSS_WS_CLASS}]+|[${CSS_WS_CLASS}]+$`, 'g');
const cssTrim = (s) => String(s).replace(CSS_WS_EDGE_RE, '');
const normalizeCssWhitespace = (s) => cssTrim(String(s).replace(CSS_WS_RE, ' '));
// "JS는 공백으로 보지만 CSS는 아닌" 코드포인트 — postcss의 `rule.selectors`(list.comma)가 각 파트에
// **JS trim**을 적용하므로 이 문자가 셀렉터 경계에 있으면 우리 손에 닿기 전에 이미 삭제된다(파서
// 레벨 손실 정규화). 따라서 정규화만 고쳐선 부족하고, 이런 코드포인트를 포함한 셀렉터는 매칭
// 후보에서 통째로 배제한다(fail-closed — 실제로 다른 셀렉터를 같은 것으로 오인할 여지를 없앤다).
const JS_ONLY_WS_RE = new RegExp(`[^\\S${CSS_WS_CLASS}]`);
// ─────────────────────────────────────────────────────────────────────────────

// _themes.scss 계약: 컴파일 결과에 flat 블록 3개 —
//   [0] :root(라이트) [1] html[data-theme='dark'](다크) [2] :root(테마불변 별칭)
// [0]/[1]의 --키 집합이 다르면 한쪽 테마에서 반대 테마 값이 상속 누출된다.
const css = compile(resolve(__dirname, '../styles/_themes.scss')).css;
// ⚠️ sass 1.97은 attribute selector의 불필요한 따옴표를 제거한다: html[data-theme=dark]
//    (따옴표 필수 매칭이면 별칭 블록을 dark로 오인 — 리뷰 재현 [52,5]) — unquoted 허용 필수.
// I1 적용: 키 추출의 `\s*`도 CSS 공백 5종 전용이다 — `--color-bg<NBSP>: #fff`는 실제로는 이름이
// `--color-bg<NBSP>`인 **별개 토큰**인데 `\s*`는 이를 `--color-bg`로 오인해 대칭/베이스라인 검사를
// 통째로 우회시켰다. 이제 매치 자체가 실패해 키가 집합에서 빠지고 대칭 단정이 RED가 된다.
const THEME_BLOCK_RE = new RegExp(`(?::root|html\\[data-theme=(?:dark|["']dark["'])\\])[${CSS_WS_CLASS}]*\\{([^}]*)\\}`, 'g');
// 블록 본문 → 선언된 --토큰 키 집합(접두 `--` 제외). 공백은 CSS 5종만 허용한다(I1).
function extractTokenKeys(blockBody) {
  return new Set([...String(blockBody).matchAll(new RegExp(`--([a-z0-9-]+)[${CSS_WS_CLASS}]*:`, 'g'))].map((k) => k[1]));
}
const blocks = [...css.matchAll(THEME_BLOCK_RE)].map((m) => extractTokenKeys(m[1]));
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
    // I1(19R): 이전엔 raw css 정규식 + Object.fromEntries(후행 승리)로 읽어 라이트 블록의 중복·!important를
    // 못 봤다(cascade winner 미반영). 이제 shape contract가 강제된 buildLightValues(유일 선언 AST 값)로 읽는다.
    const values = buildLightValues(css);
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
    // I1(18R): 값 비교 trim도 CSS 공백 전용 — `var(--color-x)<NBSP>`는 Sass가 NBSP를 포함한 별개
    // 문자열로 내보내 브리지가 조용히 깨지는데 JS trim은 정상으로 둔갑시켰다(같은 손실 정규화 클래스).
    const decls = [...bridge.matchAll(new RegExp(`^\\$((?:color|shadow)-[a-z0-9-]+)[${CSS_WS_CLASS}]*:[${CSS_WS_CLASS}]*([^;]+);`, 'gm'))];
    expect(decls.length).toBeGreaterThan(30);
    const bad = decls.filter((m) => cssTrim(m[2]) !== `var(--${m[1]})`)
      .map((m) => `${m[1]} = ${cssTrim(m[2])}`);
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
    const decls = [...src.matchAll(new RegExp(`^\\$track-([a-z0-9-]+)[${CSS_WS_CLASS}]*:[${CSS_WS_CLASS}]*([^;]+);`, 'gm'))];
    expect(decls.length).toBe(7);
    const bad = decls.filter((m) => cssTrim(m[2]) !== `var(--track-${m[1]})`); // I1: CSS 공백 전용 trim
    expect(bad.map((m) => `track-${m[1]} = ${cssTrim(m[2])}`)).toEqual([]);
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
// I1(18R) — 공백 정규화를 CSS 공백 5종 전용으로 교체하고, 그 위에 파서-레벨 손실까지 막는 가드를 둔다.
// postcss `rule.selectors`는 내부적으로 각 콤마 파트에 **JS trim**을 걸어 NBSP/EM SPACE/ZWNBSP/VT를
// 경계에서 지운다 — 즉 `.X<NBSP>`가 `.X`로 도착한다. 정규화 함수만 고쳐도 이 손실은 남으므로,
// 셀렉터 원문에 CSS-비공백 JS-공백 코드포인트가 하나라도 있으면 매칭 자체를 거부한다(fail-closed).
function selectorMatches(rule, targetSelectors) {
  if (JS_ONLY_WS_RE.test(rule.selector)) return false;
  const targets = new Set(Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors]);
  return rule.selectors.some((part) => targets.has(normalizeCssWhitespace(part)));
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
      // I1(18R): JS trim은 NBSP 등 CSS ident 문자를 값 경계에서 지워 `#6B7280<NBSP>`(브라우저에선
      // 무효 → 토큰 미적용)를 정상 hex로 둔갑시켰다 — CSS 공백 전용 trim으로 교체(fail-closed).
      state[prop] = { value: cssTrim(decl.value), important: !!decl.important };
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
// 결과(문구 축소, 18R): 이 게이트가 보장하는 것은 **"exact selector + 정적 styles 인벤토리 범위
// 내에서" canonical 외 전부 RED로 수렴한다**는 것뿐이다. 17R 주석의 "false-green이 원리적으로
// 불가능"은 과대 주장이었다 — 18R 선재현이 그 주석 아래에서 손실 정규화(I1)·과대 허용(I2)·이름
// 비대칭(I3)·inventory 누락(I4) 네 부류의 false-green을 실측했다. **범위 밖 = 명시 예외**이며
// 전수는 아래 "명시 예외 전수" describe가 단정과 함께 고정한다:
//   ① 셀렉터 동치성(`.a.b` 대 `.b.a`, `:is()` 표기 변형) — selector 의미론 모델 없음
//   ② 타 셀렉터·타 파일에서 오는 cascade(더 높은 specificity의 override)
//   ③ 로컬 custom property 재정의 — 핀 게이트 단독으론 GREEN, P4 보호 네임스페이스 스윕과의 **합성**에 의존
//   ④ JS 런타임 `CSS.registerProperty()` — 정적 styles 인벤토리 밖(@property at-rule은 I4로 폐쇄됨)
// false-RED는 늘지만 회귀 게이트로선 올바른 방향이다 — 실제 코드가 canonical을 벗어나면 개발자가
// 알아야 한다. 수렴 선언은 하지 않는다.
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
const CANON_STYLE_SRC = `(?:${CANON_VISIBLE_BORDER_STYLES.join('|')})`;
// **needle 파서 전용** 매처(판정기 아님) — PINNED 표의 `needle: 'var(--token)'` 문자열에서 토큰 이름을
// 뽑는 데만 쓴다. 선언 값이 canonical인지 여부는 오직 CANONICAL_DECLS.re가 결정한다.
const CANON_VAR_REF_RE = /^var\(--([a-z0-9-]+)\)$/;

// ─── I2(18R) — box-shadow canonical을 **실측 전체 문자열**로 좁힌다 ─────────────────────────────
// 이전 형태는 opaque layer를 `var(--<아무 이름>)`으로, 전체 값을 "canonical 레이어의 임의 콤마 나열"로
// 허용하고, 최종 판정은 "기대 inset layer 하나 존재"만 봤다. 그 결과 참조 토큰의 **의미가 전혀
// 검증되지 않았다**(선재현 실측, 현행 HEAD):
//   · `var(--does-not-exist), inset 0 0 0 1px var(--color-selected-indicator)` → visible=true
//     (브라우저는 첫 레이어가 무효라 **선언 전체를 폐기** — 실렌더 box-shadow: none)
//   · `var(--shadow-md), inset …` → visible=true (핀이 쓰지 않는 토큰인데 통과)
//   · `_themes.scss`에서 `--shadow-xs: none`으로 바꾸면 실 CSS가 `none, inset …` = **계산값 none**인데
//     선언 문자열은 그대로라 296/296 GREEN
// 처방은 문법 모델 추가가 **아니라** 실측값으로 좁히기다. 넓은 패턴을 하나라도 남기면 whitelist가
// 다시 작은 CSS 문법이 되고, 그 문법의 오차가 곧 다음 라운드의 false-green이 된다.
//   · 허용 opaque layer: 정확히 `var(--shadow-xs)` 하나
//   · 허용 indicator layer: 정확히 `inset 0 0 0 1px var(--color-selected-indicator)` 하나
//   · 허용 전체 값: 위 두 레이어로 만들어지는 **실핀 2가지 전체 문자열**뿐(레이어 조합·순서 포함)
// `var(--shadow-xs)`가 opaque layer로 성립한다는 전제(=완전 그림자로 확장되는 유효 값)는 아래
// "--shadow-xs exact baseline" describe가 라이트·다크 값 자체를 고정해 지킨다 — 토큰 값이 `none`
// 이나 무효 값으로 바뀌면 그 describe가 RED가 된다.
const CANON_SHADOW_OPAQUE_LAYER = 'var(--shadow-xs)';
const CANON_SHADOW_INDICATOR_LAYER = 'inset 0 0 0 1px var(--color-selected-indicator)';
const CANON_SHADOW_VALUES = [
  CANON_SHADOW_INDICATOR_LAYER,                                          // .MyTasks__ScopeBtn--active
  `${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`,       // .HomeTabs__Tab.is-on
];
// 실측 값에 대응하는 레이어 모델(층 2 가시성 계산 입력). 상수이므로 매번 사본을 낸다.
const SHADOW_OPAQUE_LAYER_MODEL = () => ({ kind: 'opaque-var', token: 'shadow-xs' });
const SHADOW_INDICATOR_LAYER_MODEL = () =>
  ({ kind: 'inset', offsetX: 0, offsetY: 0, blur: 0, spread: 1, token: 'color-selected-indicator' });
// 리터럴 전체 문자열 → anchored exact 정규식(정규식 메타문자 이스케이프). 패턴 확장 여지 0.
const exactValueRe = (literal) => new RegExp(`^${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

// CANONICAL_DECLS — **핀 8곳의 실제 컴파일 값에서 도출**한 canonical 형태 집합이자 층 1의 **유일한
// 판정 테이블**이다. M1(18R): 이전엔 classifyRelevantDecl()이 이 배열을 조회하지 않고 별도 regex를
// 썼기 때문에 entry의 prop/re를 망가뜨려도 결과가 그대로였다 — 즉 "single source"라는 주석이 사실이
// 아니었다. 이제 classifier가 이 배열을 직접 dispatch한다(아래 mutation 테스트가 그 단일화를 증명).
// 각 항목의 `pins`가 도출 근거이고, 아래 "CANONICAL_DECLS 도출 근거 고정" describe가 실파일로 재검증한다.
// 여기 없는 형태는 전부 비-canonical이며 게이트는 그 유효성을 **판단하지 않는다**.
const CANONICAL_DECLS = [
  {
    id: 'border-shorthand',
    level: 'value', // 선언 값 전체가 이 형태여야 한다
    prop: 'border',
    form: 'border: <length> <visible-style> var(--<token>)',
    re: new RegExp(`^(${CANON_LEN_SRC}) (${CANON_STYLE_SRC}) var\\(--([a-z0-9-]+)\\)$`),
    build: (m) => ({ form: 'border', border: { width: parseFloat(m[1]), style: m[2], token: m[3] } }),
    // 근거(실측 컴파일 값, 전부 `1px solid var(--color-input-border)`). 색 자리 토큰은 층 2가
    // contract.token과 대조하므로(=핀별 기대 토큰) 임의 토큰이 통과하지 않는다.
    pins: ['.CanvasEditor', '.CanvasEditorToolbar__ColorSwatch', '.FilterBuilder__OpToggle',
      '.MyTasks__ScopeToggle', '.HomeTabs', '.BrowseBranches__JoinBtn--joined'],
  },
  {
    id: 'box-shadow-indicator-only',
    level: 'value',
    prop: 'box-shadow',
    form: CANON_SHADOW_VALUES[0], // 실측 전체 문자열(패턴 아님)
    re: exactValueRe(CANON_SHADOW_VALUES[0]),
    build: () => ({ form: 'box-shadow', layers: [SHADOW_INDICATOR_LAYER_MODEL()] }),
    pins: ['.MyTasks__ScopeBtn--active'],
  },
  {
    id: 'box-shadow-opaque-then-indicator',
    level: 'value',
    prop: 'box-shadow',
    form: CANON_SHADOW_VALUES[1], // 실측 전체 문자열(레이어 조합·순서 포함)
    re: exactValueRe(CANON_SHADOW_VALUES[1]),
    build: () => ({ form: 'box-shadow', layers: [SHADOW_OPAQUE_LAYER_MODEL(), SHADOW_INDICATOR_LAYER_MODEL()] }),
    pins: ['.HomeTabs__Tab.is-on'],
  },
];

// CSS-wide 키워드 — 층 2가 계산하는 유일한 non-canonical-form 입력. 정확히 소문자 단독일 때만 인정한다
// (명시 예외: `INITIAL` 같은 대문자 변형은 스펙상 유효하지만 여기선 비-canonical=RED로 fail-closed).
const CANON_CSS_WIDE_RE = /^(?:initial|inherit|unset|revert|revert-layer)$/;
const MODELED_RESET_KEYWORDS = new Set(['initial', 'unset']); // 비상속 속성이라 두 키워드는 동치
const BORDER_IMAGE_PROP_RE = /^border-image(?:-(?:source|slice|width|outset|repeat))?$/;

// relevant 선언 판정 — **프로퍼티 이름만** 본다(값 유효성 추론 없음). border로 시작하는 프로퍼티는
// 경계 무관이 확실한 것(radius/collapse/spacing)만 제외하고 전부 relevant다 — 논리 프로퍼티
// (border-inline-*/border-block-*)·border-image 계열·미지의 `border-*` 신설 프로퍼티까지 자동으로
// relevant에 들어와 canonical이 아니면 RED가 된다(15R "논리 프로퍼티 fail-closed" 계약의 일반화).
//
// 벤더 프리픽스 정규화(내부 리뷰 실증, 17R 이후) — 진입부에서 먼저 `-webkit-`/`-moz-`/`-ms-`/`-o-` 등
// (`/^-[a-z]+-/`)을 벗긴 뒤 판정한다. 벗기기 전엔 `-webkit-border-image`/`-webkit-box-shadow` 같은
// alias가 `prop.startsWith('border')`/`=== 'box-shadow'`에 안 걸려 relevant 밖으로 새 나갔다 —
// **층 1 자체가 무력화되는 수집 누락**(선언을 relevant로 못 보면 canonical 판정이 실행되지 않아
// 항상 GREEN). 커스텀 프로퍼티(`--foo`)는 두 번째 문자가 `-`라 `/^-[a-z]+-/`에 애초에 안 걸려 안전
// (deprefix 무영향). 호출부는 normalizeProp(decode → lowercase)을 먼저 거친 prop을 넘기므로 파이프라인
// 순서는 decode → lowercase → deprefix. 15R의 동명 아이디어(함수명용 VENDOR_PREFIX_RE/unprefixedFn,
// <image> 문법 판정용)가 17R 삭제분에 함께 사라졌던 것과 별개로, 여기는 **프로퍼티 이름**용이다.
const IRRELEVANT_BORDER_PROP_RE = /^border-(?:collapse|spacing)$|-radius$/;
const PROP_VENDOR_PREFIX_RE = /^-[a-z]+-/;
function isRelevantProp(prop) {
  const deprefixed = prop.replace(PROP_VENDOR_PREFIX_RE, '');
  if (deprefixed === 'box-shadow' || deprefixed === 'all') return true;
  if (!deprefixed.startsWith('border')) return false;
  return !IRRELEVANT_BORDER_PROP_RE.test(deprefixed);
}

// 값 정규화 — **CSS 공백**(5종) 축약/trim만 한다(소문자화·escape 디코딩·토큰 분해 전부 없음). 대소문자와
// escape가 canonical 판정에 그대로 노출되므로 `VAR(--x)`·`tr\61 nsparent` 류는 자동으로 RED다.
// I1(18R): 이전엔 JS `\s`/`trim()`이라 NBSP·EM SPACE·ZWNBSP·VT를 ASCII space로 **바꿔서** 통과시켰다.
function normalizeDeclValue(value) {
  return normalizeCssWhitespace(value);
}

// box-shadow canonical 값 → 레이어 모델 배열. 판정은 classifyRelevantDecl(=CANONICAL_DECLS dispatch)
// 하나로 단일화돼 있으므로 여기서 별도 분해·별도 정규식을 두지 않는다(M1: 판정 경로 이중화 금지).
function canonicalShadowLayers(value) {
  const cls = classifyRelevantDecl('box-shadow', value);
  return cls.syntax === 'canonical' && cls.form === 'box-shadow' ? cls.layers : null;
}

// 층 1 판정기 — relevant 선언 하나를 `canonical`(+form) 또는 `non-canonical`로 **이분**한다.
// 상태 모델(층 2 내부에서만 의미를 갖는다): syntax = canonical | non-canonical.
// non-canonical은 어느 분기에서든 RED이고 **어떤 부작용도 내지 않는다**(border-image reset 금지 포함 —
// 검수 finding 3의 `border: RGB(foo(1) 2 3)` 케이스가 이걸로 닫힌다).
//
// I3(18R) — **벤더 프리픽스 relevant 선언은 무조건 non-canonical**. 이전엔 isRelevantProp()만 deprefix해
// 수집하고 classifier에는 raw `-webkit-box-shadow`가 전달돼 **이름 비대칭**이 생겼다: `initial`/`unset`이
// CSS-wide canonical로 인정된 뒤 `prop === 'box-shadow'`에 미매치 → 마지막 분기에서 shadow가 아닌
// **border 셀을 초기화**해, 인디케이터 핀은 기존 shadow가 그대로 남아 GREEN이었다(선재현 실측:
// `-webkit-box-shadow: initial !important`·`-webkit-box-shadow: unset` 둘 다 visible=true).
// 실핀이 쓰지 않는 형태이므로 alias 의미를 계산할 이유가 없다 — 존재 자체를 RED로 접는다(fail-closed).
// M1(18R) — 아래 루프가 CANONICAL_DECLS를 **직접** dispatch하는 유일 판정 경로다. 배열 entry의
// prop/re를 훼손하면 판정 결과가 즉시 달라진다(= 배열이 진짜 single source임을 mutation으로 증명 가능).
function classifyRelevantDecl(prop, rawValue) {
  const value = normalizeDeclValue(rawValue);
  if (PROP_VENDOR_PREFIX_RE.test(prop)) return { syntax: 'non-canonical', prop, value };
  if (CANON_CSS_WIDE_RE.test(value)) return { syntax: 'canonical', form: 'css-wide', keyword: value, value };
  for (const entry of CANONICAL_DECLS) {
    if (entry.prop !== prop) continue;
    const m = entry.re.exec(value);
    if (m) return { syntax: 'canonical', id: entry.id, value, ...entry.build(m) };
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
// needle(`var(--token)`)을 토큰명으로 바꾼다 — 별도 파서 없이 CANON_VAR_REF_RE 하나만 쓴다.
// ⚠️ 이 매처는 **needle 파싱 전용**이며 canonical 판정에는 관여하지 않는다(I2: 선언 값 쪽 opaque
// layer는 `var(--shadow-xs)` 정확일치뿐 — 여기의 일반형 `var(--name)`과 혼동 금지).
function canonicalNeedleToken(needle) {
  const m = CANON_VAR_REF_RE.exec(normalizeDeclValue(needle));
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

  // M3(19R) — pins를 분류 결과에 **연결**한다(제거 대신 load-bearing화). 이전엔 pins가 순수 메타데이터라
  // 두 shadow entry의 pins를 서로 바꿔도 372 통과했다(=기능 없는 주석). 이제 각 핀 셀렉터의 relevant
  // 선언을 실제로 분류해 얻은 cls.id로 {id → [selector]} 맵을 역구성하고, CANONICAL_DECLS[].pins가 그것과
  // 정확히 일치함을 단정한다 — pins를 swap하면 여기서 RED가 난다.
  it('M3(19R): CANONICAL_DECLS[].pins ↔ 실제 분류 결과 정합 (핀 셀렉터의 cls.id = 그 셀렉터를 담은 entry.id, swap 시 RED)', () => {
    const selectorToId = {};
    for (const { selector, file } of PINNED) {
      const root = postcss.parse(compiledSiteCss(file));
      const { rootRules } = collectPinnedRules(root, selector);
      const ids = [];
      rootRules.forEach((rule) => rule.walkDecls((decl) => {
        const prop = normalizeProp(decl.prop);
        if (!isRelevantProp(prop)) return;
        const cls = classifyRelevantDecl(prop, decl.value);
        expect(cls.syntax, `${selector} { ${decl.prop}: ${decl.value} }`).toBe('canonical');
        ids.push(cls.id);
      }));
      expect(ids, `${selector}: relevant 선언 정확히 1개(도출 근거 describe가 보장)`).toHaveLength(1);
      selectorToId[selector] = ids[0];
    }
    // 분류 실측 → {id: [정렬된 selector]} 역구성
    const pinsFromClassification = {};
    for (const [selector, id] of Object.entries(selectorToId)) (pinsFromClassification[id] ||= []).push(selector);
    for (const id of Object.keys(pinsFromClassification)) pinsFromClassification[id].sort();
    // 메타데이터 → 동형
    const pinsFromMetadata = {};
    for (const entry of CANONICAL_DECLS) pinsFromMetadata[entry.id] = [...entry.pins].sort();
    expect(pinsFromClassification).toEqual(pinsFromMetadata);
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

  // 적대적 자가 재검토(18R, inventory 누락 클래스 — I4와 동종) — isProtectedSweepTarget은 `.scss`/`.css`
  // **두 확장자만** 대상으로 삼는다. 그래서 styles/ 아래에 다른 스타일 확장자(`.sass` 들여쓰기 문법,
  // `.less`, `.pcss` 등)가 추가되면 10R에 fonts.css가 그랬던 것과 **정확히 같은 방식으로** 스윕 밖으로
  // 새 나간다(파일은 로드되는데 게이트는 못 본다). 확장자 화이트리스트를 열어두는 대신, styles/ 아래
  // 실제 확장자 인벤토리 자체를 고정한다 — 새 확장자가 등장하면 여기서 먼저 RED가 나고 개발자가
  // isProtectedSweepTarget 확장 여부를 의식적으로 결정하게 된다(silent 누락 → 명시 결정으로 전환).
  it('styles/ 아래 확장자 인벤토리 고정 — .scss/.css 외 확장자가 생기면 RED(스윕 밖 silent 누락 방지)', () => {
    const exts = new Set(allFiles.filter((f) => f.includes('.')).map((f) => f.slice(f.lastIndexOf('.'))));
    expect([...exts].sort()).toEqual(['.css', '.scss']);
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
  // I1(18R, 적대적 자가 재검토에서 실측 발견): JS trim이면 `#6B7280<NBSP>`(브라우저에선 무효 값이라
  // 토큰이 적용되지 않는다)를 정상 hex로 둔갑시켜 대비 3.97로 통과했다 — CSS 공백 전용 trim으로 교체.
  const str = cssTrim(value);
  const hex = /^#([0-9a-fA-F]{6})$/.exec(str);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  // 엄격 CSS <number> 토큰만 허용(Important 1) — 느슨한 `[\d.]+`는 `1.`(trailing dot, CSS 불법 —
  // 브라우저는 이 선언을 폐기해 box-shadow가 none처럼 무효화된다)도 매치해 Number('1.')===1로
  // 정상 색상 취급했다(외부 검수 8라운드 실증). `\d+(?:\.\d+)?`(정수/소수)와 `\.\d+`(선행 점만) 두
  // 형태만 인정 — trailing dot·다중 소수점(`1.2.3`)·빈 채널은 전부 매치 실패로 null.
  // I1(18R, 적대적 자가 재검토): 구분자 공백도 CSS 5종만 허용한다. JS `\s*`는 `rgba(107,<NBSP>114,…)`
  // (브라우저는 무효 → 토큰 미적용)를 정상 색으로 파싱해 대비 단정을 통과시켰다 — 같은 과대 허용 클래스.
  const N = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const W = `[${CSS_WS_CLASS}]*`;
  const rgba = new RegExp(`^rgba?\\(${W}(${N})${W},${W}(${N})${W},${W}(${N})${W}(?:,${W}(${N})${W})?\\)$`).exec(str);
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

// M2(19R) — 모듈 스코프 승격(이전엔 다크 indicator describe 안의 지역 함수라 mutation으로 안 잠겼다).
// 최종 색값 해석: 리터럴(hex/rgba)이면 그대로, `var(--token)`이면 darkValuesMap으로 재귀 해석, 그 외는 null.
// var() 매치의 공백은 **CSS 5종 전용**이다(I1 손실 정규화 클래스) — 옛 `\s`/`trim()`으로 되돌리면 NBSP 등이
// 통과해 M2 직접 테스트가 RED가 된다. 순환 참조는 depth>5로 끊어 null(무한재귀 방지).
function resolveColorValue(value, darkValuesMap, depth = 0) {
  if (value == null || depth > 5) return null;
  if (parseColor(value)) return value;
  const m = new RegExp(`^var\\([${CSS_WS_CLASS}]*--([a-z0-9-]+)[${CSS_WS_CLASS}]*(?:,[\\s\\S]*)?\\)$`, 'i')
    .exec(cssTrim(value));
  if (!m) return null;
  const next = darkValuesMap[m[1]];
  if (next == null) return null;
  return resolveColorValue(next, darkValuesMap, depth + 1);
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

// I4(18R) — @property 등록 스윕. 이전까지 모든 스캔(findProtectedDeclarations·structuralGate·
// findUnprotectedDeclarations)은 **일반 declaration(decl.prop)만** 봤다. CSS `@property --color-x {
// syntax:"<color>"; inherits:false; initial-value:transparent; }`는 이름이 `atrule.params`에 있고 내부는
// syntax/inherits/initial-value라는 별개 디스크립터라 어느 스캔에도 잡히지 않았다(선재현 실측:
// offenders 0). 등록되면 그 토큰은 **더 이상 :root에서 상속되지 않고** initial-value를 쓰므로 자식
// 핀의 경계가 통째로 소실되는데 PINNED 선언 문자열은 그대로라 전 GREEN이다 — inventory 누락형
// false-green이다. 등록 **값**은 계산하지 않는다(문법 모델 추가 금지): 보호 접두 이름의 등록 자체를
// 금지한다. at-rule 이름도 escape/대소문자 변형(`@PROPERTY`, `@\70 roperty`)이 가능하므로 이 파일의
// 유일 디코더(decodeCssIdentifier)를 통과시킨 뒤 비교한다 — I3와 같은 "이름 비대칭" 재발 방지.
function findProtectedPropertyRegistrations(root) {
  const offenders = [];
  root.walkAtRules((atrule) => {
    if (decodeCssIdentifier(atrule.name).toLowerCase() !== 'property') return;
    const name = cssTrim(atrule.params);
    if (!hasProtectedPrefix(name)) return;
    offenders.push(`@property ${name}@${atrule.source?.start?.line}행(위치: ${describeLocation(atrule.parent)})`);
  });
  return offenders;
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
  // I1(18R): selectorMatches와 동일한 CSS 공백 전용 정규화 + 파서-레벨 JS trim 손실 가드를 적용한다.
  // `html[data-theme=dark]<NBSP>`가 JS trim으로 다크 블록으로 오인되던 경로를 fail-closed로 닫는다.
  const cssSafeSelector = (rule) =>
    (JS_ONLY_WS_RE.test(rule.selector) ? null : normalizeCssWhitespace(rule.selectors[0] ?? ''));
  const isPlainRoot = (rule) => rule.selectors.length === 1 && cssSafeSelector(rule) === ':root';
  const isDarkForm = (rule) =>
    rule.selectors.length === 1 && DARK_SELECTORS.includes(cssSafeSelector(rule));

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
  // I4(18R): @property 등록은 3블록(rule 노드) 안에 있을 수 없는 at-rule이므로 발견 즉시 위반이다.
  offenders.push(...findProtectedPropertyRegistrations(root));
  if (offenders.length > 0) {
    throw new Error(
      `_themes.scss 3블록 계약 위반: 보호 토큰(${PROTECTED_TOKEN_PREFIXES.join('/')}) 선언/등록이 3블록 밖에서 ` +
      `발견됨 — ${offenders.join('; ')}`,
    );
  }

  // I1(19R) shape contract — cascade winner를 **계산**하는 대신 "cascade가 자명해지는 형태"만 통과시킨다.
  // 각 블록에서 보호 토큰은 정확히 1개 선언(2개 이상=중복 offender)이고 !important를 쓰지 않는다(offender).
  // 이 유일 선언의 AST 값이 곧 baseline이다(buildBlockValues). 선재현(수정 전 현행 HEAD): LIGHT_BASELINE은
  // Object.fromEntries(후행 승리), SHADOW_XS_BASELINE.light는 정규식 .exec(첫 매치), buildDarkValues는
  // 다크 블록만 봐서 — 라이트에 `--shadow-xs: none !important` 중복이나 indicator `transparent !important`
  // 중복을 주입해도 372/372 통과했다(Chrome 계산값과 baseline이 어긋나는 false-green). 중복·!important
  // 자체를 offender로 접으면 "cascade가 자명"해져 첫/후행/중요도 어느 것을 읽든 결과가 같아진다 —
  // 그래서 게이트가 브라우저 cascade를 재구현할 필요가 없다(17R가 폐기한 실패 모드로 되돌아가지 않는다).
  // "0개"는 여기서 잡지 않는다: 모든 토큰이 모든 블록에 있는 게 아니며, 특정 토큰의 부재는 baseline
  // 단정(undefined ≠ 기대 리터럴)이 RED로 잡는다. escaped 이름(`\--color-x`)도 decodeCssIdentifier로
  // 실이름 그룹핑해 중복을 세므로 I3식 이름 비대칭 우회가 불가능하다.
  const shapeOffenders = [];
  for (const [blockName, rule] of [['라이트', lightRule], ['다크', darkRule], ['별칭', aliasRule]]) {
    const byToken = new Map(); // 디코딩된 실이름 → [{ important, line }]
    rule.walkDecls((decl) => {
      if (!hasProtectedPrefix(decl.prop)) return;
      const name = decodeCssIdentifier(decl.prop);
      if (!byToken.has(name)) byToken.set(name, []);
      byToken.get(name).push({ important: !!decl.important, line: decl.source?.start?.line });
    });
    for (const [name, ds] of byToken) {
      if (ds.length > 1) shapeOffenders.push(`${blockName} 블록 ${name} 선언 ${ds.length}개(중복 — cascade 비자명, ${ds.map((d) => `${d.line}행`).join('·')})`);
      for (const d of ds) if (d.important) shapeOffenders.push(`${blockName} 블록 ${name} !important(${d.line}행 — cascade 비자명)`);
    }
  }
  if (shapeOffenders.length > 0) {
    throw new Error(`_themes.scss shape contract 위반(보호 토큰 블록당 1선언·!important 금지): ${shapeOffenders.join('; ')}`);
  }

  return { root, lightRule, darkRule, aliasRule };
}

// 핀 대상 컴포넌트(및 임의 사이트 파일)가 보호 네임스페이스를 "선언"하는지 전수 검사한다(9라운드).
// 이 파일들은 var(--color-x) 같은 소비만 정상이고, `.Foo { --color-x: … }`처럼 조상 스코프에
// 재선언하면 그 서브트리 전체의 캐스케이드 값을 오염시킨다 — 컴포넌트는 소비 전용 계약이다.
// I4(18R): 일반 declaration에 더해 @property 등록(atrule.params)도 같은 계약으로 금지한다.
function findProtectedDeclarations(cssText) {
  const root = postcss.parse(cssText);
  const offenders = [];
  root.walkDecls((decl) => {
    if (!hasProtectedPrefix(decl.prop)) return;
    offenders.push(`${decl.prop}@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  offenders.push(...findProtectedPropertyRegistrations(root));
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

// P2(내부 리뷰) → **I4(18R)에서 폐쇄**. `@property --color-x { … }` 등록 at-rule은 프로퍼티명이
// atrule.params에 있어 decl.prop 기반 스캔 셋 모두가 놓쳤다(선재현 offenders 0). 이제
// findProtectedPropertyRegistrations가 findProtectedDeclarations(핀 5파일·P4 styles/ 전체 스윕)와
// structuralGate 양쪽에 배선돼 있다. **남는 명시 예외**: JS 런타임 `CSS.registerProperty({name:
// '--color-x', …})`는 CSS 텍스트가 아니라 이 정적 게이트의 입력 인벤토리(styles/**/*.{scss,css}) **밖**
// 이다 — 아래 "명시 예외 전수" describe가 이 범위를 문서·단정으로 고정한다(현재 레포 사용처 0건).

// I1(19R) — 한 블록의 "유일 선언 AST 값" 맵. shape contract(structuralGate)가 보호 토큰 블록당 1선언·
// !important 금지를 이미 강제했으므로, cascade를 계산할 필요 없이 그 유일 선언의 값을 그대로 읽는다
// (17R가 폐기한 cascade 재구현으로 돌아가지 않는다). 이전 buildDarkValues는 reduceEffectiveDecls로
// cascade winner를 **계산**했는데, 그건 "다른 baseline이 cascade에 취약"하다는 진단의 정확한 대상이었다.
// prop 키는 "--" 접두를 뗀 형태(예: "color-bg"). decodeCssIdentifier로 escaped 이름을 실이름으로 복원해
// 읽는다(shape contract의 중복 그룹핑과 동일 경로). custom property가 아닌 선언(color-scheme 등)은 제외.
function buildBlockValues(rule) {
  const values = {};
  rule.walkDecls((decl) => {
    const name = decodeCssIdentifier(decl.prop);
    if (!name.startsWith('--')) return;
    values[name.slice(2)] = cssTrim(decl.value);
  });
  return values;
}
// 라이트/다크 블록 baseline — structuralGate가 shape contract를 강제하므로, 중복·!important가 있으면
// 여기 도달하기 전에 throw한다(= 잘못된 baseline을 읽지 않는다). LIGHT_BASELINE·SHADOW_XS_BASELINE·
// 다크 대비 단정 전부가 이 두 진입점을 공유한다(로직 중복·drift 방지).
function buildLightValues(themesCss) {
  return buildBlockValues(structuralGate(themesCss).lightRule);
}
function buildDarkValues(themesCss) {
  return buildBlockValues(structuralGate(themesCss).darkRule);
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

// ─────────────────────────────────────────────────────────────────────────────
// I2(18R) — canonical opaque layer가 참조하는 `--shadow-xs`의 **값 자체**를 exact baseline으로 고정한다.
// 층 1은 `var(--shadow-xs)`를 "완전 그림자로 확장되는 불투명 레이어"로 **전제**하고 통과시킨다. 그
// 전제는 토큰 값에 달려 있는데 이전엔 아무도 검사하지 않았다: `_themes.scss`에서 `--shadow-xs: none`
// 으로 바꾸면 실 CSS가 `box-shadow: none, inset …`이 되어 **Chrome 계산값이 none**(레이어 문법 위반으로
// 선언 전체 폐기)인데도 선언 문자열은 그대로라 296/296 GREEN이었다. LIGHT_BASELINE과 동일한 방식으로
// 라이트·다크 두 값을 리터럴 고정한다 — 값이 바뀌면(none·무효값·톤 변경) 여기서 즉시 RED다.
// ─────────────────────────────────────────────────────────────────────────────
const SHADOW_XS_BASELINE = {
  light: '0 1px 2px rgba(0, 0, 0, 0.04)',
  dark: '0 1px 2px rgba(0, 0, 0, 0.4)',
};
describe('--shadow-xs exact baseline (I2 — canonical opaque layer 전제 보호)', () => {
  it('canonical opaque layer는 정확히 var(--shadow-xs) 하나다(전제의 대상 고정)', () => {
    expect(CANON_SHADOW_OPAQUE_LAYER).toBe('var(--shadow-xs)');
  });
  it('라이트 값이 실측 리터럴과 일치 — none/무효값 치환 시 RED', () => {
    // I1(19R): .exec 첫 매치(선재현 우회 지점) 대신 shape 강제 유일 선언 경로(buildLightValues)로 읽는다.
    expect(buildLightValues(css)['shadow-xs']).toBe(SHADOW_XS_BASELINE.light);
  });
  it('다크 값이 실측 리터럴과 일치 — none/무효값 치환 시 RED', () => {
    expect(buildDarkValues(css)['shadow-xs']).toBe(SHADOW_XS_BASELINE.dark);
  });
  it('두 값 모두 파싱 가능한 그림자 값이다(빈 값·none류 회귀 이중 방어)', () => {
    for (const [k, v] of Object.entries(SHADOW_XS_BASELINE)) {
      expect(v, k).toMatch(/^0 1px 2px rgba\(0, 0, 0, 0\.[0-9]+\)$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I1(19R) — baseline은 "유일 선언 AST 값"이다(shape contract). cascade winner를 계산하지 않는다.
// 선재현↔RED 대응표(각 mutation은 수정 전 현행 HEAD에서 372/372 통과 = false-green이었다):
//   (a) 라이트 --shadow-xs 뒤 `none !important` 중복 → SHADOW_XS_BASELINE.light가 .exec 첫 매치라 선행
//       '0 1px 2px…'를 읽어 통과(Chrome 계산값은 none). 이제 중복+important 둘 다 shape offender → throw.
//   (b) 라이트 indicator `transparent !important` 선행 중복 → LIGHT_BASELINE이 Object.fromEntries(후행
//       승리)라 후행 normal을 읽어 통과. 이제 중복+important shape offender → throw.
//   (c) 순서 반전(normal→important, important→normal) 양방향 → 어느 쪽도 중복이라 throw.
// ─────────────────────────────────────────────────────────────────────────────
describe('I1(19R) shape contract — 보호 토큰 블록당 1선언·!important 금지 (선재현↔RED)', () => {
  // 다크/별칭은 정상(각 1선언·important 없음)으로 고정하고 라이트 블록만 변형한다.
  const wrap = (lightBody) => `:root{${lightBody}}html[data-theme=dark]{--color-selected-indicator:#6B7280;--shadow-xs:0 1px 2px rgba(0,0,0,0.4)}:root{--color-b:3}`;
  const OK_LIGHT = '--color-selected-indicator:transparent;--shadow-xs:0 1px 2px rgba(0,0,0,0.04)';

  it('정상 형태(각 보호 토큰 1선언·!important 없음)는 통과하고 유일 선언 값을 읽는다', () => {
    const themes = wrap(OK_LIGHT);
    expect(() => structuralGate(themes)).not.toThrow();
    // 유일 선언 AST 값을 verbatim으로 읽는다(정규화·재포맷 없음 — 입력 그대로).
    expect(buildLightValues(themes)['shadow-xs']).toBe('0 1px 2px rgba(0,0,0,0.04)');
    expect(buildLightValues(themes)['color-selected-indicator']).toBe('transparent');
    expect(buildDarkValues(themes)['shadow-xs']).toBe('0 1px 2px rgba(0,0,0,0.4)');
  });

  it.each([
    ['(a) shadow-xs 뒤 none !important 중복', '--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:none !important'],
    ['(a\') shadow-xs 단순 중복(중요도 없이도 cascade 비자명)', '--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:0 2px 4px rgba(0,0,0,0.04)'],
    ['(b) indicator transparent !important 선행 중복', '--color-selected-indicator:transparent !important;--color-selected-indicator:transparent'],
    ['(b\') indicator 단일 !important', '--color-selected-indicator:transparent !important'],
    ['(c) 순서 normal→important', '--color-selected-indicator:transparent;--color-selected-indicator:red !important'],
    ['(c\') 순서 important→normal', '--color-selected-indicator:red !important;--color-selected-indicator:transparent'],
  ])('shape 위반 %s → structuralGate throw (선재현: 현행 HEAD baseline은 통과)', (_l, body) => {
    expect(() => structuralGate(wrap(body))).toThrow(/shape contract/);
  });

  it('baseline 빌더도 유일 선언 경로 — 라이트 중복 주입 시 buildLightValues가 값을 잘못 읽지 않고 throw', () => {
    const mutated = wrap('--color-bg:#FFFFFF;--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:none !important');
    expect(() => buildLightValues(mutated)).toThrow(/shape contract/);
  });

  it('escaped 이름 중복도 디코딩해 동일 토큰으로 그룹 — 우회 불가(I3식 이름 비대칭 방지)', () => {
    // raw `--shadow-xs`와 escaped `\--shadow-xs`(디코딩 결과 동일)는 같은 토큰 → 중복 offender.
    expect(() => structuralGate(wrap('--shadow-xs:0 1px 2px rgba(0,0,0,0.04);\\--shadow-xs:none'))).toThrow(/shape contract/);
  });

  it('실 _themes.scss는 shape contract를 만족한다(라이트/다크/별칭 전부 보호 토큰 1선언·!important 0)', () => {
    expect(() => structuralGate(css)).not.toThrow();
  });

  it('비보호 토큰(--x)은 shape contract 대상 아님 — 중복·!important 허용(대칭/역방향 게이트가 별도 처리)', () => {
    // structuralGate는 보호 접두(--color-/--track-/--shadow-)만 shape로 본다. --x 중복은 통과.
    const themes = `:root{--color-a:1;--x:A !important;--x:B}html[data-theme=dark]{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(themes)).not.toThrow();
  });
});

describe('다크 selected-indicator 값 시맨틱 고정 (SC 1.4.11 비텍스트 대비 3:1)', () => {
  // 9라운드: dark 블록의 존재·유일성·root-직속 여부·형태(selector 문자열)는 이제 structuralGate
  // (flat 3블록 계약, 파일 상단 참고)가 구조적으로 보장한다 — 위반 시 이 시점에 즉시 throw(위치
  // 포함 명시 메시지)한다. 구 collectDarkSelectorRules의 selector 열거 방식은 폐기됐다: 그 방식은
  // "감시할 selector 문자열 목록"에 의존해 목록 밖 selector(`:root`, `html[...]:root` 등)로 감싼
  // 우회를 놓쳤지만, structuralGate는 selector가 무엇이든 3블록 밖 보호 토큰 선언 자체를 금지하므로
  // 우회 불가능하다. I1(19R): darkRule "내부"의 중복 선언·!important는 이제 shape contract가 offender로
  // 접으므로(cascade가 자명), buildDarkValues는 cascade를 계산하지 않고 유일 선언 AST 값을 그대로 읽는다
  // (buildBlockValues). 7라운드째 문제였던 "다크 블록 내부 !important 개입"은 값 계산 이전에 structuralGate
  // throw로 막힌다. buildDarkValues는 대칭 구멍 B(아래 --color-input-border 대비 describe)와 공유하는 모듈 헬퍼다.
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
  // resolveColorValue는 M2(19R)에서 모듈 스코프로 승격됐다(헬퍼 직접 테스트 대상 — 파일 상단 정의).
  // 최종값이 rgba/hex 리터럴이면 그대로, `var(--token)` 참조면 darkValues(shape 강제 유일 선언 값)로 재귀
  // 해석한다. 리터럴도 토큰 참조도 아닌(복합 표현식 등) 값은 null → 호출부 not.toBeNull()이 RED로 떨어뜨린다.
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
      expect(CANON_VAR_REF_RE.test(normalizeDeclValue(value))).toBe(false);
      expect(classifyRelevantDecl('border', `1px solid ${value}`).syntax).toBe('non-canonical');
    });
    it('GREEN(무회귀): 정확한 var(--name)만 canonical 토큰 참조', () => {
      expect(canonicalNeedleToken('var(--color-input-border)')).toBe('color-input-border');
      expect(canonicalNeedleToken(' var(--color-selected-indicator) ')).toBe('color-selected-indicator');
      expect(() => canonicalNeedleToken('var(--x, #ccc)')).toThrow(/canonical/);
    });
  });

  describe('canonical box-shadow 레이어 분해 — 구 splitTopLevelLayers 계약 이관', () => {
    // 기대 갱신(18R I2): 이전엔 임의 토큰(`var(--x)`)도 canonical 레이어였다. 이제 허용 indicator
    // layer는 실측 전체 문자열 하나뿐이라 토큰 이름까지 고정된다.
    it('단일 레이어(핀 실측 전체 문자열)는 레이어 1개로 모델링', () => {
      const layers = canonicalShadowLayers(CANON_SHADOW_INDICATOR_LAYER);
      expect(layers).toHaveLength(1);
      expect(layers[0]).toEqual({ kind: 'inset', offsetX: 0, offsetY: 0, blur: 0, spread: 1, token: 'color-selected-indicator' });
    });
    it('임의 토큰 레이어(inset 0 0 0 1px var(--x))는 더 이상 canonical이 아니다 — 18R I2 축소', () => {
      expect(canonicalShadowLayers('inset 0 0 0 1px var(--x)')).toBeNull();
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
    it('정상 형태(핀 실측 전체 문자열)는 visible', () => {
      expect(ivis(CANON_SHADOW_INDICATOR_LAYER)).toBe(true);
    });
    // 기대 갱신(18R I2, GREEN→RED): `inset 0 0 0 2px var(--…)`는 층 2 가시성 계산상 spread>0이지만
    // **실핀에 없는 전체 문자열**이라 canonical 밖이다. "임의 길이·임의 레이어 조합 허용"이 곧 whitelist를
    // 작은 CSS 문법으로 되돌리는 경로였으므로(I2), 폭 변경도 개발자가 알아야 할 신호로 남긴다.
    it('실핀 밖 spread(2px)는 canonical 밖 — RED(18R I2 축소, 이전 GREEN)', () => {
      expect(ivis(`inset 0 0 0 2px var(--${IND})`)).toBe(false);
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
    // 기대 갱신(18R I2): spread 0 레이어는 이제 canonical 판정 단계에서 이미 탈락한다(실측 문자열 밖).
    // 층 분리(canonical 판정 ≠ 가시성 계산)는 border 도메인에서 계속 단정된다(width 0은 canonical).
    it('spread 0은 canonical 밖(18R I2) — 판정 단계에서 이미 RED', () => {
      const cls = classifyRelevantDecl('box-shadow', `inset 0 0 0 0 var(--${IND})`);
      expect(cls.syntax).toBe('non-canonical');
      expect(ivis(`inset 0 0 0 0 var(--${IND})`)).toBe(false);
    });
    it('무회귀: 핀 실측 spread(1px) 형태는 계속 visible', () => {
      expect(ivis(`inset 0 0 0 1px var(--${IND})`)).toBe(true);
    });
    // 층 2 가시성 계산(spread>0)이 공허하지 않음을 유지 — CANONICAL_DECLS의 레이어 모델을 직접 단정한다.
    it('canonical indicator layer 모델의 spread는 1(>0) — 층 2 가시성 입력 고정', () => {
      expect(canonicalShadowLayers(CANON_SHADOW_INDICATOR_LAYER)[0].spread).toBeGreaterThan(0);
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
    // 내부 리뷰 실증 — 벗기기 전엔 `-webkit-border-image`/`-webkit-box-shadow`가 startsWith('border')/
    // ===' box-shadow'에 안 걸려 relevant 밖으로 샜다(층 1 자체가 무력화되는 false-green). 커스텀
    // 프로퍼티(`--foo`)는 두 번째 문자가 `-`라 deprefix가 무영향임을 함께 고정한다.
    it('벤더 프리픽스(-webkit-/-moz-/-ms-/-o-)를 벗긴 뒤 판정 — alias도 relevant, 커스텀 프로퍼티는 무영향', () => {
      expect(isRelevantProp('-webkit-border-image')).toBe(true);
      expect(isRelevantProp('-webkit-box-shadow')).toBe(true);
      expect(isRelevantProp('-moz-box-shadow')).toBe(true);
      expect(isRelevantProp('-ms-border-radius')).toBe(false); // 벗겨도 radius는 여전히 경계 무관
      expect(isRelevantProp('-o-border-width')).toBe(true);
      expect(isRelevantProp('--webkit-color-x')).toBe(false); // 커스텀 프로퍼티(두 번째 문자 '-')는 deprefix 무영향
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

  it('19R 기대 갱신(cascade 계산→shape 위반): 다크 블록 escaped 중복(\\--color-selected-indicator)은 buildDarkValues가 값을 계산하기 전에 shape contract로 throw — escaped 이름도 디코딩해 동일 토큰으로 중복 카운트', () => {
    // 기대 갱신: 이전엔 buildDarkValues가 reduceEffectiveDecls로 후행 transparent를 cascade winner로 읽어
    // 회귀를 값으로 잡았다(=cascade 계산 의존). 19R shape contract는 보호 토큰 블록당 1선언을 강제하므로
    // 이 escaped 중복은 값 계산 이전에 구조 위반으로 접힌다(cascade 재구현 없이 더 강한 폐쇄). 디코더가
    // 중복 그룹핑에도 쓰이므로 raw `--color-selected-indicator`와 escaped `\--…`가 같은 토큰으로 묶인다.
    expect(() => buildDarkValues(escapedIndicatorThemes)).toThrow(/shape contract/);
    expect(() => structuralGate(escapedIndicatorThemes)).toThrow(/shape contract/);
  });

  it('normalizeProp 디코딩 계약 유지(cascade 레이어): reduceEffectiveDecls는 escaped prop(\\--color-x)을 실이름으로 디코딩해 동일 키로 통합한다 — effectiveValue 등 소비처가 여전히 escaped 선언을 놓치지 않는다', () => {
    // 12R-F5의 본래 관심사(normalizeProp가 decodeCssIdentifier를 선통과)는 reduceEffectiveDecls 층에서
    // 그대로 유지된다(effectiveValue·직접 소비처가 공유). _themes 층은 shape contract가 별도로 막는다.
    const root = postcss.parse('.x { --color-x: #6B7280; \\--color-x: transparent; }');
    const state = reduceEffectiveDecls([root.first], (decl, prop) => prop.startsWith('--'));
    expect(Object.keys(state)).toEqual(['--color-x']); // 두 선언이 같은 키로 통합
    expect(state['--color-x'].value).toBe('transparent'); // 후행 승리(cascade는 여전히 정확)
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
// I2(19R) — CORPUS "삭제 금지"를 실제로 보장한다. 이전엔 `CORPUS.length >= 90` count만 검사해서, 격리
// 사본에서 11R-A1 한 건을 삭제해도 113개가 여전히 >= 90이라 371/371 통과했다(RED 벡터라 GREEN ID 목록
// 에도 안 걸렸다 = 어디에도 안 잡힘). 처방: 114개 ID를 **순서까지** 고정한 exact manifest로 전체 인벤토리
// 비교 + ID uniqueness 단정(삭제 후 다른 ID 중복으로 개수 맞추는 우회 차단). 각 ID가 어느 라운드 계약
// 인지 그룹 주석으로 표기하고, 라운드별 개수도 고정한다. RED 벡터도 manifest에 포함되므로 삭제 시 걸린다.
// ─────────────────────────────────────────────────────────────────────────────
const CORPUS_MANIFEST = [
  // 11R 대칭 구멍 A(border 4면 cascade)/B (14)
  '11R-A1', '11R-A2', '11R-A3', '11R-A4', '11R-A5', '11R-A6', '11R-A7', '11R-A8', '11R-A9', '11R-A10',
  '11R-B1', '11R-B2', '11R-B3', '11R-B4',
  // 12R F2 색함수 wrapper / F3 border-image 도장 / F4 border 문법 전 노드 소비 (18)
  '12R-F2a', '12R-F2b', '12R-F2c', '12R-F2d', '12R-F2-GREEN',
  '12R-F3a', '12R-F3b', '12R-F3c', '12R-F3d', '12R-F3e', '12R-F3f', '12R-F3g',
  '12R-F4a', '12R-F4b', '12R-F4c', '12R-F4d', '12R-F4e', '12R-F4f',
  // 13R I2 var/box-shadow 유효성 / I3 directional 잔여 / I4 border-image 양방향 / D deferred (18)
  '13R-I2a', '13R-I2b1', '13R-I2b2', '13R-I2b3', '13R-I2b-G1', '13R-I2b-G2', '13R-I2b-G3',
  '13R-I3a', '13R-I3b',
  '13R-I4a', '13R-I4b', '13R-I4c',
  '13R-D1', '13R-D2', '13R-D3', '13R-D4', '13R-D5', '13R-D6',
  // 14R I1 longhand 삼분 / I2 indicator CSS-wide / I3 재귀 var / I4 border-image / I5 전이 / R1 시스템색 / R2 border-image longhand (35)
  '14R-I1a', '14R-I1b', '14R-I1c', '14R-I1d', '14R-I1e', '14R-I1f', '14R-I1g', '14R-I1h',
  '14R-I2a', '14R-I2b', '14R-I2c', '14R-I2d', '14R-I2e', '14R-I2f',
  '14R-I3a', '14R-I3b', '14R-I3c', '14R-I3d',
  '14R-I4a', '14R-I4b', '14R-I4c',
  '14R-I5-1b', '14R-I5-1i', '14R-I5-2b', '14R-I5-2i', '14R-I5-3b', '14R-I5-3i',
  '14R-R1a', '14R-R1b', '14R-R1c', '14R-R1d', '14R-R1e',
  '14R-R2a', '14R-R2b', '14R-R2c',
  // 15R M(헤드리스 Chrome 대조) / ADV(역방향) / EXC(명시 예외) (21)
  '15R-M1', '15R-M2', '15R-M3', '15R-M4', '15R-M5', '15R-M6', '15R-M6b', '15R-M7', '15R-M8', '15R-M9',
  '15R-M10', '15R-M11', '15R-M12', '15R-M13', '15R-M14', '15R-M15', '15R-M16',
  '15R-ADV1', '15R-ADV2', '15R-EXC-A', '15R-EXC-B',
  // 16R I1 env / I2 무효 hex / I3 색함수 구분자 (8)
  '16R-I1a', '16R-I1b', '16R-I1c', '16R-I2', '16R-I3a', '16R-I3b', '16R-I3c', '16R-I3d',
];
const CORPUS_ROUND_COUNTS = { '11R': 14, '12R': 18, '13R': 18, '14R': 35, '15R': 21, '16R': 8 };

describe('I2(19R) — CORPUS exact ordered manifest + uniqueness (삭제/중복 우회 폐쇄)', () => {
  it('manifest 자체가 114개·ID 중복 없음·라운드별 개수 고정', () => {
    expect(CORPUS_MANIFEST).toHaveLength(114);
    expect(new Set(CORPUS_MANIFEST).size).toBe(114);
    const byRound = {};
    for (const id of CORPUS_MANIFEST) { const r = id.match(/^(\d+R)/)[1]; byRound[r] = (byRound[r] || 0) + 1; }
    expect(byRound).toEqual(CORPUS_ROUND_COUNTS);
    expect(Object.values(CORPUS_ROUND_COUNTS).reduce((a, b) => a + b, 0)).toBe(114);
  });

  it('CORPUS 실제 ID 인벤토리 === manifest (순서 포함) — 삭제·재배치·추가 전부 RED', () => {
    // count만 보던 이전 게이트가 놓친 것을 여기서 잡는다: 배열 자체를 순서까지 비교한다.
    expect(CORPUS.map((c) => c.id)).toEqual(CORPUS_MANIFEST);
  });

  it('CORPUS ID uniqueness — 삭제 후 다른 ID 중복으로 개수 맞추는 우회 차단', () => {
    const ids = CORPUS.map((c) => c.id);
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(new Set(ids).size, `중복 ID: ${dups.join(', ')}`).toBe(ids.length);
  });

  it('선재현↔RED: 임의 1건(11R-A1) 삭제는 count-only(>=90)로는 못 잡지만 인벤토리·uniqueness가 잡는다', () => {
    const deleted = CORPUS.filter((c) => c.id !== '11R-A1').map((c) => c.id);
    // 선재현: 현행 HEAD의 `CORPUS.length >= 90`은 113개도 통과했다.
    expect(deleted.length).toBeGreaterThanOrEqual(90);
    // 인벤토리 비교는 삭제를 즉시 검출한다.
    expect(deleted).not.toEqual(CORPUS_MANIFEST);
    // 삭제 후 다른 ID를 중복해 개수(114)를 맞추는 우회도 uniqueness + 순서 비교가 잡는다.
    const deletedThenDup = [...deleted, '11R-A2'];
    expect(deletedThenDup).toHaveLength(114);
    expect(new Set(deletedThenDup).size).not.toBe(deletedThenDup.length); // uniqueness RED
    expect(deletedThenDup).not.toEqual(CORPUS_MANIFEST);                  // 순서 비교 RED
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
    // 적대적 재검토(I2와 동종 인벤토리 클래스): 8종 ID를 순서까지 고정 — 삭제/재배치 시 RED.
    expect(R17_REGRESSION_VECTORS.map((v) => v.id)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']);
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
  // 내부 리뷰 실증 — isRelevantProp이 `prop.startsWith('border')`/`=== 'box-shadow'`로만 판정하던 동안
  // `-webkit-border-image`/`-webkit-box-shadow` 같은 벤더 프리픽스 alias는 relevant 수집에서 아예
  // 빠졌다(=층 1이 그 선언을 못 보고 지나침 → canonical 위반 판정 자체가 실행 안 돼 항상 GREEN이었다).
  // Chrome/Safari 둘 다 이 alias를 지원하므로 실제 렌더는 도장/그림자 소멸인데 게이트는 GREEN — 상설
  // 회귀 벡터로 고정한다(styles/ 현재 사용 0건이라 latent이나, 15R VENDOR_PREFIX_RE/unprefixedFn이 17R
  // 삭제분에 함께 사라진 결과로 재발한 구멍이다).
  it('relevant 수집 누락 없음: 벤더 프리픽스 alias(-webkit-border-image)도 relevant로 복원돼 RED — 이전엔 미수집 false-green', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};-webkit-border-image:url(a.png)}`, CIB);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-webkit-border-image: url\(a\.png\)/);
  });
  it('relevant 수집 누락 없음: 벤더 프리픽스 alias(-webkit-box-shadow)도 relevant로 복원돼 RED — 이전엔 미수집 false-green', () => {
    const res = evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};-webkit-box-shadow:none}`, IND);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-webkit-box-shadow: none/);
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 명시 예외 **전수**(문구 축소, 18R) — 이 게이트의 보장은 "exact selector + 정적 styles 인벤토리
// (styles/**/*.{scss,css}) 범위 내"로 한정된다. 아래 4건은 그 범위 **밖**이며 이번 라운드에서도 닫지
// 못했다. 각 항목은 "알려진 한계"를 단정으로 고정한 것이지 계약이 아니다 — 수렴 선언 금지.
// ─────────────────────────────────────────────────────────────────────────────
describe('명시 예외 전수 — 게이트 범위 밖 경로(알려진 한계 고정, 계약 아님)', () => {
  // ① 셀렉터 동치성. M2(18R) 정정: 이전 테스트는 `.X` 핀에 무관한 `.b.a` 규칙을 붙여 "순서만 다른
  //    동일 복합 셀렉터"를 전혀 재현하지 못했다(그냥 남남인 셀렉터라 GREEN은 당연). 실제 동치 예외는
  //    **`.a.b` 대 `.b.a`** — CSS 의미론상 같은 요소를 고르는데 문자열 비교로는 다른 셀렉터다.
  it('① 셀렉터 동치성: .a.b 핀에 대해 .b.a 의 override는 후보에 안 들어온다', () => {
    const cssText = `.a.b{border:1px solid ${V}}.b.a{border:none}`;
    const res = evaluatePinnedContract(cssText, '.a.b', { kind: 'border', token: CIB });
    expect(res.rulesFound).toBe(1); // `.b.a` 규칙은 수집되지 않았다
    expect(res.visible).toBe(true); // ← 알려진 한계(실렌더는 border:none)
    // 대조: 문자열이 같으면 정상 수집돼 RED가 된다(위 GREEN이 "아무거나 GREEN"이 아님을 확인).
    expect(evaluatePinnedContract(`.a.b{border:1px solid ${V}}.a.b{border:none}`, '.a.b',
      { kind: 'border', token: CIB }).visible).toBe(false);
  });
  it('② 타 셀렉터 cascade: 더 높은 specificity의 override는 범위 밖', () => {
    const cssText = `.X{border:1px solid ${V}}.Foo .X{border:none}`;
    expect(evalBorderCss(cssText, CIB).visible).toBe(true); // ← 알려진 한계
  });
  it('③ 로컬 custom property 재정의: 핀 게이트 단독으론 GREEN — 폐쇄는 P4 스윕과의 합성에 의존', () => {
    const cssText = `.X{border:1px solid ${V};--color-input-border:transparent}`;
    expect(evalBorderCss(cssText, CIB).visible).toBe(true); // ← 알려진 한계
    // 전체 스위트가 RED로 수렴하는 건 이 재정의 자체를 잡는 P4가 별도로 있기 때문(합성 의존).
    // P4가 약화되거나(대상 파일 판정 밖) 우회되면 이 구멍이 그대로 열린다.
    expect(findProtectedDeclarations(cssText).length).toBeGreaterThan(0);
  });
  it('④ JS 런타임 CSS 쓰기(registerProperty·style.setProperty·JSX inline style·동적 <style> 텍스트)는 정적 styles 인벤토리 밖 — @property at-rule만 폐쇄(I4), 리터럴 JS 쓰기는 M1 스윕이 0건 고정', () => {
    // M1(18R→19R) 확장 기록: 예외④는 CSS.registerProperty **하나**가 아니라 런타임 생성 CSS/custom-property
    // 쓰기 **전체**다 — (a) el.style.setProperty('--color-x', …), (b) JSX `style={{ '--color-x': … }}`,
    // (c) 동적 <style> 텍스트 주입, (d) CSS.registerProperty. 이들은 styles/**/*.{scss,css}에 나타나지 않아
    // 이 정적 게이트의 입력 밖이다. CSS 텍스트 경로(@property)는 I4에서 닫혔지만 위 JS 경로는 열려 있다.
    expect(findProtectedDeclarations('@property --color-input-border{syntax:"<color>";inherits:false;initial-value:transparent}')
      .length).toBeGreaterThan(0);
    // .js 파일은 어떤 것도 스윕 대상이 아니다(styles 밖·확장자 밖 둘 다).
    expect(isProtectedSweepTarget('library/theme.js')).toBe(false);
    expect(isProtectedSweepTarget('components/Canvas/CanvasPageView.js')).toBe(false);
    // 단, "보호 토큰 이름을 JS에서 리터럴로 쓰는" 가장 흔한 회귀 경로만은 M1(19R) 인벤토리 스윕이 별도로
    // 0건 고정한다(아래 describe). 현행 근거: 레포의 유일한 setProperty는 --sticky-header-h(비보호)뿐.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M1(19R) — 예외④ 보강: components/·pages/ JS에서 **보호 토큰 리터럴 쓰기 0건**을 인벤토리로 잠근다.
// 런타임 CSS 쓰기 전면 폐쇄는 이 정적 게이트의 범위 밖이지만(예외④), 리터럴 보호 토큰 이름을 JS에서
// 직접 대입하는 가장 흔한 회귀 경로(inline style 키·setProperty·registerProperty·동적 <style>)만은
// grep 인벤토리로 0건 고정한다. 비보호 런타임 주입(--branch-color/--status-color/--accent/
// --sticky-header-h)은 보호 접두(--color-/--track-/--shadow-)가 아니라 자연히 제외된다.
// ─────────────────────────────────────────────────────────────────────────────
describe('M1(19R) — components/·pages/ JS 리터럴 보호 토큰 쓰기 0건 스윕 (예외④ 보강)', () => {
  const repoRoot = resolve(__dirname, '..');
  const jsFiles = ['components', 'pages'].flatMap((d) => {
    const dir = resolve(repoRoot, d);
    return readdirSync(dir, { recursive: true }).map(String)
      .filter((f) => f.endsWith('.js')).map((f) => resolve(dir, f));
  });
  // 보호 토큰 "쓰기"만 매치한다(소비 var(--color-x)는 제외). 세 형태:
  const WRITE_RES = [
    /--(?:color|track|shadow)-[a-z0-9-]+["'`]?\s*:/,             // 객체 키/CSS 선언: '--color-x': 또는 --color-x:
    /\.setProperty\(\s*["'`]--(?:color|track|shadow)-/,           // el.style.setProperty('--color-x', …)
    /registerProperty\(\s*\{[^}]*["'`]--(?:color|track|shadow)-/, // CSS.registerProperty({ name: '--color-x' })
  ];
  it('컴포넌트/페이지 JS가 충분히 수집된다(스윕 공허 방지)', () => {
    expect(jsFiles.length).toBeGreaterThan(100);
  });
  it('보호 토큰(--color-/--track-/--shadow-)을 리터럴로 쓰는 JS가 0건', () => {
    const offenders = [];
    for (const f of jsFiles) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.split('//')[0]; // 라인 주석 제외
        if (WRITE_RES.some((re) => re.test(code))) offenders.push(`${f.replace(repoRoot + '/', '')}:${i + 1}`);
      });
    }
    expect(offenders, `JS 리터럴 보호 토큰 쓰기 발견(런타임 주입은 게이트 밖 — 신설 시 명시 결정 필요): ${offenders.join('; ')}`).toEqual([]);
  });
  it('스윕 검출력(공허하지 않음): 합성 write는 잡고, read/비보호는 안 잡는다', () => {
    const writes = [
      `style={{ '--color-x': v }}`,
      `el.style.setProperty('--track-y', z)`,
      `CSS.registerProperty({ name: '--shadow-z' })`,
      '`--color-a: ${v}; border: 1px`',
    ];
    for (const s of writes) expect(WRITE_RES.some((re) => re.test(s)), s).toBe(true);
    const nonWrites = [
      'border: 1px solid var(--color-x)',                 // 소비(read)
      `el.style.setProperty('--sticky-header-h', h)`,     // 비보호 런타임 주입
      'var(--branch-color)',                              // 비보호 소비
    ];
    for (const s of nonWrites) expect(WRITE_RES.some((re) => re.test(s)), s).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18R 상설 회귀 벡터 — I1~I4 각각의 "선재현 실측(현행 HEAD에서 false-green)" ↔ "수정 후 RED"를 그대로
// 테스트로 굳힌다. 선재현 근거는 각 describe 머리주석에 실측값으로 기록돼 있다.
// ─────────────────────────────────────────────────────────────────────────────
// CSS가 공백으로 보지 않는(=ident 문자이거나 아예 불법인) JS-공백 코드포인트. 선재현에서 이 4종 각각이
// 셀렉터·box-shadow 값·border 값 3자리 모두에서 false-green이었다(12/12).
const NON_CSS_WS = {
  'NBSP U+00A0': '\u00A0',
  'EM SPACE U+2003': '\u2003',
  'ZWNBSP U+FEFF': '\uFEFF',
  'VERTICAL TAB U+000B': '\u000B',
};
// M2(19R) — **ECMAScript `\s` 전체 − CSS 공백 5종**의 완전 집합(20종). NON_CSS_WS(위 4종)는 대표 샘플일
// 뿐이라 U+2028/U+2029/U+202F/U+1680/U+2000–200A 등 미등재 문자가 회귀해도 못 잡았다. 이 완전 집합 +
// 완전성 단정으로 "JS_ONLY_WS_RE/NON_CSS_WS를 4종 전용으로 약화하면 RED"를 강제한다(실측 도출: BMP 스캔
// `/\s/.test(ch) && !CSS5.test(ch)`).
const JS_ONLY_WS_CODEPOINTS = [
  0x000B, 0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
];
const JS_ONLY_WS_CHARS = JS_ONLY_WS_CODEPOINTS.map((cp) => String.fromCodePoint(cp))
const hex4 = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

describe('I1(18R) — CSS 공백 전용 정규화(손실 정규화 폐쇄)', () => {
  it('CSS 공백 5종만 공백으로 취급한다(헬퍼 단위 계약)', () => {
    expect(normalizeCssWhitespace(' \t\n\f\r a \t\n\f\r ')).toBe('a');
    for (const [name, w] of Object.entries(NON_CSS_WS)) {
      expect(cssTrim(`a${w}`), name).toBe(`a${w}`);           // trim이 삼키지 않는다
      expect(normalizeCssWhitespace(`a${w}b`), name).toBe(`a${w}b`); // space로 바뀌지 않는다
      expect(JS_ONLY_WS_RE.test(w), name).toBe(true);
    }
    expect(JS_ONLY_WS_RE.test('.HomeTabs__Tab.is-on')).toBe(false); // 실핀 셀렉터는 무영향
  });

  it.each(Object.entries(NON_CSS_WS))('셀렉터 %s: 브라우저 기준 다른 셀렉터 → 핀에 수집되지 않는다(rulesFound 0)', (_name, w) => {
    // 선재현: 4종 전부 rulesFound=1(=`.X`로 오인해 PINNED 수집) → false-green의 진입점이었다.
    const res = evaluatePinnedContract(`.X${w}{border:1px solid ${V}}`, '.X', { kind: 'border', token: CIB });
    expect(res.rulesFound ?? 0).toBe(0);
    expect(res.visible).toBe(false);
  });

  it.each(Object.entries(NON_CSS_WS))('box-shadow 값 %s: 브라우저 계산값 none인데 canonical이었다 → non-canonical RED', (_name, w) => {
    const value = `inset${w}0 0 0 1px ${IV}`;
    expect(classifyRelevantDecl('box-shadow', value).syntax).toBe('non-canonical');
    expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible).toBe(false);
  });

  it.each(Object.entries(NON_CSS_WS))('border 값 %s: 동일 — non-canonical RED', (_name, w) => {
    const value = `1px${w}solid ${V}`;
    expect(classifyRelevantDecl('border', value).syntax).toBe('non-canonical');
    expect(evalBorderCss(`.X{border:${value}}`, CIB).visible).toBe(false);
  });

  it('토큰 값 경계의 비-CSS 공백도 JS trim으로 지워지지 않는다 — 다크 대비 단정이 RED로 떨어진다', () => {
    // `--color-selected-indicator: #6B7280<NBSP>`는 브라우저에서 무효(토큰 미적용)인데 JS trim은
    // 정상 hex로 둔갑시켰다. 이제 파싱 실패 → contrastOverBg 0 → 3:1 단정 RED.
    const themes = `
      :root { --color-bg: #FFFFFF; --color-selected-indicator: transparent; }
      html[data-theme=dark] { --color-bg: #0E0F11; --color-selected-indicator: #6B7280\u00A0; }
      :root { --color-alias-unused: 0; }
    `;
    const darkValues = buildDarkValues(themes);
    expect(darkValues['color-selected-indicator']).toBe('#6B7280\u00A0');
    expect(contrastOverBg(darkValues['color-selected-indicator'], darkValues['color-bg'])).toBe(0);
  });

  it('parseColor도 CSS 공백 전용 — 값 경계·구분자 NBSP는 null(과대 허용 폐쇄, 자가 재검토 발견분)', () => {
    // 발견 경위: I1 수정 후에도 `#6B7280<NBSP>`의 다크 대비가 3.97로 통과했다 — parseColor가 여전히
    // JS trim을 쓰고 rgba 구분자를 `\s*`로 받고 있었다(같은 클래스의 잔존 인스턴스).
    expect(parseColor('#6B7280\u00A0')).toBeNull();                 // 값 경계
    expect(parseColor('rgba(107,\u00A0114,128,1)')).toBeNull();     // 구분자 NBSP
    expect(parseColor('rgba(107,\u2003114,128,1)')).toBeNull();     // 구분자 EM SPACE
    // CSS 공백은 그대로 허용(과잉 RED 방지)
    expect(parseColor('  #6B7280\t')).toEqual({ r: 107, g: 114, b: 128, a: 1 });
    expect(parseColor('rgba(107,\t114,\n128, 1)')).toEqual({ r: 107, g: 114, b: 128, a: 1 });
  });

  it('_themes.scss 블록 키 추출도 CSS 공백 전용 — `--color-bg<NBSP>:`는 별개 토큰이라 키에서 빠진다', () => {
    expect([...extractTokenKeys('--color-bg: #fff; --color-x : #000;')]).toEqual(['color-bg', 'color-x']);
    expect([...extractTokenKeys('--color-bg\u00A0: #fff;')]).toEqual([]); // 매치 실패 → 대칭 단정이 RED
  });

  it('structuralGate 블록 형태 판정도 CSS 공백 전용 — NBSP 붙은 다크 셀렉터는 다크로 인정되지 않는다', () => {
    const cssText = `:root{--color-a:1}html[data-theme='dark']\u00A0{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(cssText)).toThrow(/2번째 블록\(다크\)/);
    const lightNbsp = `:root\u00A0{--color-a:1}html[data-theme='dark']{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(lightNbsp)).toThrow(/1번째 블록\(라이트\)/);
  });
});

describe('M2(19R) — NON_CSS_WS 완전성(ECMAScript \\s − CSS 5종 20문자) + resolveColorValue 직접 테스트', () => {
  it('JS_ONLY_WS_CHARS는 "ECMAScript \\s 전체 − CSS 5종"의 완전 집합이다 (4종 약화 시 RED)', () => {
    // BMP 전체를 스캔해 "JS 공백이지만 CSS 공백은 아닌" 코드포인트 집합을 실측하고 fixture와 대조한다.
    const css5 = new RegExp(`[${CSS_WS_CLASS}]`);
    const computed = [];
    for (let cp = 0; cp <= 0xFFFF; cp++) {
      const ch = String.fromCharCode(cp);
      if (/\s/.test(ch) && !css5.test(ch)) computed.push(cp);
    }
    expect([...JS_ONLY_WS_CODEPOINTS].sort((a, b) => a - b)).toEqual(computed.sort((a, b) => a - b));
    expect(JS_ONLY_WS_CHARS).toHaveLength(20);
    // JS_ONLY_WS_RE가 전 문자를 매치하고 CSS 5종은 매치하지 않는다(정규식-fixture 정합).
    for (const ch of JS_ONLY_WS_CHARS) expect(JS_ONLY_WS_RE.test(ch), hex4(ch)).toBe(true);
    for (const ch of [' ', '\t', '\n', '\f', '\r']) expect(JS_ONLY_WS_RE.test(ch)).toBe(false);
    // 대표 4종(NON_CSS_WS)이 완전 집합의 부분집합인지도 확인(약화 감시).
    for (const w of Object.values(NON_CSS_WS)) expect(JS_ONLY_WS_CHARS).toContain(w);
  });

  it.each(JS_ONLY_WS_CHARS.map((w) => [hex4(w), w]))(
    '완전 집합 %s: 셀렉터(rulesFound 0)·box-shadow 값·border 값 3자리 모두 게이트가 공백으로 오정규화하지 않는다',
    (_n, w) => {
      expect(evaluatePinnedContract(`.X${w}{border:1px solid ${V}}`, '.X', { kind: 'border', token: CIB }).rulesFound ?? 0).toBe(0);
      expect(classifyRelevantDecl('box-shadow', `inset${w}0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
      expect(classifyRelevantDecl('border', `1px${w}solid ${V}`).syntax).toBe('non-canonical');
    });

  // resolveColorValue — M2 승격 후 직접 테스트. 옛 `\s`/`trim()`으로 되돌리면 NBSP 케이스가 통과(RED).
  const dv = { 'color-x': '#6B7280', 'color-y': 'var(--color-x)', 'color-loop': 'var(--color-loop)' };
  it('리터럴 색(hex/rgba)은 그대로 반환', () => {
    expect(resolveColorValue('#6B7280', dv)).toBe('#6B7280');
    expect(resolveColorValue('rgba(1,2,3,0.5)', dv)).toBe('rgba(1,2,3,0.5)');
  });
  it('var(--token)은 darkValuesMap으로 재귀 해석(체인 포함)', () => {
    expect(resolveColorValue('var(--color-x)', dv)).toBe('#6B7280');
    expect(resolveColorValue('var(--color-y)', dv)).toBe('#6B7280'); // var→var→리터럴
  });
  it('var() 내부/경계의 CSS 공백은 허용(축약·trim 후 매치)', () => {
    expect(resolveColorValue('  var( --color-x ) \t', dv)).toBe('#6B7280');
  });
  it('NON_CSS_WS(NBSP/EM SPACE 등)는 var() 매치 실패 → null (옛 \\s/trim 회귀 잠금)', () => {
    expect(resolveColorValue('var( --color-x)', dv)).toBeNull();  // 여는 괄호 뒤 NBSP
    expect(resolveColorValue('var(--color-x )', dv)).toBeNull();  // 토큰 뒤 NBSP
    expect(resolveColorValue(' var(--color-x)', dv)).toBeNull();  // 값 경계 NBSP(trim 안 됨)
    expect(resolveColorValue('var(--color-x) ', dv)).toBeNull();  // 값 경계 EM SPACE
  });
  it('미정의 토큰·복합 표현식·null은 null(판정 불가 → 호출부 RED 유도)', () => {
    expect(resolveColorValue('var(--missing)', dv)).toBeNull();
    expect(resolveColorValue('calc(1px + 2px)', dv)).toBeNull();
    expect(resolveColorValue(null, dv)).toBeNull();
  });
  it('순환 참조는 depth 한계(>5)로 null(무한재귀 방지)', () => {
    expect(resolveColorValue('var(--color-loop)', dv)).toBeNull();
  });
});

describe('I2(18R) — canonical box-shadow를 실측 전체 문자열로 축소(과대 허용 폐쇄)', () => {
  it('허용 전체 값은 정확히 2가지 실측 문자열뿐 — 목록 고정', () => {
    expect(CANON_SHADOW_VALUES).toEqual([
      'inset 0 0 0 1px var(--color-selected-indicator)',
      'var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)',
    ]);
    // 이 2가지가 곧 핀 8곳 중 box-shadow 핀 2곳의 실측 값이다(아래 "도출 근거 고정" describe와 대응).
    expect(CANONICAL_DECLS.filter((e) => e.prop === 'box-shadow').map((e) => e.form)).toEqual(CANON_SHADOW_VALUES);
  });
  it('2가지 실측 문자열은 canonical + visible (무회귀)', () => {
    for (const value of CANON_SHADOW_VALUES) {
      expect(classifyRelevantDecl('box-shadow', value).syntax, value).toBe('canonical');
      expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible, value).toBe(true);
    }
  });
  it.each([
    ['미정의 토큰 opaque layer(브라우저는 선언 전체 폐기)', `var(--does-not-exist), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['다른 shadow 토큰(--shadow-md)', `var(--shadow-md), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['다른 shadow 토큰(--shadow-lg)', `var(--shadow-lg), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['보호 접두 밖 토큰', `var(--anything), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['레이어 순서 반전', `${CANON_SHADOW_INDICATOR_LAYER}, ${CANON_SHADOW_OPAQUE_LAYER}`],
    ['opaque layer 중복', `${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['indicator layer 중복', `${CANON_SHADOW_INDICATOR_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['opaque layer 단독(인디케이터 소실)', CANON_SHADOW_OPAQUE_LAYER],
    ['indicator 토큰만 다름', 'inset 0 0 0 1px var(--color-border)'],
    ['spread만 다름(2px)', 'inset 0 0 0 2px var(--color-selected-indicator)'],
    ['offset만 다름(1px)', 'inset 1px 0 0 1px var(--color-selected-indicator)'],
    ['단위만 다름(0.0625rem)', 'inset 0 0 0 0.0625rem var(--color-selected-indicator)'],
    ['콤마 뒤 공백 없음', `${CANON_SHADOW_OPAQUE_LAYER},${CANON_SHADOW_INDICATOR_LAYER}`],
  ])('RED: %s', (_label, value) => {
    // 선재현: 앞 두 벡터는 현행 HEAD에서 visible=true(false-green)였다.
    expect(classifyRelevantDecl('box-shadow', value).syntax, value).toBe('non-canonical');
    expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible, value).toBe(false);
  });
  it('opaque layer 자리에는 var(--shadow-xs) 정확일치만 — 일반 var(--name) 패턴은 판정에 쓰이지 않는다', () => {
    // CANON_VAR_REF_RE(needle 파서)는 var(--does-not-exist)를 여전히 매치한다 — 그러나 그 사실이
    // 선언 값 판정에 아무 영향을 주지 않는다는 것이 I2 축소의 요지다.
    expect(CANON_VAR_REF_RE.test('var(--does-not-exist)')).toBe(true);
    expect(classifyRelevantDecl('box-shadow', `var(--does-not-exist), ${CANON_SHADOW_INDICATOR_LAYER}`).syntax)
      .toBe('non-canonical');
  });
});

describe('I3(18R) — 벤더 프리픽스 relevant 선언은 전부 non-canonical(이름 비대칭 폐쇄)', () => {
  // 선재현: `-webkit-box-shadow: initial !important`·`-webkit-box-shadow: unset`이 인디케이터 핀에서
  // visible=true였다 — CSS-wide로 인정된 뒤 `prop === 'box-shadow'`에 미매치해 **border 셀**을 초기화하고
  // shadow 셀은 손대지 않았기 때문(relevance는 deprefix, evaluator는 raw 이름 = 비대칭).
  it.each([
    ['-webkit-box-shadow', 'initial'],
    ['-webkit-box-shadow', 'unset'],
    ['-webkit-box-shadow', 'inherit'],
    ['-webkit-box-shadow', 'none'],
    ['-moz-box-shadow', 'initial'],
    ['-moz-border-image', 'initial'],
    ['-webkit-border-image', 'unset'],
    ['-o-border-width', 'initial'],
    ['-ms-border-color', 'unset'],
    ['-webkit-box-shadow', 'inset 0 0 0 1px var(--color-selected-indicator)'], // 값이 canonical이어도 RED
    ['-webkit-border-image', 'url(a.png)'],
  ])('%s: %s 는 non-canonical', (prop, value) => {
    const cls = classifyRelevantDecl(prop, value);
    expect(cls).toEqual({ syntax: 'non-canonical', prop, value: normalizeDeclValue(value) });
  });

  it('인디케이터 핀: -webkit-box-shadow의 CSS-wide 리셋은 이제 RED (선재현 visible=true)', () => {
    for (const decl of ['-webkit-box-shadow:initial !important', '-webkit-box-shadow:unset', '-moz-border-image:initial']) {
      const res = evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_INDICATOR_LAYER};${decl}}`, IND);
      expect(res.visible, decl).toBe(false);
      expect(res.nonCanonical.length, decl).toBeGreaterThan(0); // border 셀 초기화 부작용이 아니라 canonical 위반으로 RED
    }
  });

  it('border 핀도 동일 — RED의 이유가 nonCanonical이다(부작용 경유 아님)', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};-moz-border-image:initial}`, CIB);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-moz-border-image: initial/);
    expect(res.border).toEqual({ width: 1, style: 'solid', token: CIB }); // 부작용 없음(셀 그대로)
  });

  it('수집(relevance)은 계속 deprefix한다 — 수집 누락(층 1 무력화)과 판정 거부는 별개 계약', () => {
    expect(isRelevantProp('-webkit-box-shadow')).toBe(true);
    expect(isRelevantProp('-moz-border-image')).toBe(true);
    expect(isRelevantProp('-ms-border-radius')).toBe(false);
    expect(isRelevantProp('--webkit-color-x')).toBe(false); // 커스텀 프로퍼티는 deprefix 무영향
  });

  it('프리픽스 없는 실핀 형태는 무회귀 GREEN', () => {
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_INDICATOR_LAYER).syntax).toBe('canonical');
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical');
  });
});

describe('I4(18R) — @property 등록 스윕(inventory 누락 폐쇄)', () => {
  const AT = (name) => `@property ${name} { syntax: "<color>"; inherits: false; initial-value: transparent; }`;
  it.each([
    ['--color-input-border'],
    ['--color-selected-indicator'],
    ['--shadow-xs'],
    ['--track-x'],
  ])('보호 접두 등록 %s 는 offender (선재현: offenders 0)', (name) => {
    const offenders = findProtectedDeclarations(AT(name));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatch(/@property/);
  });
  it('at-rule 이름 대문자 변형(@PROPERTY)도 동일하게 검출 — I3식 이름 비대칭 재발 방지', () => {
    expect(findProtectedDeclarations('@PROPERTY --color-x{syntax:"*";inherits:false}')).toHaveLength(1);
  });
  it('at-rule 이름 escape(@\\70 roperty)는 postcss가 파싱 거부 — P4 스윕이 offender로 표면화(fail-closed)', () => {
    // 디코더를 통과시켜도 도달할 수 없는 경로다: postcss.parse가 "At-rule without name"으로 throw한다.
    // 침묵 스킵이 아니라 sweepFileForProtectedDeclarations의 try/catch가 offender로 올려 RED가 된다.
    expect(() => findProtectedDeclarations('@\\70 roperty --color-x{syntax:"*";inherits:false}')).toThrow();
  });
  it('등록 이름 자체가 escape돼도 디코딩 후 검출', () => {
    expect(findProtectedDeclarations('@property \\--color-x{syntax:"*";inherits:false}')).toHaveLength(1);
    expect(findProtectedDeclarations('@property --\\63 olor-x{syntax:"*";inherits:false}')).toHaveLength(1);
  });
  it('@media 등으로 감싸도 walkAtRules 전수 방문으로 검출', () => {
    expect(findProtectedDeclarations(`@media (min-width:0){${AT('--color-x')}}`)).toHaveLength(1);
  });
  it('보호 접두 밖 이름(--brand-x)·대문자(--Color-x)는 미검출(오검출 방지)', () => {
    expect(findProtectedDeclarations(AT('--brand-x'))).toEqual([]);
    expect(findProtectedDeclarations(AT('--Color-x'))).toEqual([]);
  });
  it('다른 at-rule(@supports/@font-face)은 대상 아님', () => {
    expect(findProtectedDeclarations('@supports (display:block){.Foo{color:red}}')).toEqual([]);
    expect(findProtectedDeclarations('@font-face{font-family:X;src:url(a.woff2)}')).toEqual([]);
  });
  it('structuralGate도 @property 등록을 3블록 계약 위반으로 throw', () => {
    const cssText = `:root{--color-a:1}html[data-theme='dark']{--color-a:2}:root{--color-b:3}${AT('--color-input-border')}`;
    expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
  });
  it('P4 스윕 경로(sweepFileForProtectedDeclarations 판정 로직)와 동일 함수를 공유한다', () => {
    // findProtectedDeclarations가 단일 판정 지점이므로 styles/ 전체 스윕도 자동으로 @property를 본다.
    expect(findProtectedDeclarations(AT('--color-x')).length).toBeGreaterThan(0);
  });
  it('실 레포 styles/ 전체에 보호 접두 @property 등록이 없다(현행 0건 고정)', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const offenders = readdirSync(stylesDir, { recursive: true }).map(String)
      .filter(isProtectedSweepTarget)
      .flatMap((f) => {
        try { return findProtectedPropertyRegistrations(postcss.parse(siteCssText(f))).map((o) => `${f}: ${o}`); }
        catch (e) { return [`${f}: 파싱 실패 — ${String((e && e.message) || e).split('\n')[0]}`]; }
      });
    expect(offenders).toEqual([]);
  });
});

describe('M1(18R) — classifyRelevantDecl이 CANONICAL_DECLS를 직접 dispatch한다(단일 정본 증명)', () => {
  // 이전 classifier는 배열을 조회하지 않고 별도 regex(CANON_BORDER_RE 등)를 썼다 — entry의 prop/re를
  // 훼손해도 판정이 그대로여서 "CANONICAL_DECLS가 정본"이라는 주석이 사실이 아니었다. 아래 mutation이
  // 판정 결과를 실제로 바꾼다는 것이 단일화의 증거다(mutation 후 반드시 원복).
  const withMutated = (id, patch, fn) => {
    const entry = CANONICAL_DECLS.find((e) => e.id === id);
    const backup = { ...entry };
    try { Object.assign(entry, patch); fn(); } finally { Object.assign(entry, backup); }
  };
  it('canonical 결과에 판정한 entry.id가 실려 나온다(추적 가능성)', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V}`).id).toBe('border-shorthand');
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).id).toBe('box-shadow-indicator-only');
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[1]).id).toBe('box-shadow-opaque-then-indicator');
  });
  it('entry.re 훼손 → border 판정이 canonical에서 non-canonical로 바뀐다', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical');
    withMutated('border-shorthand', { re: /^__never__$/ }, () => {
      expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('non-canonical');
      expect(evalBorderCss(`.X{border:1px solid ${V}}`, CIB).visible).toBe(false);
    });
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical'); // 원복 확인
  });
  it('entry.prop 훼손 → 같은 값이 더 이상 box-shadow에서 매치되지 않는다', () => {
    withMutated('box-shadow-indicator-only', { prop: '__never__' }, () => {
      expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).syntax).toBe('non-canonical');
    });
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).syntax).toBe('canonical');
  });
  it('entry.build 훼손 → 층 2 가시성 계산 입력(모델)이 바뀌어 GREEN이 무너진다', () => {
    withMutated('box-shadow-indicator-only', { build: () => ({ form: 'box-shadow', layers: [] }) }, () => {
      expect(evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_VALUES[0]}}`, IND).visible).toBe(false);
    });
    expect(evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_VALUES[0]}}`, IND).visible).toBe(true);
  });
  it('배열 항목 수·prop 커버리지 고정 — 근거 없는 확장 금지', () => {
    expect(CANONICAL_DECLS.map((e) => e.id)).toEqual([
      'border-shorthand', 'box-shadow-indicator-only', 'box-shadow-opaque-then-indicator',
    ]);
    expect([...new Set(CANONICAL_DECLS.map((e) => e.prop))]).toEqual(['border', 'box-shadow']);
    for (const e of CANONICAL_DECLS) expect(typeof e.build, e.id).toBe('function');
  });
});
