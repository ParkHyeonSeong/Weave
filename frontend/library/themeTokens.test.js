import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile, compileString } from 'sass';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

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
function normalizeProp(prop) {
  return prop.startsWith('--') ? prop : prop.toLowerCase();
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

// 값 문자열에서 "다른 var() 안에 중첩되지 않은" 최상위 var() 호출들의 첫 번째 인자(토큰)만 모아
// 집합으로 반환한다. box-shadow처럼 콤마로 나열된 여러 최상위 var()(`var(--shadow-xs), inset …
// var(--color-selected-indicator)`)는 서로 중첩 관계가 아니므로 각각 독립적으로 전부 수집된다
// (HomeTabs 다중 그림자).
//
// 10라운드째 외부 검수(방향 전환): 7~9라운드에 걸쳐 문자열 리터럴·식별자 경계·escape 구멍을 수동
// 문자 스캐너에 땜질로 3차례 막았지만("quote/escape 추적 + 괄호 깊이 카운팅"을 직접 구현) 그때마다
// 새 변종이 나왔다 — 파서를 손으로 재발명하는 접근 자체가 구조적으로 leaky했다. postcss-value-parser
// (postcss 생태계 표준, zero-dep)로 교체해 문자열/식별자/괄호 처리를 AST 파서에 위임한다:
// 문자열 리터럴은 별도 'string' 타입 노드라 애초에 word/function 스캔 대상이 아니고(quote-tracking
// 불필요), `fakevar(`·`λvar(`·`fake\ var(`는 함수명이 정확히 'var'가 아니라 자연 배제되며(식별자
// 경계 whitelist 불필요), 중첩 fallback은 매치 시 walk 콜백이 `return false`를 반환해 자식 노드
// 방문 자체를 건너뛰므로(AST가 이미 괄호 깊이를 구조화해뒀다) 절대 방문되지 않는다. calc() 안의
// var()는 calc 함수 노드(value !== 'var')이므로 자식이 정상 방문돼 기존 계약(calc는 var가 아니므로
// descend)이 그대로 유지된다.
function outermostVarTokens(value) {
  const tokens = new Set();
  valueParser(String(value)).walk((node) => {
    if (node.type !== 'function' || node.value !== 'var') return; // var() 아닌 함수(calc 등)는 자식 방문 계속
    const firstWord = node.nodes.find((n) => n.type === 'word');
    const m = firstWord && /^--([a-zA-Z0-9-]+)$/.exec(firstWord.value);
    if (m) tokens.add(m[1]);
    return false; // 이 var(...) 의 자식(fallback 포함)은 절대 미방문 — 중첩 토큰 배제
  });
  return tokens;
}

// F2(12라운드) — outermostVarTokens는 wrapper 색함수(color-mix/rgb/oklch 등) 안에 중첩된 var까지
// descend해 수집하므로 "토큰을 쓴다"만 볼 뿐 "치환 후 최종 렌더색에 실제 기여하는가"는 못 본다:
// `color-mix(in srgb,var(--t) 0%,transparent)`(0% 기여=투명)·`rgb(var(--t))`(치환 후 채널 부족=불법)·
// `rgb(from var(--t) r g b / 0)`(alpha 0=투명)는 전부 토큰이 잡히지만 실렌더는 무효/투명이다.
// PINNED 계약상 최종 color component는 **직접 top-level `var(--token[, fallback])` 형태만** 유효하다 —
// wrapper 색함수의 계산 의미론(치환 후 문법 유효성·alpha·실합성 대비)은 미구현이라 fail-closed가 옳다.
// 이 함수는 값의 최상위(depth-0) 노드 중 var() 함수만 보고 첫 인자 토큰을 모은다 — 다른 함수로 감싸이면
// 그 노드는 var가 아니므로(그리고 descend하지 않으므로) 미수집된다. box-shadow 레이어처럼 top-level에
// [inset, 길이…, var()]가 나열되면 그 var()는 top-level이라 정상 수집된다(직접 var는 계속 GREEN).
function topLevelVarTokens(value) {
  const tokens = new Set();
  for (const node of valueParser(String(value)).nodes) {
    if (node.type !== 'function' || node.value !== 'var') continue;
    const firstWord = node.nodes.find((n) => n.type === 'word');
    const m = firstWord && /^--([a-zA-Z0-9-]+)$/.exec(firstWord.value);
    if (m) tokens.add(m[1]);
  }
  return tokens;
}

// box-shadow 값을 "최상위(depth-0) 콤마" 기준으로 레이어 분해한다. postcss-value-parser는 함수 인자
// 내부 콤마를 이미 그 함수 노드의 자식으로 묶어두므로, 최상위 노드 배열에 남아 있는 'div'(,) 노드만
// 레이어 경계다(중첩 fallback 콤마와 혼동 불가) — Important 2(인디케이터 가시성 구조 단정)가 소비.
function splitTopLevelLayers(value) {
  const parsed = valueParser(String(value));
  const layers = [[]];
  parsed.nodes.forEach((node) => {
    if (node.type === 'div' && node.value === ',') layers.push([]);
    else layers[layers.length - 1].push(node);
  });
  return layers.map((nodes) => valueParser.stringify(nodes).trim());
}

// CSS <length> word 판정 — 부호 옵션 + 정수/소수 + 옵션 단위. box-shadow의 offset-x/y·blur·spread,
// border의 width 판별에 공용으로 쓴다(spread 경로는 assertVisibleInsetShadowLayer가 동일 함수를
// 재사용하므로 이 판정을 고치면 두 경로 모두 자동 적용된다). `inset`·`solid` 같은 키워드나 var(...)
// (word가 아니라 function 노드라 애초에 words 목록에 안 잡힘)는 매치되지 않는다.
//
// 내부 리뷰 잔여 3(unitless 비영 길이): CSS 스펙상 단위 없는 <length>는 **0만** 유효하다(0 외
// unitless, 예: `border: 5 solid var(…)`·box-shadow spread `5`는 불법 CSS → 브라우저가 그 선언 전체를
// 폐기해 렌더는 `none`처럼 무효화된다). 이전 정규식은 단위를 완전히 옵션으로 둬 "5"도 유효 length로
// 오인했다(false-GREEN). 정규식 자체는 매치 형태만 확인하고, 단위가 없는 경우에는 값이 0인지 별도로
// 확인해 0 외 unitless는 미인정(false 반환 → 상위 호출부가 미지원/RED로 처리)한다.
//
// F4(12라운드) — `%`를 단위 목록에서 제거했다. 이 함수의 모든 소비처(border-width·box-shadow의
// offset/blur/spread)는 CSS 스펙상 <length>만 받고 <percentage>를 허용하지 않는다 — `border:1% solid …`·
// box-shadow `… 1% …`는 불법 CSS라 브라우저가 선언을 폐기한다. 이전엔 `%`가 단위로 있어 `1%`를 유효
// length로 오인했다(false-GREEN). 부호(`-?`)는 box-shadow offset/spread가 음수를 허용하므로 유지한다
// (blur 음수 금지는 assertVisibleInsetShadowLayer가 별도로, border-width 음수는 sideGeometryVisible의
// `>0`이 각각 처리).
const LENGTH_WORD_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|vh|vw|vmin|vmax|ch|ex|pt|pc|in|cm|mm|q)?$/i;
const LENGTH_UNIT_SUFFIX_RE = /(?:px|rem|em|vh|vw|vmin|vmax|ch|ex|pt|pc|in|cm|mm|q)$/i;
function isLengthWord(word) {
  if (!LENGTH_WORD_RE.test(word)) return false;
  if (LENGTH_UNIT_SUFFIX_RE.test(word)) return true; // 단위 있으면 값 무관 유효
  return parseFloat(word) === 0; // 단위 없으면 0만 유효(비영 unitless는 불법 CSS → 미인정)
}
function wordsOf(value) {
  return valueParser(String(value)).nodes.filter((n) => n.type === 'word').map((n) => n.value);
}

// Important 2(외부 검수 10라운드) — outermostVarTokens만으로는 "토큰을 쓰는지"만 볼 뿐 그 결과가
// 실제로 눈에 보이는 인디케이터인지는 안 본다. `box-shadow: var(--t)`(치환 후 불법값이면 선언 자체가
// 무효화돼 box-shadow가 `none`처럼 작동)나 `inset 0 0 0 0 var(--t)`(spread 0 — 색이 뭐든 렌더 폭이
// 0이라 안 보임)도 이전 코드는 GREEN이었다. 레이어(콤마 분해 후 기대 토큰을 쓰는 한 조각) 구조를
// 직접 단정한다: `inset` 키워드 존재 + length word 4개 이상(offset-x/y·blur·spread) + 4번째 length
// (spread)가 0보다 커야 함.
// F4(12라운드) — box-shadow 길이 grammar를 정확 소비한다. inset box-shadow의 <length> 나열은
// `offset-x offset-y <blur>? <spread>?`로 **최대 4개**다(5개 이상은 불법 CSS → 선언 폐기). 인디케이터가
// 가시이려면 spread(4번째)까지 필요하므로 정확히 4개여야 한다(`>= 4`는 여분 length를 놓쳐 false-GREEN:
// `inset 0 0 0 1px 2px var(--t)`가 통과했다 → `=== 4`). 또 blur(3번째 length)는 스펙상 non-negative라
// 음수면 선언이 폐기된다(`inset 0 0 -1px 1px var(--t)`가 이전엔 spread만 봐 통과 → blur 부호 검사 추가).
// `%`는 위 isLengthWord가 이미 length에서 배제하므로 `1%` spread는 length개수 하락으로 자연 탈락한다.
function assertVisibleInsetShadowLayer(layerValue) {
  const nonSpace = valueParser(String(layerValue)).nodes.filter((n) => n.type !== 'space');
  const words = nonSpace.filter((n) => n.type === 'word').map((n) => n.value);
  const hasInset = words.some((w) => w.toLowerCase() === 'inset');
  const lengths = words.filter(isLengthWord);
  const blur = lengths[2];
  const spread = lengths[3];
  const blurNonNegative = blur == null || parseFloat(blur) >= 0;
  const spreadPositive = spread != null && parseFloat(spread) > 0;
  // F4(12라운드) — 레이어의 모든 top-level 노드를 정확 소비한다. 허용 노드는 inset 키워드 / length word /
  // 단일 color(색함수 var·rgb 등 또는 hex·색키워드)뿐이다. 그 밖의 노드(div(comma·slash)·string·미지원
  // 함수(calc 등)·알 수 없는 word)가 하나라도 남으면 malformed(불법 CSS → 선언 폐기)로 비가시 처리한다 —
  // 이전엔 word에서 length만 세고 잔여를 무시해 `inset 0 0 0 1px junk var(--t)`·`… calc(2px) …`가 통과했다.
  // (COLOR_FUNCTIONS/COLOR_KEYWORDS는 아래에서 const로 정의 — 호출 시점엔 초기화 완료돼 있어 안전.)
  const isAllowedNode = (n) => {
    if (n.type === 'word') {
      const w = n.value.toLowerCase();
      return w === 'inset' || isLengthWord(n.value) || w[0] === '#' || COLOR_KEYWORDS.has(w);
    }
    if (n.type === 'function') return COLOR_FUNCTIONS.has(n.value.toLowerCase());
    return false;
  };
  const malformed = nonSpace.some((n) => !isAllowedNode(n));
  return {
    hasInset,
    lengthCount: lengths.length,
    spread,
    visible: hasInset && lengths.length === 4 && blurNonNegative && spreadPositive && !malformed,
  };
}

// 대칭 구멍 A(컨트롤러 발견, 승격핀 6곳) — border 가시성 판정을 "네 면 cascade 합성 엔진"으로 재구축한다
// (Important 1, 11라운드). 이전 assertVisibleBorder는 (a) BORDER_PROPS가 border-width/style·directional
// longhand를 아예 안 모으고, (b) 기대 토큰을 쓰는 최종 선언 값만 골라 그 안에서 flat wordsOf로 style/width를
// 읽어, 다음을 전부 false-green 처리했다(외부 검수 실증, RED-proof 7/7 재현):
//   · `border:…; border-width:0`      → border-width 미수집 → 여전히 shorthand의 1px로 판정
//   · `border:…; border-style:none`   → border-style 미수집 → 여전히 solid로 판정
//   · `border:…; border-color:transparent` → border-color가 shorthand 토큰을 덮었는데도 shorthand 값 잔존
//   · `border: calc(0px) solid var(…)` → wordsOf가 top-level word만 봐 calc(0px)를 "width 미지정=medium"으로 오인
//   · `border-width:0 !important; border:…`(non-imp) → shorthand가 important width를 못 덮는데 못 봄
//   · `border-left-width:0`            → directional 미수집 → 한 면 소실을 못 봄
// 해법: 같은 exact selector의 모든 border shorthand/longhand 선언을 문서 순서로 훑어 **네 면(top/right/
// bottom/left) × 세 성분(width/style/color)** 각각의 최종 {value, important, unsupported}를 상태 머신으로
// 합성한다. shorthand는 네 면 전 성분을 설정(생략 성분은 initial로 재설정: width=medium/style=none/
// color=currentcolor), directional/성분 longhand는 해당 면·성분만 덮는다. !important는 후행 non-important를
// 무조건 이기고 동급은 후행 승. 미지원 문법(calc/var가 width·style 위치 등)은 "미지정" 간주 금지 —
// unsupported로 표시해 fail-closed RED. perimeter는 네 면 모두 (기하학적 가시: style∈가시집합 & width가
// 명시적0 아님) AND (color가 기대 토큰을 outermost var로 실사용)일 때만 통과한다.
const VISIBLE_BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);
const INVISIBLE_BORDER_STYLE_KEYWORDS = new Set(['none', 'hidden']);
const BORDER_STYLE_KEYWORDS = new Set([...VISIBLE_BORDER_STYLES, ...INVISIBLE_BORDER_STYLE_KEYWORDS]);
const BORDER_WIDTH_KEYWORDS = new Set(['thin', 'medium', 'thick']); // <line-width> 키워드(전부 가시)
// var() 등 색을 산출할 수 있는 함수 + 색 키워드. calc()·unknown 함수는 여기 없어 → 미지원(fail-closed).
const COLOR_FUNCTIONS = new Set(['var', 'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix']);
const COLOR_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert']);
const BORDER_INITIAL = { width: 'medium', style: 'none', color: 'currentcolor' }; // CSS 스펙 initial
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'];
// F3(12라운드) — border-image 도장 모델. border-image-source가 non-none이면 네 면이 이미지로 대체
// 도장돼 일반 보더 색/토큰 계약이 의미 없어진다 → fail-closed. border shorthand는 border-image를 전부
// initial로 리셋한다(CSS 스펙). 나머지 성분(slice/width/outset/repeat)도 non-initial로 effective면 동일 fail-closed.
const BORDER_IMAGE_LONGHANDS = ['source', 'slice', 'width', 'outset', 'repeat'];
const BORDER_IMAGE_INITIAL = { source: 'none', slice: '100%', width: '1', outset: '0', repeat: 'stretch' };
const BORDER_IMAGE_LONGHAND_RE = /^border-image-(source|slice|width|outset|repeat)$/;
// border 계열만 인식: border / border-{side} / border-{width|style|color} / border-{side}-{width|style|color}.
// border-radius·border-collapse·border-spacing·border-image는 전부 미매치(perimeter 무관이라 무시가 맞다).
// 논리 프로퍼티(border-inline-*/border-block-* 등)도 이 정규식엔 미매치이지만, synthesizeBorderSides가
// walkDecls 안에서 BORDER_PROP_RE보다 먼저 별도 분기로 가로채 fail-closed 처리한다(아래 참고) —
// 이 정규식만으로 "미매치=무시해도 안전"은 아니다.
const BORDER_PROP_RE = /^border(?:-(top|right|bottom|left))?(?:-(width|style|color))?$/;

// shorthand의 top-level 노드 하나를 성분 슬롯으로 분류. 분류 불가(calc·unknown 함수/단어)면 null → 미지원.
function classifyBorderShorthandNode(node) {
  if (node.type === 'word') {
    const w = node.value.toLowerCase();
    if (BORDER_STYLE_KEYWORDS.has(w)) return { slot: 'style', value: node.value };
    if (BORDER_WIDTH_KEYWORDS.has(w) || isLengthWord(node.value)) return { slot: 'width', value: node.value };
    if (w[0] === '#' || COLOR_KEYWORDS.has(w)) return { slot: 'color', value: node.value };
    return null;
  }
  if (node.type === 'function') {
    if (COLOR_FUNCTIONS.has(node.value.toLowerCase())) return { slot: 'color', value: valueParser.stringify(node) };
    return null; // calc()·미지원 함수 → 미분류
  }
  return null;
}

// border/border-{side} shorthand → {width,style,color} 각각 {value, unsupported}. 생략 성분은 initial 재설정.
// 미분류 토큰이 하나라도 있거나 슬롯이 중복 채워지면(문법 오류) 세 성분 전부 unsupported로 fail-closed.
//
// F4(12라운드) — **모든 top-level 노드를 소비**한다. 이전엔 word/function만 필터링해 div(comma·slash)·
// string 노드를 조용히 버렸다 → `border:1px,solid var(…)`·`border:1px/solid var(…)`·
// `border:1px solid var(…) "junk"`가 남은 노드를 무시한 채 유효로 통과했다(false-GREEN). 이제 space만
// 건너뛰고, div/string/그 밖의 노드 타입은 미소비 잔여로 간주해 unsupported로 떨어뜨린다(word/function도
// classifyBorderShorthandNode가 분류 못 하면 동일). border shorthand의 1~4 성분은 공백 구분만 유효하므로
// top-level comma/slash는 즉시 문법 오류다.
function parseBorderShorthand(value) {
  const result = {
    width: { value: BORDER_INITIAL.width, unsupported: false },
    style: { value: BORDER_INITIAL.style, unsupported: false },
    color: { value: BORDER_INITIAL.color, unsupported: false },
  };
  const assigned = { width: false, style: false, color: false };
  let unsupported = false;
  for (const node of valueParser(String(value)).nodes) {
    if (node.type === 'space') continue; // 공백만 무해하게 스킵
    if (node.type !== 'word' && node.type !== 'function') { unsupported = true; continue; } // div(comma·slash)·string 등 = 미지원 잔여
    const c = classifyBorderShorthandNode(node);
    if (!c || assigned[c.slot]) { unsupported = true; continue; }
    result[c.slot] = { value: c.value, unsupported: false };
    assigned[c.slot] = true;
  }
  if (unsupported) for (const slot of ['width', 'style', 'color']) result[slot].unsupported = true;
  return result;
}

// 값을 top-level **공백만** 기준 그룹으로 분해(성분 longhand 1~4값 확장용). F4(12라운드) — 이전엔 콤마도
// 구분자로 인정해 `border-width:1px,1px`를 2값으로 쪼갰다(false-GREEN: border-width는 공백 구분만 유효).
// 콤마/슬래시(div) 자체의 미지원 판정은 parseBorderComponentLonghand가 별도로 하므로 여기선 공백만 나눈다.
function splitTopLevelSpaceGroups(value) {
  const groups = [];
  let cur = [];
  for (const node of valueParser(String(value)).nodes) {
    if (node.type === 'space') {
      if (cur.length) { groups.push(cur); cur = []; }
    } else cur.push(node);
  }
  if (cur.length) groups.push(cur);
  return groups.map((nodes) => valueParser.stringify(nodes).trim());
}

// margin식 1~4값 → [top,right,bottom,left] 확장.
function expandFourSides(cells) {
  const [a, b, c, d] = cells;
  if (cells.length === 1) return [a, a, a, a];
  if (cells.length === 2) return [a, b, a, b];
  if (cells.length === 3) return [a, b, c, b];
  return [a, b, c, d];
}

// 성분 longhand의 단일 값 그룹 하나를 {value, unsupported}로 검증. width=길이/키워드, style=가시/비가시 키워드,
// color=색 함수/hex/색 키워드만 인정. 그 외(calc·복합·미지원)는 unsupported → fail-closed RED.
function classifyComponentValue(component, group) {
  const nodes = valueParser(group).nodes.filter((n) => n.type === 'word' || n.type === 'function');
  if (nodes.length !== 1) return { value: group, unsupported: true };
  const node = nodes[0];
  if (component === 'style') {
    if (node.type === 'word' && BORDER_STYLE_KEYWORDS.has(node.value.toLowerCase())) return { value: node.value, unsupported: false };
    return { value: group, unsupported: true };
  }
  if (component === 'width') {
    if (node.type === 'word' && (BORDER_WIDTH_KEYWORDS.has(node.value.toLowerCase()) || isLengthWord(node.value))) return { value: node.value, unsupported: false };
    return { value: group, unsupported: true };
  }
  // color
  if (node.type === 'function' && COLOR_FUNCTIONS.has(node.value.toLowerCase())) return { value: group, unsupported: false };
  if (node.type === 'word' && (node.value[0] === '#' || COLOR_KEYWORDS.has(node.value.toLowerCase()))) return { value: node.value, unsupported: false };
  return { value: group, unsupported: true };
}

function parseBorderComponentLonghand(component, value) {
  // F4(12라운드) — border-{width|style|color} longhand는 공백 구분 1~4값만 유효하다. top-level
  // div(comma·slash)가 하나라도 있으면 즉시 문법 오류 → 네 면 전부 unsupported(fail-closed).
  if (valueParser(String(value)).nodes.some((n) => n.type === 'div')) {
    const bad = { value, unsupported: true };
    return [bad, bad, bad, bad];
  }
  const groups = splitTopLevelSpaceGroups(value);
  if (groups.length === 0 || groups.length > 4) {
    const bad = { value, unsupported: true };
    return [bad, bad, bad, bad];
  }
  return expandFourSides(groups.map((g) => classifyComponentValue(component, g)));
}

// 핵심: 매치 규칙들(문서 순서)의 모든 border 선언을 훑어 면×성분 최종 상태를 cascade 합성한다.
function synthesizeBorderSides(rules) {
  const sides = {};
  for (const side of BORDER_SIDES) {
    sides[side] = {
      width: { value: BORDER_INITIAL.width, important: false, unsupported: false },
      style: { value: BORDER_INITIAL.style, important: false, unsupported: false },
      color: { value: BORDER_INITIAL.color, important: false, unsupported: false },
    };
  }
  const applyCell = (side, component, cand, important) => {
    const cell = sides[side][component];
    if (cell.important && !important) return; // important가 후행 non-important를 이김
    cell.value = cand.value;
    cell.unsupported = cand.unsupported;
    cell.important = important;
  };
  // 네 면 전체(모든 성분)를 unsupported로 마킹 — 아래 두 fail-closed 분기(논리 프로퍼티·`all` 리셋)가 공유.
  const markPerimeterUnsupported = (rawValue, important) => {
    const cand = { value: rawValue, unsupported: true };
    for (const side of BORDER_SIDES) {
      applyCell(side, 'width', cand, important);
      applyCell(side, 'style', cand, important);
      applyCell(side, 'color', cand, important);
    }
  };
  // F3(12라운드) — border-image 성분도 cascade로 합성한다(!important·문서순서 반영). border shorthand는
  // 이 다섯 성분을 전부 initial로 리셋하고, border-image(-source/-slice/…) 선언은 해당 성분을 설정한다.
  const borderImage = {};
  for (const k of BORDER_IMAGE_LONGHANDS) borderImage[k] = { value: BORDER_IMAGE_INITIAL[k], important: false };
  const applyImageCell = (comp, value, important) => {
    const cell = borderImage[comp];
    if (cell.important && !important) return; // important가 후행 non-important를 이김
    cell.value = value;
    cell.important = important;
  };
  const resetBorderImage = (important) => {
    for (const k of BORDER_IMAGE_LONGHANDS) applyImageCell(k, BORDER_IMAGE_INITIAL[k], important);
  };
  rules.forEach((rule) => {
    rule.walkDecls((decl) => {
      const prop = normalizeProp(decl.prop);
      const important = !!decl.important;
      // 내부 리뷰 잔여 1(논리 프로퍼티) — border-inline-width/border-block-* 등은 실렌더에서 물리
      // 사이드(top/right/bottom/left)로 매핑돼 좌우 또는 상하 보더를 실제로 없앨 수 있는데
      // BORDER_PROP_RE가 물리 프로퍼티만 인식해 이런 선언을 조용히 무시했다(blind → false-GREEN).
      // 물리 매핑을 구현하는 대신 fail-closed: 전체 perimeter를 unsupported로 마킹해 RED로 떨어뜨린다.
      if (/^border-(inline|block)/.test(prop)) {
        markPerimeterUnsupported(decl.value.trim(), important);
        return;
      }
      // 내부 리뷰 잔여 2(`all` 리셋) — `all: unset|initial|revert`는 border를 포함한 거의 모든
      // 프로퍼티를 초기값/상속값으로 되돌리는데 BORDER_PROP_RE 밖이라 역시 blind 무시였다. `all`은
      // 스펙상 전역값(initial/inherit/unset/revert/revert-layer)만 허용하므로 값 종류를 따질 필요
      // 없이 prop이 'all'이면 무조건 전체 perimeter를 unsupported로 마킹한다.
      if (prop === 'all') {
        markPerimeterUnsupported(decl.value.trim(), important);
        return;
      }
      // F3 — border-image shorthand: source(및 나머지)를 설정. value가 'none'이면 source=none, 아니면
      // 원문(non-none)을 source로 둔다(우리는 source가 none인지만 판정하므로 세부 파싱 불필요).
      if (prop === 'border-image') {
        const v = decl.value.trim();
        applyImageCell('source', v.toLowerCase() === 'none' ? 'none' : v, important);
        return;
      }
      // F3 — border-image-{source|slice|width|outset|repeat} longhand: 해당 성분만 설정.
      const imgLong = BORDER_IMAGE_LONGHAND_RE.exec(prop);
      if (imgLong) {
        applyImageCell(imgLong[1], decl.value.trim(), important);
        return;
      }
      const m = BORDER_PROP_RE.exec(prop);
      if (!m) return;
      const [, sideGroup, compGroup] = m;
      const value = decl.value.trim();
      if (!compGroup) {
        // shorthand: border(4면) 또는 border-{side}(해당 면), 세 성분 전부 설정(생략=initial 재설정)
        const parsed = parseBorderShorthand(value);
        for (const side of sideGroup ? [sideGroup] : BORDER_SIDES) {
          applyCell(side, 'width', parsed.width, important);
          applyCell(side, 'style', parsed.style, important);
          applyCell(side, 'color', parsed.color, important);
        }
        // F3 — 전체 `border` shorthand(방향 없음)는 border-image를 initial로 리셋한다(CSS 스펙).
        // border-{side} shorthand는 border-image를 리셋하지 않는다.
        if (!sideGroup) resetBorderImage(important);
      } else if (!sideGroup) {
        // 성분 longhand 전체 면: border-{width|style|color} (1~4값 확장)
        const perSide = parseBorderComponentLonghand(compGroup, value);
        BORDER_SIDES.forEach((side, i) => applyCell(side, compGroup, perSide[i], important));
      } else {
        // directional 성분 longhand: border-{side}-{width|style|color} — 그 면·성분만
        applyCell(sideGroup, compGroup, classifyComponentValue(compGroup, value), important);
      }
    });
  });
  // F3 — 최종 border-image-source가 non-none이면 네 면이 이미지로 대체 도장되므로 일반 보더 색/토큰
  // 계약이 무의미 → fail-closed. 나머지 성분(slice/width/outset/repeat)이 non-initial로 남아도(effective) 동일.
  const imageActive = String(borderImage.source.value).trim().toLowerCase() !== 'none'
    || BORDER_IMAGE_LONGHANDS.some((k) => k !== 'source' && String(borderImage[k].value).trim() !== BORDER_IMAGE_INITIAL[k]);
  if (imageActive) {
    for (const side of BORDER_SIDES) {
      sides[side].width.unsupported = true;
      sides[side].style.unsupported = true;
      sides[side].color.unsupported = true;
    }
  }
  return sides;
}

// 한 면의 기하학적 가시성: width가 명시적 0이 아니고(미지원 아님) style이 가시 집합.
function sideGeometryVisible(side) {
  if (side.width.unsupported || side.style.unsupported) return false;
  if (!VISIBLE_BORDER_STYLES.has(String(side.style.value).toLowerCase())) return false;
  const wv = String(side.width.value).toLowerCase();
  if (BORDER_WIDTH_KEYWORDS.has(wv)) return true; // thin/medium/thick 전부 가시
  if (isLengthWord(side.width.value)) return parseFloat(side.width.value) > 0;
  return false; // 방어: 여기 오면 미지원
}
// 한 면의 color가 기대 토큰을 **직접 top-level var**로 실사용하는가(transparent·무토큰 override·
// wrapper 색함수(color-mix/rgb 등)로 감싸 계산상 무효면 false — F2 fail-closed).
function sideUsesToken(side, expectedToken) {
  return !side.color.unsupported && topLevelVarTokens(side.color.value).has(expectedToken);
}
// perimeter 계약: 네 면 모두 기하학적 가시 AND 기대 토큰 실사용.
function assertPerimeterVisible(sides, expectedToken) {
  const perSide = BORDER_SIDES.map((s) => ({
    side: s,
    geometryVisible: sideGeometryVisible(sides[s]),
    usesToken: sideUsesToken(sides[s], expectedToken),
    width: sides[s].width.value, style: sides[s].style.value, color: sides[s].color.value,
    unsupported: sides[s].width.unsupported || sides[s].style.unsupported || sides[s].color.unsupported,
  }));
  return { visible: perSide.every((p) => p.geometryVisible && p.usesToken), perSide };
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
  //
  // 외부 검수 10라운드째 — "토큰을 쓰는지"만 보고 "그 결과가 실제로 눈에 보이는지"는 아무도 안 봤다:
  //  ⑦ Important 2(indicator) — `box-shadow: var(--t)`(치환 후 불법값이면 선언 자체 무효화)나
  //     `inset 0 0 0 0 var(--t)`(spread 0, 렌더 폭 없음)도 토큰 사용 여부만으로는 GREEN이었다.
  //  ⑧ 대칭 구멍 A(컨트롤러 발견, border) — `border: 1px var(--x)`(style 생략→비가시), `border: 0
  //     solid var(--x)`(width 0), `border: 1px none var(--x)`도 동일하게 무보호였다.
  //
  // 외부 검수 11라운드째 — border 가시성을 "네 면 cascade 합성 엔진"으로 전면 재구축(Important 1):
  //  ⑨ `border:…; border-width:0 / border-style:none / border-color:transparent / border-left-width:0` 및
  //     `border: calc(0px) solid var(…)`(calc width를 미지정=medium으로 오인) 전부 이전엔 false-green이었다.
  //     아래 border 분기가 synthesizeBorderSides로 면×성분 최종값을 합성해 perimeter를 직접 단정한다.
  // 아래 it.each 본문에서 assertVisibleInsetShadowLayer(indicator)/assertPerimeterVisible(border)로 단정한다.
  // BORDER_PROPS는 이제 border/indicator 분기 판별용 마커일 뿐 — 실제 border 성분 수집은 synthesizeBorderSides
  // 내부의 BORDER_PROP_RE가 shorthand·성분·directional longhand를 전부 커버한다(구 화이트리스트 미수집 폐기).
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
  it.each(PINNED)('$label 가 컴파일된 규칙의 최종 유효 선언에서 기대 토큰을 사용하고 시각적으로 유효하다', ({ file, selector, props, needle }) => {
    const root = postcss.parse(compiledSiteCss(file));
    const rules = findRootRules(root, selector);
    expect(rules.length, `${selector} 규칙(root 직속·셀렉터 완전일치)을 컴파일된 ${file}에서 찾지 못함`).toBeGreaterThan(0);
    const [expectedToken] = topLevelVarTokens(needle); // needle(직접 var)도 동일 파서로 토큰화(정합성 보장)

    if (props === INDICATOR_PROPS) {
      // box-shadow는 콤마 레이어를 가질 수 있다(HomeTabs 다중 그림자) — 기대 토큰을 outermost var로
      // 쓰는 레이어를 찾아 그 레이어 하나만 구조 검사한다(Important 2).
      const final = effectiveValue(rules, props); // 매치 규칙 전부에 cascade(!important·후행승리) 적용한 최종값
      const finalValues = Object.values(final).map((v) => v.value);
      const layer = finalValues.flatMap(splitTopLevelLayers).find((l) => topLevelVarTokens(l).has(expectedToken)); // 직접 top-level var 레이어만(wrapper 색함수 fail-closed, F2)
      expect(layer, `${selector}의 최종 box-shadow에서 outermost var 토큰 "${expectedToken}"을 쓰는 레이어 미발견 (finalValues=${JSON.stringify(finalValues)})`).toBeDefined();
      const shape = assertVisibleInsetShadowLayer(layer);
      expect(shape.visible, `${selector} indicator 레이어가 구조적으로 비가시 — inset=${shape.hasInset}, length개수=${shape.lengthCount}, spread=${shape.spread} (layer="${layer}")`).toBe(true);
      return;
    }

    // 대칭 구멍 A: border 계열 — 네 면 cascade 합성 후 perimeter 가시성 + 기대 토큰 실사용 단정.
    const sides = synthesizeBorderSides(rules);
    const result = assertPerimeterVisible(sides, expectedToken);
    expect(
      result.visible,
      `${selector} border perimeter 비가시/토큰누락 — 기대 토큰 "${expectedToken}", 면별=${JSON.stringify(result.perSide)}`,
    ).toBe(true);
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
function findUnprotectedDeclarations(rules) {
  const offenders = [];
  for (const rule of rules) {
    rule.walkDecls((decl) => {
      if (!decl.prop.startsWith('--')) return;
      if (!hasProtectedPrefix(decl.prop)) offenders.push(`${decl.prop}@${decl.source?.start?.line}행`);
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
// outermostVarTokens/reduceEffectiveDecls)를 직접 단정해, 시뮬 재현 없이도 이후 라운드의 회귀를
// 상시 검출한다 — 8·9라운드 외부 검수 대응.
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

  describe('outermostVarTokens — postcss-value-parser 기반 (10라운드 방향 전환, 이전 수동 파서 회귀 유지)', () => {
    // 아래 케이스들은 7~9라운드 수동 문자 스캐너 시절 실증된 구멍의 재현이다 — 파서를
    // postcss-value-parser로 교체(10라운드)한 뒤에도 전부 동일하게 통과해야 한다(수용 기준).
    it('var 인자 내부 문자열의 "(" 는 깊이 계산을 안 흔든다 — outer만 수집, fallback 미수집', () => {
      expect(outermostVarTokens('var(--a, "(", var(--b))')).toEqual(new Set(['a']));
    });
    it('값 전체가 quoted 문자열이면 var()로 인정 안 함 — 공집합(string 노드는 word/function 스캔 대상 아님)', () => {
      expect(outermostVarTokens('"var(--x)"')).toEqual(new Set());
    });
    it('비ASCII 문자가 붙은 var(는 함수 호출로 인정 안 함 — 공집합(함수명이 "λvar" != "var")', () => {
      expect(outermostVarTokens('λvar(--x)')).toEqual(new Set());
    });
    it('식별자 접미로 붙은 var(는 함수 호출 아님 — 공집합(함수명이 "fakevar" != "var")', () => {
      expect(outermostVarTokens('fakevar(--x)')).toEqual(new Set());
    });
    it('검수 Minor(10라운드): escaped identifier(fake\\ var()도 함수 호출 아님 — 공집합(함수명이 "fake\\ var" != "var")', () => {
      expect(outermostVarTokens('fake\\ var(--x)')).toEqual(new Set());
    });
    it('calc() 안 var()는 다른 var()에 중첩된 게 아니므로 outermost — 콤마 나열 둘 다 수집', () => {
      expect(outermostVarTokens('calc(1px + var(--a)), var(--b)')).toEqual(new Set(['a', 'b']));
    });
    it('r5(9라운드 재현): fallback 안 escape(\\() 가 depth 오염을 안 일으킴 — outer만 수집, fallback 내부 var 미수집', () => {
      expect(outermostVarTokens('var(--a, \\(, var(--b))')).toEqual(new Set(['a']));
    });
    it('r5(9라운드 재현): 문자열 밖에 등장하는 \\" (이스케이프된 quote)가 스캔 전체를 삼키지 않음 — 뒤쪽 var()를 정상 수집', () => {
      expect(outermostVarTokens('\\" , var(--x)')).toEqual(new Set(['x']));
    });
  });

  describe('splitTopLevelLayers — box-shadow 콤마 레이어 분해 (Important 2 지원 함수)', () => {
    it('단일 레이어는 그대로 1개 배열', () => {
      expect(splitTopLevelLayers('inset 0 0 0 1px var(--x)')).toEqual(['inset 0 0 0 1px var(--x)']);
    });
    it('다중 그림자(HomeTabs)는 최상위 콤마로만 분해 — var() 내부 콤마와 혼동 없음', () => {
      expect(splitTopLevelLayers('var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)'))
        .toEqual(['var(--shadow-xs)', 'inset 0 0 0 1px var(--color-selected-indicator)']);
    });
  });

  describe('assertVisibleInsetShadowLayer — 인디케이터 가시성 구조 단정 (Important 2, 10라운드)', () => {
    it('정상 형태(inset+4 length+spread>0)는 visible', () => {
      expect(assertVisibleInsetShadowLayer('inset 0 0 0 2px var(--x)').visible).toBe(true);
    });
    it('invalid-shadow — var(--t) 단독(치환 후 불법값이면 선언 자체가 none처럼 무효화)은 FAIL', () => {
      expect(assertVisibleInsetShadowLayer('var(--t)').visible).toBe(false);
    });
    it('spread 0(inset 0 0 0 0 var(--t))은 렌더 폭이 없어 FAIL', () => {
      const shape = assertVisibleInsetShadowLayer('inset 0 0 0 0 var(--t)');
      expect(shape.spread).toBe('0');
      expect(shape.visible).toBe(false);
    });
    it('inset 키워드 없이 length 4개뿐이면(outset 그림자) FAIL — 인디케이터는 inset 계약', () => {
      expect(assertVisibleInsetShadowLayer('0 0 0 2px var(--x)').visible).toBe(false);
    });
    it('length가 4개 미만(blur만 있고 spread 없음)이면 FAIL', () => {
      expect(assertVisibleInsetShadowLayer('inset 0 0 2px var(--x)').visible).toBe(false);
    });
    // 내부 리뷰 잔여 3(unitless spread, isLengthWord 공유 경로) — offset-x/y·blur는 unitless 0으로
    // 생략되고 spread만 단위 없는 비영 값(`5`)을 쓰는 경우, 그 자체가 불법 CSS라 브라우저가 선언 전체를
    // 폐기한다(box-shadow가 none처럼 무효화). isLengthWord가 이제 unitless는 0만 인정하므로 "5"가
    // length word로 카운트되지 않아 length개수가 3으로 떨어지고, spread(4번째)가 없어 visible=false.
    it('unitless 비영 spread(inset 0 0 0 5 var(--t))는 불법 CSS — length개수 3으로 카운트, FAIL', () => {
      const shape = assertVisibleInsetShadowLayer('inset 0 0 0 5 var(--t)');
      expect(shape.lengthCount).toBe(3);
      expect(shape.spread).toBeUndefined();
      expect(shape.visible).toBe(false);
    });
    // 무회귀 확인 — 단위 있는 spread(1px)는 offset-x/y/blur가 unitless 0이어도 여전히 visible(true).
    it('무회귀: 단위 있는 spread(inset 0 0 0 1px var(--x))는 계속 visible', () => {
      expect(assertVisibleInsetShadowLayer('inset 0 0 0 1px var(--x)').visible).toBe(true);
    });
  });

  describe('border 4면 cascade 합성 엔진 — 대칭 구멍 A mutation matrix (Important 1, 11라운드)', () => {
    // 이 mutation들은 PINNED border 분기가 실제로 쓰는 synthesizeBorderSides→assertPerimeterVisible
    // 경로를 그대로 태운다(helper 단위가 아니라 통합 경로 검증). f114013 현행 모델에서는 A 7건 전부
    // visible=true(false-green, RED-proof 스크립트로 사전 확인)였고, 이 엔진에서 전부 올바른 RED로 뒤집힌다.
    const TOKEN = 'color-input-border';
    const V = 'var(--color-input-border)';
    // 지정 selector('.X')의 root-직속 규칙(들)을 문서 순서로 합성해 perimeter 가시성을 판정.
    const perimeterVisible = (cssText) =>
      assertPerimeterVisible(synthesizeBorderSides(findRootRules(postcss.parse(cssText), '.X')), TOKEN).visible;

    // A(RED) — 실뷰포트에서 보더가 소실/토큰 미사용인데 이전 모델이 false-green 처리하던 케이스.
    // 원 7종(11라운드) + 내부 리뷰 잔여 3종(논리 프로퍼티·`all` 리셋·unitless 비영 width) = 10종.
    it.each([
      ['shorthand 후 border-width:0 → 전면 width 0', `.X{border:1px solid ${V};border-width:0}`],
      ['shorthand 후 border-style:none → 전면 style none', `.X{border:1px solid ${V};border-style:none}`],
      ['shorthand 후 border-color:transparent → 토큰이 후행 override로 소실', `.X{border:1px solid ${V};border-color:transparent}`],
      ['border: calc(0px) solid var(…) → calc width는 미지원(fail-closed)', `.X{border:calc(0px) solid ${V}}`],
      ['shorthand 후 border-width:0 !important → important width 0', `.X{border:1px solid ${V};border-width:0 !important}`],
      ['border-width:0 !important 후 shorthand(non-imp) → important가 shorthand width를 이김', `.X{border-width:0 !important;border:1px solid ${V}}`],
      ['directional border-left-width:0 → 한 면 소실(perimeter 깨짐)', `.X{border:1px solid ${V};border-left-width:0}`],
      // 내부 리뷰 잔여 1 — 논리 프로퍼티는 물리 매핑을 구현하지 않고 fail-closed(전체 perimeter unsupported)로 닫는다.
      ['논리 프로퍼티 border-inline-width:0 → blind 무시 대신 fail-closed', `.X{border:1px solid ${V};border-inline-width:0}`],
      // 내부 리뷰 잔여 2 — `all` 리셋(border 포함 전체 초기화)도 동일하게 fail-closed.
      ['`all: unset` 리셋 → border 포함 전체 초기화, fail-closed', `.X{border:1px solid ${V};all:unset}`],
      // 내부 리뷰 잔여 3 — unitless 비영 width는 불법 CSS(브라우저가 선언 자체를 폐기) → isLengthWord가
      // 미인정해 classifyBorderShorthandNode가 분류 실패 → shorthand 전체 unsupported로 전파.
      ['border: 5 solid var(…) → unitless 비영 width는 불법 CSS, fail-closed', `.X{border:5 solid ${V}}`],
    ])('RED: %s', (_label, cssText) => {
      expect(perimeterVisible(cssText)).toBe(false);
    });

    // B(GREEN) — 실제로 가시 + 토큰 사용이라 계속 통과해야 하는 케이스(회귀 방지).
    it.each([
      ['border-width:0 후 shorthand → 전 성분 복원', `.X{border-width:0;border:1px solid ${V}}`],
      ['shorthand !important 후 border-width:0(non-imp) → important width 1px 유지', `.X{border:1px solid ${V} !important;border-width:0}`],
      ['directional 성분으로 4면 조립(width/style/color) → 전면 가시+토큰', `.X{border-width:1px;border-style:solid;border-color:${V}}`],
      // B4 라벨 정정(내부 리뷰 지적) — 이전 라벨은 "border-color 4값"이었지만 실제 CSS는 border-style
      // longhand의 1~4값 공백 확장(전면 solid)이다. shorthand가 세팅한 color 토큰은 그대로 유지된 채
      // style만 4값으로 재확인되는 케이스를 검증한다.
      ['border-style 콤마 아닌 4값 확장(전면 solid) → shorthand 토큰 유지, 전면 가시', `.X{border:1px solid ${V};border-style:solid solid solid solid}`],
    ])('GREEN: %s', (_label, cssText) => {
      expect(perimeterVisible(cssText)).toBe(true);
    });

    it('여러 root 규칙(문서 순서)에 걸친 cascade도 합성 — 후행 규칙 border-bottom-width:0이 이긴다(RED)', () => {
      const cssText = `.X{border:1px solid ${V}} .X{border-bottom-width:0}`;
      expect(perimeterVisible(cssText)).toBe(false);
    });
    it('border-radius/border-collapse 등 비-border 프로퍼티는 엔진이 무시(초기값 유지로 style none → RED)', () => {
      // border 성분 선언이 전무하면 style=initial none → 비가시. border-radius는 성분에 영향 없음을 확인.
      const sides = synthesizeBorderSides(findRootRules(postcss.parse('.X{border-radius:8px;border-collapse:collapse}'), '.X'));
      expect(sides.top.style.value).toBe('none');
      expect(assertPerimeterVisible(sides, TOKEN).visible).toBe(false);
    });

    // 엔진 서브함수 단위 검증 — 성분 파싱/확장/미지원 표시.
    it('parseBorderShorthand: 1px solid var(…) → width/style/color 정상, unsupported 없음', () => {
      const p = parseBorderShorthand(`1px solid ${V}`);
      expect(p.width).toEqual({ value: '1px', unsupported: false });
      expect(p.style).toEqual({ value: 'solid', unsupported: false });
      expect(p.color).toEqual({ value: V, unsupported: false });
    });
    it('parseBorderShorthand: 생략 성분은 initial 재설정 (1px → style none/color currentcolor)', () => {
      const p = parseBorderShorthand('1px');
      expect(p.style.value).toBe('none');
      expect(p.color.value).toBe('currentcolor');
    });
    it('parseBorderShorthand: calc(0px)(width 위치)는 세 성분 전부 unsupported', () => {
      const p = parseBorderShorthand(`calc(0px) solid ${V}`);
      expect(p.width.unsupported && p.style.unsupported && p.color.unsupported).toBe(true);
    });
    it('classifyComponentValue: transparent는 유효 색이나 토큰 없음, 0은 유효 width, calc()는 unsupported', () => {
      expect(classifyComponentValue('color', 'transparent')).toEqual({ value: 'transparent', unsupported: false });
      expect(classifyComponentValue('width', '0')).toEqual({ value: '0', unsupported: false });
      expect(classifyComponentValue('width', 'calc(0px)').unsupported).toBe(true);
    });
    it('expandFourSides: 1값→4면 동일, 2값→top/bottom·right/left, 3값→top/right·left/bottom', () => {
      expect(expandFourSides(['a'])).toEqual(['a', 'a', 'a', 'a']);
      expect(expandFourSides(['a', 'b'])).toEqual(['a', 'b', 'a', 'b']);
      expect(expandFourSides(['a', 'b', 'c'])).toEqual(['a', 'b', 'c', 'b']);
    });
    it('sideGeometryVisible: medium(미명시)은 가시, 명시적 0은 비가시', () => {
      expect(sideGeometryVisible({ width: { value: 'medium', unsupported: false }, style: { value: 'solid', unsupported: false } })).toBe(true);
      expect(sideGeometryVisible({ width: { value: '0', unsupported: false }, style: { value: 'solid', unsupported: false } })).toBe(false);
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
// 12라운드 회귀 게이트 — false-green 4건 구조 폐쇄. 각 mutation은 실제 게이트 진입점
// (findProtectedDeclarations·synthesizeBorderSides→assertPerimeterVisible·
// assertVisibleInsetShadowLayer)을 그대로 태워 현행 모델의 false-green을 상설 RED로 뒤집는다.
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
  it('escaped 대문자(\\43 olor-x=--Color-x)도 case-sensitive 비보호 → 미검출(GREEN)', () => {
    expect(rawDetect('-\\43 olor-x')).toEqual([]);
  });
  it('블록주석 안 escaped 이름은 Comment 노드라 미검출(GREEN)', () => {
    expect(findProtectedDeclarations(normalizeRawCss('.Foo { /* \\--color-x: red; */ color: blue; }'))).toEqual([]);
  });
  it('소비(var(\\--color-x))는 값이라 미검출(GREEN)', () => {
    expect(findProtectedDeclarations(normalizeRawCss('.Foo { border-color: var(\\--color-x); }'))).toEqual([]);
  });
});

describe('12R F2/F3/F4 — border perimeter 경로 mutation matrix', () => {
  const TOKEN = 'color-input-border';
  const V = 'var(--color-input-border)';
  const perimeterVisible = (cssText) =>
    assertPerimeterVisible(synthesizeBorderSides(findRootRules(postcss.parse(cssText), '.X')), TOKEN).visible;

  // F2 — 최종 color component가 직접 top-level var가 아니면(wrapper 색함수) fail-closed.
  it.each([
    ['color-mix 0% wrapper', `.X{border:1px solid color-mix(in srgb,${V} 0%,transparent)}`],
    ['rgb(var) wrapper', `.X{border:1px solid rgb(${V})}`],
    ['rgb(from var …/0) wrapper', `.X{border:1px solid rgb(from ${V} r g b / 0)}`],
  ])('F2 RED: %s → 직접 var 아님, fail-closed', (_l, cssText) => {
    expect(perimeterVisible(cssText)).toBe(false);
  });
  it('F2 GREEN: 직접 var(--expected) 는 계속 통과', () => {
    expect(perimeterVisible(`.X{border:1px solid ${V}}`)).toBe(true);
  });

  // F3 — border-image 도장 모델링. border shorthand는 border-image를 initial(none)로 리셋한다.
  it('F3 RED: border 뒤 투명 border-image → 일반 보더 미도장(fail-closed)', () => {
    expect(perimeterVisible(`.X{border:1px solid ${V};border-image:linear-gradient(transparent,transparent) 1}`)).toBe(false);
  });
  it('F3 GREEN: border-image 뒤 winning border shorthand가 border-image를 리셋 → 가시', () => {
    expect(perimeterVisible(`.X{border-image:linear-gradient(transparent,transparent) 1;border:1px solid ${V}}`)).toBe(true);
  });
  it('F3 RED: important border-image를 non-important border가 못 덮음 → fail-closed', () => {
    expect(perimeterVisible(`.X{border-image:linear-gradient(transparent,transparent) 1 !important;border:1px solid ${V}}`)).toBe(false);
  });

  // F4 — border 문법 전체 top-level AST 소비. 미소비 잔여/미지원 성분은 fail-closed.
  it.each([
    ['1% width(border-width % 불허)', `.X{border:1% solid ${V}}`],
    ['1px/solid(slash div 잔여)', `.X{border:1px/solid ${V}}`],
    ['1px,solid(comma div 잔여)', `.X{border:1px,solid ${V}}`],
    ['string junk 잔여', `.X{border:1px solid ${V} "junk"}`],
    ['border-width 1px,1px(top-level comma)', `.X{border:1px solid ${V};border-width:1px,1px}`],
  ])('F4 RED: %s → fail-closed', (_l, cssText) => {
    expect(perimeterVisible(cssText)).toBe(false);
  });
});

describe('12R F4 — box-shadow 문법 (% 불허·blur non-neg·length 개수 정확)', () => {
  it.each([
    ['1% spread(box-shadow % 불허)', 'inset 0 0 0 1% var(--t)'],
    ['negative blur(-1px)', 'inset 0 0 -1px 1px var(--t)'],
    ['5 lengths(개수 초과)', 'inset 0 0 0 1px 2px var(--t)'],
    // 적대적 재검토 잔여(같은 방향, F4 "알 수 없는 word/미지원 함수 잔여 = unsupported") 폐쇄:
    ['stray word 잔여(junk)', 'inset 0 0 0 1px junk var(--t)'],
    ['미지원 함수 잔여(calc)', 'inset 0 0 0 1px calc(2px) var(--t)'],
    ['top-level slash div 잔여', 'inset 0 0 0 / 1px var(--t)'],
  ])('F4 RED: %s → 비가시', (_l, layerValue) => {
    expect(assertVisibleInsetShadowLayer(layerValue).visible).toBe(false);
  });
  it('무회귀 GREEN: inset 0 0 0 1px var(--x) 는 계속 visible', () => {
    expect(assertVisibleInsetShadowLayer('inset 0 0 0 1px var(--x)').visible).toBe(true);
  });
});

describe('12R F2 — topLevelVarTokens & 인디케이터 wrapper 색함수 fail-closed', () => {
  it('직접 top-level var는 수집(GREEN, fallback 허용)', () => {
    expect(topLevelVarTokens('var(--color-input-border)')).toEqual(new Set(['color-input-border']));
    expect(topLevelVarTokens('var(--x, #ccc)')).toEqual(new Set(['x']));
  });
  it('box-shadow 레이어 top-level의 var는 수집(GREEN, 직접 var 인디케이터 유지)', () => {
    expect(topLevelVarTokens('inset 0 0 0 1px var(--color-selected-indicator)')).toEqual(new Set(['color-selected-indicator']));
  });
  it.each([
    ['color-mix 0% wrapper', 'color-mix(in srgb,var(--t) 0%,transparent)'],
    ['rgb(var) wrapper', 'rgb(var(--t))'],
    ['rgb(from var …/0) wrapper', 'rgb(from var(--t) r g b / 0)'],
    ['inset 인디케이터 color-mix wrapper', 'inset 0 0 0 1px color-mix(in srgb,var(--t) 0%,transparent)'],
  ])('%s 는 중첩 var라 미수집(RED, fail-closed)', (_l, value) => {
    expect(topLevelVarTokens(value).has('t')).toBe(false);
  });

  // 인디케이터 실경로(splitTopLevelLayers→topLevelVarTokens→assertVisibleInsetShadowLayer) 통합.
  const indicatorLayer = (boxShadow, token) =>
    splitTopLevelLayers(boxShadow).find((l) => topLevelVarTokens(l).has(token));
  it('인디케이터 RED: color-mix 0% wrapper 레이어는 미발견(직접 var 아님)', () => {
    expect(indicatorLayer('inset 0 0 0 1px color-mix(in srgb,var(--color-selected-indicator) 0%,transparent)', 'color-selected-indicator')).toBeUndefined();
  });
  it('인디케이터 GREEN: 직접 var 레이어는 발견 + 구조적 가시', () => {
    const layer = indicatorLayer('var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)', 'color-selected-indicator');
    expect(layer).toBe('inset 0 0 0 1px var(--color-selected-indicator)');
    expect(assertVisibleInsetShadowLayer(layer).visible).toBe(true);
  });
});

describe('12R F3/F4 — border-image·성분 grammar 단위', () => {
  const TOKEN = 'color-input-border';
  const V = 'var(--color-input-border)';
  const perimeterVisible = (cssText) =>
    assertPerimeterVisible(synthesizeBorderSides(findRootRules(postcss.parse(cssText), '.X')), TOKEN).visible;
  it('F3: border-image-source longhand(non-none)만으로도 fail-closed(RED)', () => {
    expect(perimeterVisible(`.X{border:1px solid ${V};border-image-source:linear-gradient(transparent,transparent)}`)).toBe(false);
  });
  it('F3: border-image-source:none(명시적)은 리셋과 동치 → 가시 유지(GREEN)', () => {
    expect(perimeterVisible(`.X{border:1px solid ${V};border-image-source:none}`)).toBe(true);
  });
  it('F3: 나머지 성분(border-image-slice non-initial) effective도 fail-closed(RED)', () => {
    expect(perimeterVisible(`.X{border:1px solid ${V};border-image-slice:5}`)).toBe(false);
  });
  it('F4: parseBorderComponentLonghand comma(1px,1px) → 전 면 unsupported', () => {
    expect(parseBorderComponentLonghand('width', '1px,1px').every((c) => c.unsupported)).toBe(true);
  });
  it('F4: parseBorderShorthand slash/comma/string 잔여 → 세 성분 unsupported', () => {
    for (const v of [`1px/solid ${V}`, `1px,solid ${V}`, `1px solid ${V} "junk"`]) {
      const p = parseBorderShorthand(v);
      expect(p.width.unsupported && p.style.unsupported && p.color.unsupported, v).toBe(true);
    }
  });
  it('F4: isLengthWord는 %를 length로 인정하지 않는다(border-width·box-shadow % 불허)', () => {
    expect(isLengthWord('1%')).toBe(false);
    expect(isLengthWord('1px')).toBe(true);
    expect(isLengthWord('0')).toBe(true);
  });
});
