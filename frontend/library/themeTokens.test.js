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
// ─────────────────────────────────────────────────────────────────────────────
// I4(15R) — **값 쪽 CSS 식별자 정규화**. prop 쪽(normalizeProp)만 decodeCssIdentifier를 타고 값 쪽은
// raw 문자열을 그대로 키워드 집합과 비교했다 — `border-color: tr\61 nsparent`(=transparent)·
// `box-shadow: … r\65 d`(=red)처럼 **유효한 CSS escape**를 미지 ident로 오인해 invalid(폐기)로 돌렸고,
// 그 결과 이전 토큰 선언으로 fallback해 GREEN이 됐다(브라우저는 override를 적용해 토큰이 실제로 소실).
// 두 겹으로 고친다:
//  (a) 구조 — postcss-value-parser는 hex escape의 **종료 공백**(`\61 `의 공백)을 값 구분자로 봐
//      `tr\61 nsparent`를 word 2개(`tr\61` + `nsparent`)로 쪼갠다. CSS 토크나이저는 이 공백을 escape의
//      일부로 소비하므로 실제로는 ident 1개다. parseValue가 파싱 직후 이 분할을 재결합한다. 이 패스는
//      **구조 정규화만** 하고 디코딩은 하지 않으므로 몇 번 적용해도 결과가 같다(멱등) — 그래서
//      stringify→재파싱 왕복(splitTopLevelLayers/splitTopLevelSpaceGroups)이 안전하다.
//  (b) 의미 — 식별자 비교 지점에서 **정확히 한 번** decodeCssIdentifier를 적용한다(identOf/lowerIdentOf).
//      prop 쪽과 **동일 함수**를 쓰되 입력은 항상 raw 노드 값이다. 문자열 predicate(isLengthWord/
//      isColorWord/isNumberPercentAngle 등)는 스스로 디코딩하지 않고 호출부가 identOf로 디코딩한 값을
//      넘긴다 — 디코딩 지점을 "노드 읽기 1곳"으로 고정해 이중 디코딩(`\5c` 계열)이 원천 불가능하게 한다.
const SINGLE_WS_RE = /^[ \t\n\f\r]$/;
// 값이 "미완결 hex escape"로 끝나는가(뒤따르는 공백 1개가 escape 종료자로 소비돼야 함). 짝수 개의
// 백슬래시(=escaped backslash)로 끝나는 경우는 매치되지 않는다(`a\\61`은 리터럴 `\`+`61`이라 미결합).
const TRAILING_HEX_ESCAPE_RE = /(?:^|[^\\])(?:\\\\)*\\[0-9a-fA-F]{1,6}$/;
function joinEscapedIdentNodes(nodes) {
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (Array.isArray(n.nodes)) joinEscapedIdentNodes(n.nodes); // 함수 인자 내부도 동일 정규화
    while (
      n.type === 'word' && TRAILING_HEX_ESCAPE_RE.test(n.value)
      && nodes[i + 1] && nodes[i + 1].type === 'space' && SINGLE_WS_RE.test(nodes[i + 1].value)
      && nodes[i + 2] && nodes[i + 2].type === 'word'
    ) {
      n.value = `${n.value} ${nodes[i + 2].value}`; // 공백은 escape 종료자 — ident 1개로 재결합
      nodes.splice(i + 1, 2);
    }
  }
  return nodes;
}
// 이 파일의 **모든 내부 값 파싱 진입점**. raw valueParser 직접 호출은 (의도적으로 raw를 검증하는)
// 단위 테스트에만 남긴다.
function parseValue(value) {
  const parsed = valueParser(String(value));
  joinEscapedIdentNodes(parsed.nodes);
  return parsed;
}
// 노드 하나의 식별자 의미값 — decodeCssIdentifier **1회** 적용 지점.
function identOf(node) { return decodeCssIdentifier(String(node.value)); }
function lowerIdentOf(node) { return identOf(node).toLowerCase(); }
// 전체 <dashed-ident>(I4) — `--` + name-code-point(영숫자/`_`/`-`/U+0080 이상). escape는 identOf가 이미
// 해석하므로 여기선 디코딩 결과만 검사한다. 이전 ASCII 정규식은 `var(--é)` 같은 **유효** custom-property
// 이름을 오거부해 "무효 var 문법 → 선언 폐기"로 흘려보냈다(브라우저는 deferred로 참여시킨다).
// custom property는 스펙상 case-sensitive이므로 대소문자는 보존한다(계약 유지).
const NAME_CODE_POINTS_RE = /^[A-Za-z0-9_\u0080-\u{10FFFF}-]*$/u;
function dashedIdentName(rawWord) {
  const decoded = decodeCssIdentifier(String(rawWord));
  if (!decoded.startsWith('--')) return null;
  const name = decoded.slice(2);
  return NAME_CODE_POINTS_RE.test(name) ? name : null;
}
// ─────────────────────────────────────────────────────────────────────────────

function outermostVarTokens(value) {
  const tokens = new Set();
  parseValue(value).walk((node) => {
    if (!isVarFunction(node)) return; // var() 아닌 함수(calc 등)는 자식 방문 계속 (함수명 case-insensitive)
    const firstWord = node.nodes.find((n) => n.type === 'word');
    const name = firstWord && dashedIdentName(firstWord.value);
    if (name != null) tokens.add(name);
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
// I2(13라운드) — var() 함수 노드의 **문법 유효성**을 검사하고 유효할 때만 첫 인자 토큰을 돌려준다.
// CSS 스펙상 var()의 인자는 `<custom-prop-ident> [, <declaration-value>]?` — 즉 첫 인자는 `--`로 시작하는
// custom-property 이름이고, 그 뒤에 무언가 더 있다면 **반드시 콤마(fallback 구분자)로 시작**해야 한다.
// 이전 구현은 `node.nodes.find(word)`로 첫 word만 집어 잔여 인자를 안 봤다 — 그래서 `var(--x garbage)`
// (콤마 없이 공백으로 이어진 잔여 = 불법 CSS, 브라우저가 선언 전체를 폐기)도 토큰을 수집해 perimeter가
// visible로 통과했다(false-green). 이제 첫 인자 뒤 노드가 콤마 div가 아니면 null을 반환해 무효 처리한다.
// I3(14R) — 함수명 'var'는 CSS 스펙상 ASCII case-insensitive다(VAR()/Var()도 var() 호출). 이전엔
// `node.value !== 'var'` 정확일치라 대문자를 "안전방향 fail-closed"로 오거부했다 — 정확 인정으로 정정.
// 이 파일의 모든 var() 판정을 이 헬퍼로 단일화한다(대소문자 drift 방지).
function isVarFunction(node) {
  return !!node && node.type === 'function' && lowerIdentOf(node) === 'var'; // I4(15R) 값 식별자 decode 1회
}
// I3(14R) — fallback 위치를 포함한 **모든 중첩 var()의 문법 재귀 검증**. CSS 스펙: var() 자체가(또는 그
// fallback 안 어떤 중첩 var()라도) 문법 위반이면 그 선언은 parse-time 무효다(계산시점 유예가 아니라 즉시
// 폐기 — Chrome none). 이전엔 outer 첫 인자만 봐서 `var(--t, var(--bad garbage))`(fallback 내부 malformed)를
// 유효로 오인해 토큰을 수집했다(false-green). 이제 fallback 노드를 재귀로 훑어 malformed 중첩 var가 하나라도
// 있으면 outer도 null(무효)로 반환한다. (malformed 외부가 정상 var를 감싼 반대 방향은 아래 첫 인자 잔여 검사가
// 이미 잡으므로 record-only 유지 — 외부 검수 인정.)
function allNestedVarsWellFormed(nodes) {
  for (const n of nodes) {
    if (n.type !== 'function') continue;
    if (isVarFunction(n)) { if (varFunctionToken(n) == null) return false; }
    else if (Array.isArray(n.nodes) && !allNestedVarsWellFormed(n.nodes)) return false; // calc 등 함수 내부 중첩 var도 검증
  }
  return true;
}
function varFunctionToken(node) {
  if (!isVarFunction(node)) return null;
  const args = node.nodes.filter((n) => n.type !== 'space' && n.type !== 'comment');
  if (args.length === 0) return null;
  const first = args[0];
  // I3(14R) — <dashed-ident>는 언더스코어를 포함한다(`--_name`은 유효 custom-property 이름). 이전
  // [a-zA-Z0-9-] 클래스는 `_`를 빠뜨려 유효 이름을 오거부했다(안전방향 fail-closed → 실제 규칙으로 정정).
  // I4(15R) — ASCII 정규식을 **전체 <dashed-ident>**(비ASCII·escape 포함)로 확장했다(dashedIdentName).
  const name = first.type === 'word' ? dashedIdentName(first.value) : null;
  if (name == null) return null;
  if (args.length > 1 && !(args[1].type === 'div' && args[1].value === ',')) return null; // 콤마 없는 잔여 인자 = 불법
  if (args.length > 2 && !allNestedVarsWellFormed(args.slice(2))) return null; // I3 — fallback 내부 중첩 var 재귀 검증
  return name;
}
function topLevelVarTokens(value) {
  const tokens = new Set();
  for (const node of parseValue(value).nodes) {
    if (!isVarFunction(node)) continue; // 함수명 case-insensitive(VAR() 인정, I3)
    const t = varFunctionToken(node); // 문법 유효한 var()만 토큰 수집(잔여 인자·중첩 malformed면 미수집, I2/I3)
    if (t) tokens.add(t);
  }
  return tokens;
}

// 13R 잔여1(내부 리뷰 실증, css-variables deferred validation) — CSS 스펙: 선언 값에 **well-formed
// var()**가(깊이 무관, I2a=varFunctionToken 기준 유효한 var() 참조) 하나라도 있으면 parse-time
// 문법검사가 computed-value time으로 유예된다 — 브라우저는 이런 선언을 폐기하지 않고 유효 선언으로
// cascade에 참여시킨다(승리하면 계산시점에 invalid-at-computed-value로 처리돼 초기값/상속값으로
// 귀결 — "이전 선언으로 fallback"이 아니라 "이 선언이 이겨서 계산시점에 무효화"). 아래 classifyBorder-
// ShorthandNode/parseBorderShorthand·isValidBoxShadow 계열이 "지원 grammar 불일치"를 발견했을 때 이
// 함수로 값 전체를 재검사해 invalid(폐기)를 unsupported(fail-closed)로 재분류한다.
// var() 노드를 찾으면 그 자식(fallback)은 미방문 처리한다(outermostVarTokens와 동일 관례 — 존재
// 여부만 필요하므로 fallback 내부까지 볼 필요 없고, 형제 노드 순회는 walk가 그대로 계속한다). calc()
// 등 var 아닌 함수 노드는 자식을 계속 방문해 중첩 var(예: `calc(1px + var(--x))`)도 정상 검출한다.
function valueHasWellFormedVar(value) {
  let found = false;
  parseValue(value).walk((node) => {
    if (!isVarFunction(node)) return; // 함수명 case-insensitive(I3)
    if (varFunctionToken(node) != null) found = true;
    return false;
  });
  return found;
}

// box-shadow 값을 "최상위(depth-0) 콤마" 기준으로 레이어 분해한다. postcss-value-parser는 함수 인자
// 내부 콤마를 이미 그 함수 노드의 자식으로 묶어두므로, 최상위 노드 배열에 남아 있는 'div'(,) 노드만
// 레이어 경계다(중첩 fallback 콤마와 혼동 불가) — Important 2(인디케이터 가시성 구조 단정)가 소비.
function splitTopLevelLayers(value) {
  const parsed = parseValue(value);
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
// M1(13라운드) — 표준 CSS <length> 단위 집합. 이전 목록(px/rem/em/vh/vw/…)은 최신 표준 단위(폰트상대
// lh·rlh, 뷰포트 논리축·동적·small·large 변형 vi/vb/svh/lvw/dvw…, 컨테이너 쿼리 cqw/cqi/cqmin…)를
// 거부해 유효 <length>를 미인정했다(false-RED 소지). %(percentage)는 <length>가 아니므로 계속 제외한다
// — 이 함수의 모든 소비처(border-width·box-shadow offset/blur/spread)는 <length>만 받고 <percentage>를
// 허용하지 않는다. 단위 목록을 단일 배열로 두고 두 정규식(전체형·접미확인)을 여기서 파생해 drift를 막는다.
const LENGTH_UNITS = [
  'px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', // 절대
  'em', 'rem', 'ex', 'rex', 'ch', 'rch', 'cap', 'rcap', 'ic', 'ric', 'lh', 'rlh', // 폰트 상대
  'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', // 뷰포트(기본)
  'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax', // small viewport
  'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax', // large viewport
  'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax', // dynamic viewport
  'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax', // 컨테이너 쿼리
];
const LENGTH_UNIT_ALT = LENGTH_UNITS.slice().sort((a, b) => b.length - a.length).join('|'); // 긴 것 우선(부분매치 방지)
const LENGTH_WORD_RE = new RegExp(`^-?(?:\\d+\\.?\\d*|\\.\\d+)(?:${LENGTH_UNIT_ALT})?$`, 'i');
const LENGTH_UNIT_SUFFIX_RE = new RegExp(`(?:${LENGTH_UNIT_ALT})$`, 'i');
function isLengthWord(word) {
  if (!LENGTH_WORD_RE.test(word)) return false;
  if (LENGTH_UNIT_SUFFIX_RE.test(word)) return true; // 단위 있으면 값 무관 유효
  return parseFloat(word) === 0; // 단위 없으면 0만 유효(비영 unitless는 불법 CSS → 미인정)
}
function wordsOf(value) {
  return parseValue(value).nodes.filter((n) => n.type === 'word').map(identOf); // I4(15R) decode 1회
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
  const nonSpace = parseValue(layerValue).nodes.filter((n) => n.type !== 'space');
  const words = nonSpace.filter((n) => n.type === 'word').map(identOf); // I4(15R) decode 1회
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
      const ident = identOf(n); // I4(15R) — 값 식별자 decode 1회(escape된 inset/색키워드 인정)
      const w = ident.toLowerCase();
      return w === 'inset' || isLengthWord(ident) || w[0] === '#' || COLOR_KEYWORDS.has(w);
    }
    if (n.type === 'function') return COLOR_FUNCTIONS.has(lowerIdentOf(n));
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

// I2(13라운드) — box-shadow **선언 전체 최종값**의 문법 유효성. assertVisibleInsetShadowLayer는 토큰을
// 쓰는 한 레이어만 보므로, 형제 레이어가 무효(`junk, inset …`)거나 토큰 레이어 자체가 무효(inset 중복·
// color 2개)여도 통과했다(false-green). CSS box-shadow 한 레이어 문법은 `<inset>? && <length>{2,4} &&
// <color>?` — inset≤1·color≤1·length 2~4개이며 다른 토큰이 끼면 불법. 한 레이어라도 무효면 브라우저는
// **선언 전체를 폐기**하므로(폐기 의미론) 아래 유효성 검사가 실패하면 그 box-shadow 선언은 cascade에서
// 제외돼 이전 유효 선언으로 fallback한다(evaluateIndicatorVisibility의 predicate가 소비). 레이어 전체가
// 단일 var()면 완전 그림자로 확장되는 불투명 레이어라 내부를 볼 수 없어 유효로 간주한다(HomeTabs의
// `var(--shadow-xs)`). var() 문법 자체가 무효면(잔여 인자) 그 레이어는 무효다.
//
// I3(15R, 구조 전환) — **boolean → 선언 단위 삼분**. 이전 isValidShadowLayer는 "유효/무효" 두 값만
// 돌려줘 성격이 정반대인 두 부류가 같은 통으로 들어갔고, 그래서 양방향 오류가 났다:
//   · `calc(1px + 1vw)`는 **표준 <length>**(브라우저가 받아들이는 유효 선언)인데 무효로 봐 폐기했다 →
//     그 선언이 이겨야 하는데 cascade에서 빠지고 **이전 인디케이터가 부활**했다(false-green).
//   · `rgb(from red)`·`color-mix(in srgb)`처럼 **인자가 빠진** 색 함수는 명백한 문법 위반인데 유효로
//     통과시켰다 → 브라우저는 선언 전체를 폐기하는데 게이트는 후행 선언을 채택했다.
// 이제 레이어를 'valid' | 'unsupported'(표준이나 우리가 계산 못 함 — cascade 참여, fail-closed) |
// 'invalid'(확실한 문법 위반 — 선언 폐기)로 삼분하고, 선언 값은 레이어들의 **최악값**으로 접는다
// (invalid > unsupported > valid). deferred(well-formed var) 재분류는 호출부 classifyBoxShadowDecl가 담당.
const SHADOW_RANK = { valid: 0, unsupported: 1, invalid: 2 };
const worseClass = (a, b) => (SHADOW_RANK[a] >= SHADOW_RANK[b] ? a : b);
function classifyShadowLayer(layerValue) {
  const nonSpace = parseValue(layerValue).nodes.filter((n) => n.type !== 'space' && n.type !== 'comment');
  if (nonSpace.length === 0) return 'invalid';
  if (nonSpace.length === 1 && isVarFunction(nonSpace[0])) return varFunctionToken(nonSpace[0]) != null ? 'valid' : 'invalid';
  let insetCount = 0;
  let colorCount = 0;
  let verdict = 'valid';
  const lengths = [];
  const roles = []; // I3(14R) 성분 순서 검증용 — <length>{2,4}는 연속 블록이어야 한다(중간 color/inset 삽입 불가)
  for (const n of nonSpace) {
    if (n.type === 'word') {
      const ident = identOf(n); // I4(15R) — 값 식별자 decode 1회
      const w = ident.toLowerCase();
      if (w === 'inset') { insetCount += 1; roles.push('inset'); continue; }
      if (isLengthWord(ident)) { lengths.push(ident); roles.push('length'); continue; }
      if (w[0] === '#' || COLOR_KEYWORDS.has(w)) { colorCount += 1; roles.push('color'); continue; }
      return 'invalid'; // 미지 word = 확실한 문법 위반
    }
    if (n.type === 'function') {
      if (n.unclosed) return 'invalid'; // 닫히지 않은 함수 = 문법 자체 파탄
      const fn = lowerIdentOf(n);
      if (isVarFunction(n)) { if (varFunctionToken(n) == null) return 'invalid'; colorCount += 1; roles.push('color'); continue; }
      if (COLOR_FUNCTIONS.has(fn)) { if (!isValidColorFunctionNode(n)) return 'invalid'; colorCount += 1; roles.push('color'); continue; } // I3 — 색 함수 내부 문법(인자 개수 포함)
      // I3(15R) — calc/min/max/clamp… 는 box-shadow의 <length> 자리에 올 수 있는 **표준** 함수다.
      // 우리는 그 값을 계산할 수 없을 뿐이므로 폐기(invalid)가 아니라 unsupported로 cascade에 참여시킨다.
      if (MATH_FUNCTIONS.has(fn)) { lengths.push(null); roles.push('length'); verdict = worseClass(verdict, 'unsupported'); continue; }
      // 미지 함수 — box-shadow 문법상 성립할 여지가 있는지 우리가 판단할 수 없다 → fail-closed unsupported.
      verdict = worseClass(verdict, 'unsupported');
      roles.push('unknown');
      continue;
    }
    return 'invalid'; // div(comma/slash)·string 등 = 확실한 문법 위반
  }
  if (insetCount > 1 || colorCount > 1 || lengths.length < 2 || lengths.length > 4) return 'invalid';
  // I3(14R) 성분 순서 — length word 인덱스들이 연속이어야 한다(`0 red 0`처럼 color가 length 사이에 끼면 불법).
  const lenIdx = roles.map((r, i) => (r === 'length' ? i : -1)).filter((i) => i >= 0);
  if (lenIdx[lenIdx.length - 1] - lenIdx[0] !== lenIdx.length - 1) return 'invalid';
  // I2(14R) blur(3번째 length)는 스펙상 non-negative — 음수면 브라우저가 선언 폐기. (calc 자리는 null이라
  // 부호를 알 수 없으므로 검사 대상 밖 — 이미 unsupported로 fail-closed돼 있다.)
  if (lengths[2] != null && parseFloat(lengths[2]) < 0) return 'invalid';
  return verdict;
}
function classifyBoxShadowValue(value) {
  const v = String(value).trim();
  if (v === '') return 'invalid';
  if (v.toLowerCase() === 'none') return 'valid'; // 그림자 없음(유효, 단 토큰 레이어 없어 인디케이터엔 비가시)
  return splitTopLevelLayers(v).map(classifyShadowLayer).reduce(worseClass, 'valid');
}
// 기존 boolean 계약을 쓰는 단위 단정용 얇은 어댑터(삼분 결과의 투영).
function isValidBoxShadow(value) { return classifyBoxShadowValue(value) === 'valid'; }

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
// 14R 삼분 파이프라인 — CSS-wide 키워드는 property 무관 공통 처리(각 grammar 진입부에서 먼저 분류)이지
// "색 키워드"가 아니다. initial/unset(비상속 속성이라 동치) → 해당 셀 initial 값(valid). inherit/revert/
// revert-layer → 모델 불가로 unsupported(fail-closed). 이전엔 initial/inherit/unset/revert가 COLOR_KEYWORDS에
// 섞여 border-color 색값으로 오취급됐다(그래서 property별로 처리가 갈렸다) — 여기서 분리한다.
const CSS_WIDE_KEYWORDS = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer']);
// I1(14R) — CSS Level-4 named colors. `border-color: red`처럼 실색으로 토큰을 덮는 override를 "유효 색(토큰
// 아님 → RED)"으로 판정하려면 named color 인식이 필요하다. 이전엔 red가 미지 키워드=invalid(폐기)로 처리돼
// 이전 토큰 선언으로 fallback = false-green이었다. junk 같은 미지 ident는 계속 invalid(폐기)로 남는다.
const NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen',
]);
// 14R 잔여1(내부 리뷰 실증, 리뷰어 probe) — CSS Color 4 §4.5 system colors + §8 deprecated system colors도
// **유효 CSS color ident**다(사양 키워드는 ASCII case-insensitive, I3의 VAR() 정정과 동일 원칙). 이전엔
// `border-color: AccentColor`/`box-shadow: … ButtonText` 같은 override가 미지 ident=invalid(폐기)로 처리돼
// 이전 토큰 선언으로 fallback했다(브라우저는 override를 적용해 토큰이 실제로 소실되는데 게이트는 GREEN —
// 이번 라운드 #3의 `border-color: red`와 동일 모양의 false-green). 유효 색으로 인정하면 "토큰 아닌 유효
// 색 사용"이 되어 sideUsesToken/색 판정에서 자연히 토큰 미사용 → RED(정확한 방향)로 뒤집힌다. `NotAColor`
// 같은 여전히 미지인 ident는 계속 invalid(폐기)로 남는다(회귀 없음).
const SYSTEM_COLORS = new Set([
  // CSS Color 4 §4.5 system colors(현행)
  'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext',
  'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight', 'highlighttext',
  'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext', 'visitedtext',
  // CSS Color 4 §8 deprecated system colors(여전히 유효 파싱 — 브라우저가 폐기하지 않음)
  'activeborder', 'activecaption', 'appworkspace', 'background', 'buttonhighlight', 'buttonshadow',
  'captiontext', 'inactiveborder', 'inactivecaption', 'inactivecaptiontext', 'infobackground',
  'infotext', 'menu', 'menutext', 'scrollbar', 'threeddarkshadow', 'threedface', 'threedhighlight',
  'threedlightshadow', 'threedshadow', 'window', 'windowframe', 'windowtext',
]);
// 실제 색 키워드 집합 = transparent/currentcolor + named colors + system colors(CSS-wide 키워드는 위
// CSS_WIDE_KEYWORDS로 분리).
const COLOR_KEYWORDS = new Set(['transparent', 'currentcolor', ...NAMED_COLORS, ...SYSTEM_COLORS]);
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

// I4(14R) — border-image shorthand의 <image> 산출 함수 목록(source가 이들 중 하나면 도장 활성). junk처럼
// 유효 <image>가 없으면 shorthand는 불법 → 폐기(아무것도 리셋/설정 안 함).
const IMAGE_FUNCTIONS = new Set([
  'url', 'image', 'image-set', 'cross-fade', 'element', 'paint',
  'linear-gradient', 'radial-gradient', 'conic-gradient',
  'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
]);
// 색 함수 내부에서 허용되는 수학 함수(내부는 미검, fail-open — 색 문법 밖 이슈).
const MATH_FUNCTIONS = new Set(['calc', 'min', 'max', 'clamp', 'round', 'mod', 'rem', 'sin', 'cos', 'tan', 'abs', 'sign']);
// 색 함수 인자에서 허용되는 키워드(none·relative-color from·색공간/보간·채널 문자).
const COLOR_FUNCTION_KEYWORDS = new Set([
  'none', 'from', 'in',
  'srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020',
  'lab', 'oklab', 'xyz', 'xyz-d50', 'xyz-d65', 'hsl', 'hwb', 'lch', 'oklch',
  'longer', 'shorter', 'increasing', 'decreasing', 'hue',
  'r', 'g', 'b', 'h', 's', 'l', 'w', 'a', 'c', 'x', 'y', 'z', 'alpha',
]);

// ─────────────────────────────────────────────────────────────────────────────
// 14R 공통 삼분 파이프라인 헬퍼 — 값 → {CSS-wide 키워드 | property별 grammar} 분류. cascade reducer는
// 이 결과만 소비한다(property 무관 공통 1단계).
// ─────────────────────────────────────────────────────────────────────────────

// 값이 단일 CSS-wide 키워드면 소문자 키워드를, 아니면 null을 반환(삼분 1단계).
function cssWideKeyword(value) {
  const nodes = parseValue(value).nodes.filter((n) => n.type !== 'space' && n.type !== 'comment');
  if (nodes.length === 1 && nodes[0].type === 'word') {
    const w = lowerIdentOf(nodes[0]); // I4(15R) — 값 식별자 decode 1회
    if (CSS_WIDE_KEYWORDS.has(w)) return w;
  }
  return null;
}
// I2(15R) — CSS-wide 키워드는 **값 전체가 그 키워드 단독일 때만** 인정된다(CSS Cascade §7.3: CSS-wide
// keyword는 선언 값 전부를 차지해야 한다). `border-width: initial 1px`처럼 다값 문맥에 섞이면 선언
// 전체가 불법이라 브라우저가 폐기한다. 이전엔 성분 leaf classifier(classifyComponentValue)가 셀 단위로
// CSS-wide를 처리해 첫 셀만 initial(medium)로 적용하고 나머지를 살려버렸다(false-green: width 0이 medium으로
// 부활). 이제 셀 안에서 CSS-wide를 만나면 **불법 신호**로 쓰고, 인정은 선언 진입부(값 전체)에서만 한다.
function isCssWideWordNode(node) {
  return !!node && node.type === 'word' && CSS_WIDE_KEYWORDS.has(lowerIdentOf(node));
}

function isNumberPercentAngle(word) {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:%|deg|grad|rad|turn)?$/i.test(word);
}
function isColorWord(word) {
  const w = String(word).toLowerCase();
  return w[0] === '#' || w === 'transparent' || w === 'currentcolor' || NAMED_COLORS.has(w) || SYSTEM_COLORS.has(w);
}
// I3(14R) — 색 함수 내부 문법 검증(재귀). 이전엔 함수명이 COLOR_FUNCTIONS에 있으면 내부를 안 보고 유효로
// 통과시켜 `rgb(from junk r g b)`(relative-color origin이 미지 ident junk)도 유효로 오인했다(false-green).
// 허용 = 숫자/백분율/각도, none·from·색공간/보간 키워드·채널 문자, 콤마/슬래시 구분자, 중첩 색함수·var·수학함수.
// `from` 뒤에는 반드시 유효 <color>가 와야 한다. 미지 bare word(junk)·string은 불법.
//
// I3(15R) — **인자 개수 계약** 추가. 이전엔 "허용 토큰만 들어있는가"만 봐서 `rgb(from red)`(채널 0개)·
// `color-mix(in srgb)`(피연산자 0개)처럼 **인자가 통째로 빠진** 값을 유효로 통과시켰다. 이건 미지원이
// 아니라 명백한 문법 위반이라 브라우저는 선언 전체를 폐기한다 — invalid-discard로 내려야 한다.
// 채널 토큰 = 숫자/백분율/각도, `none`, 채널 문자(r/g/b/h/s/l/w/a/c/x/y/z/alpha), 그리고 계산 가능한
// 함수(var·수학함수·중첩 색함수). `from <color>`의 origin과 `color()`의 색공간 ident는 채널이 아니다.
const COLOR_FUNCTION_MIN_CHANNELS = {
  rgb: 3, rgba: 3, hsl: 3, hsla: 3, hwb: 3, lab: 3, lch: 3, oklab: 3, oklch: 3, color: 3,
};
const COLOR_CHANNEL_LETTERS = new Set(['r', 'g', 'b', 'h', 's', 'l', 'w', 'a', 'c', 'x', 'y', 'z', 'alpha']);
// 함수 인자 노드를 top-level 콤마 기준 그룹으로 분해(색 함수 arity 판정 보조).
function splitCommaGroups(nodes) {
  const groups = [[]];
  for (const n of nodes) {
    if (n.type === 'div' && n.value === ',') groups.push([]);
    else if (n.type !== 'space' && n.type !== 'comment') groups[groups.length - 1].push(n);
  }
  return groups;
}
function isValidColorFunctionNode(node) {
  if (isVarFunction(node)) return varFunctionToken(node) != null;
  if (!node || node.type !== 'function' || node.unclosed || !COLOR_FUNCTIONS.has(lowerIdentOf(node))) return false;
  const fn = lowerIdentOf(node);
  const inner = node.nodes.filter((n) => n.type !== 'space' && n.type !== 'comment');
  let channels = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const n = inner[i];
    if (n.type === 'div') continue; // , 또는 /
    if (n.type === 'string') return false;
    if (n.type === 'function') {
      if (n.unclosed) return false;
      const nfn = lowerIdentOf(n);
      if (isVarFunction(n)) { if (varFunctionToken(n) == null) return false; channels += 1; continue; }
      if (COLOR_FUNCTIONS.has(nfn)) { if (!isValidColorFunctionNode(n)) return false; channels += 1; continue; }
      if (MATH_FUNCTIONS.has(nfn)) { channels += 1; continue; }
      return false;
    }
    if (n.type === 'word') {
      const w = lowerIdentOf(n); // I4(15R) — 값 식별자 decode 1회
      if (w === 'from') { if (!isValidColorToken(inner[i + 1])) return false; i += 1; continue; } // relative color origin
      if (isNumberPercentAngle(w) || w === 'none' || COLOR_CHANNEL_LETTERS.has(w)) { channels += 1; continue; }
      if (COLOR_FUNCTION_KEYWORDS.has(w) || isColorWord(w)) continue; // 색공간/보간 키워드·색 ident(피연산자)
      return false;
    }
    return false;
  }
  if (fn === 'color-mix') {
    // `color-mix( <color-interpolation-method> , <color> [<percentage>]? , <color> [<percentage>]? )`
    // → 최소 3그룹(보간법 + 색 2개). 그룹이 모자라면 인자 부족 = 문법 위반.
    const groups = splitCommaGroups(inner);
    if (groups.length < 3 || groups.some((g) => g.length === 0)) return false;
    return true;
  }
  const min = COLOR_FUNCTION_MIN_CHANNELS[fn];
  if (min != null && channels < min) return false;
  return true;
}
function isValidColorToken(node) {
  if (!node) return false;
  if (node.type === 'function') {
    if (isVarFunction(node)) return varFunctionToken(node) != null;
    if (COLOR_FUNCTIONS.has(lowerIdentOf(node))) return isValidColorFunctionNode(node);
    return false;
  }
  if (node.type === 'word') return isColorWord(identOf(node));
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// I6(15R, 이번 라운드의 구조 전환) — border-image 판정을 **"알려진 함수 목록에 있는가"라는 휴리스틱**에서
// **선언 전체 grammar 판정**으로 바꾼다.
//
// 왜 휴리스틱이 구조적으로 틀렸나: `border-image-source`의 문법은 `none | <image>`이고 `<image>`는
// url()/그라디언트/이미지 함수류다. "함수명이 우리 목록에 있으면 이미지, 없으면 불법"은 목록을 **완결된
// 세계**로 가정한 것이라 두 방향으로 동시에 샜다 —
//   ① 목록 밖 실존 함수(`-webkit-image-set("a.png" 1x)`, Chrome 지원)를 invalid-discard로 흘려보내
//      **활성 이미지를 놓쳤다**(false-green: 도장된 보더를 일반 보더로 오인).
//   ② 목록에 없다는 이유로 무효 판정한 값(`border: foo()`)을 반대로 상위 경로에서는 "unsupported=유효
//      선언"으로 취급해 **border-image를 reset**해버렸다(false-green).
// 이제 값 하나하나를 다음 셋으로 **삼분**한다:
//   (a) 문법 형태가 그 자리에 성립 가능한가 → 'active'/'reset'(우리가 해석 가능)
//   (b) 성립하지만 우리가 해석할 수 없는가(미지 함수·수학 함수·계산시점 유예 var) → 'unsupported'
//       (fail-closed — 선언은 적용되나 불확실성을 남긴다)
//   (c) 명백한 문법 위반인가(bare ident·문자열·값 개수 초과·닫히지 않은 함수·슬롯 중복) → 'invalid'
//       (브라우저가 선언 전체를 폐기 → 아무것도 건드리지 않고 **이전 상태 유지**)
// 그리고 **무효 shorthand는 border-image를 절대 reset하지 않는다**(I4b 원칙의 일반화) — 이는 (c)뿐
// 아니라 (b)에도 적용된다. reset은 "그 선언이 확실히 유효하다"가 전제인 부작용이기 때문이다.
//
// 명시 예외(과대 종결 금지): 우리는 여전히 <image> 함수의 **인자 문법**은 검사하지 않는다
// (`url()`/`linear-gradient()`의 내부는 미검 — 형태가 <image>로 성립 가능하면 active). 또 source가
// none이어도 slice/width/outset/repeat가 non-initial이면 fail-closed RED로 둔다(브라우저는 source가
// none이면 도장 자체를 안 하므로 이건 의도적 과잉 안전이며, 아래 imageActive 주석에 병기).
const VENDOR_PREFIX_RE = /^-(?:webkit|moz|ms|o|epub|khtml)-/;
function unprefixedFn(name) { return String(name).replace(VENDOR_PREFIX_RE, ''); }
// 노드 하나가 <image>로 성립하는가 — 'image' | 'unsupported' | 'invalid'.
function classifyImageNode(node) {
  if (node.type === 'function') {
    if (node.unclosed) return 'invalid'; // 괄호가 닫히지 않음 = 문법 자체 파탄
    const fn = unprefixedFn(lowerIdentOf(node));
    if (IMAGE_FUNCTIONS.has(fn)) return 'image';
    // 색/수학 함수는 <image>가 될 수 없다 → 확실한 문법 위반.
    if (COLOR_FUNCTIONS.has(fn) || MATH_FUNCTIONS.has(fn)) return 'invalid';
    return 'unsupported'; // 미지 함수 — <image>일 여지를 배제할 수 없다(fail-closed)
  }
  return 'invalid'; // bare ident(none은 호출부가 선처리)·string·div 등은 <image>가 아니다
}
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const PERCENT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)%$/;
const BORDER_IMAGE_REPEAT_KEYWORDS = new Set(['stretch', 'repeat', 'round', 'space']);
// 성분 셀 하나의 문법 판정. 반환 'ok' | 'unsupported' | 'invalid'.
function classifyImageComponentCell(component, node) {
  if (node.type === 'function') {
    if (node.unclosed) return 'invalid';
    if (isVarFunction(node)) return varFunctionToken(node) != null ? 'unsupported' : 'invalid'; // deferred
    return 'unsupported'; // 수학 함수(표준·계산 불가)든 미지 함수든 여기선 동일하게 fail-closed
  }
  if (node.type !== 'word') return 'invalid'; // string·div 등
  const w = lowerIdentOf(node); // I4(15R) — 값 식별자 decode 1회
  if (component === 'slice') return (NUMBER_RE.test(w) || PERCENT_RE.test(w)) ? 'ok' : 'invalid';
  if (component === 'width') {
    if (w === 'auto' || NUMBER_RE.test(w) || PERCENT_RE.test(w) || isLengthWord(w)) return 'ok';
    return 'invalid';
  }
  if (component === 'outset') return (NUMBER_RE.test(w) || isLengthWord(w)) ? 'ok' : 'invalid';
  return BORDER_IMAGE_REPEAT_KEYWORDS.has(w) ? 'ok' : 'invalid'; // repeat
}
const BORDER_IMAGE_MAX_CELLS = { slice: 4, width: 4, outset: 4, repeat: 2 };
// 성분 값(셀 나열)의 문법 판정. 반환 { kind, cells } — kind는 'ok' | 'unsupported' | 'invalid'.
function classifyImageComponentCells(component, nodes) {
  const cells = [];
  let verdict = 'ok';
  let sawFill = false;
  for (const node of nodes) {
    if (component === 'slice' && node.type === 'word' && lowerIdentOf(node) === 'fill') {
      if (sawFill) return { kind: 'invalid' }; // 슬롯 중복
      sawFill = true;
      continue;
    }
    if (isCssWideWordNode(node)) return { kind: 'invalid' }; // I2 — 다값 문맥의 CSS-wide = 불법
    const c = classifyImageComponentCell(component, node);
    if (c === 'invalid') return { kind: 'invalid' };
    if (c === 'unsupported') verdict = 'unsupported';
    cells.push(valueParser.stringify(node).trim().toLowerCase());
  }
  if (cells.length === 0 || cells.length > BORDER_IMAGE_MAX_CELLS[component]) return { kind: 'invalid' };
  return { kind: verdict, cells, fill: sawFill };
}
// 4값(또는 repeat 2값) 확장 후 initial과 값 동등한가 — `1 1 1 1`·`100%`처럼 표기만 다른 initial을
// "활성"으로 오판하지 않기 위해 숫자는 parseFloat로 비교한다.
function sameImageCellValue(a, b) {
  if (a === b) return true;
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return na === nb && a.replace(/^[+-]?(?:\d+\.?\d*|\.\d+)/, '') === b.replace(/^[+-]?(?:\d+\.?\d*|\.\d+)/, '');
}
function imageCellsAreInitial(component, cells, fill) {
  if (fill) return false;
  const expanded = component === 'repeat'
    ? (cells.length === 1 ? [cells[0], cells[0]] : cells)
    : expandFourSides(cells);
  const initial = String(BORDER_IMAGE_INITIAL[component]).toLowerCase();
  return expanded.every((c) => sameImageCellValue(c, initial));
}
// border-image longhand 5종의 삼분 분류(reset/active/unsupported/invalid).
function classifyBorderImageLonghand(component, value) {
  const v = String(value).trim();
  const cw = cssWideKeyword(v);
  if (cw === 'initial' || cw === 'unset') return { kind: 'reset' };
  if (cw) return { kind: 'unsupported' }; // inherit/revert/revert-layer
  if (component === 'source') {
    if (v.toLowerCase() === 'none') return { kind: 'reset' };
    const nodes = parseValue(v).nodes.filter((n) => n.type !== 'space' && n.type !== 'comment');
    if (nodes.length !== 1) return valueHasWellFormedVar(v) ? { kind: 'unsupported' } : { kind: 'invalid' };
    if (isVarFunction(nodes[0])) return varFunctionToken(nodes[0]) != null ? { kind: 'unsupported' } : { kind: 'invalid' };
    const c = classifyImageNode(nodes[0]);
    if (c === 'image') return { kind: 'active', value: v };
    if (c === 'unsupported') return { kind: 'unsupported' };
    return valueHasWellFormedVar(v) ? { kind: 'unsupported' } : { kind: 'invalid' };
  }
  const groups = splitTopLevelSpaceGroups(v).map((g) => parseValue(g).nodes.filter((n) => n.type !== 'comment'));
  if (groups.some((g) => g.length !== 1)) return valueHasWellFormedVar(v) ? { kind: 'unsupported' } : { kind: 'invalid' };
  const res = classifyImageComponentCells(component, groups.map((g) => g[0]));
  if (res.kind === 'invalid') return valueHasWellFormedVar(v) ? { kind: 'unsupported' } : { kind: 'invalid' };
  if (res.kind === 'unsupported') return { kind: 'unsupported' };
  if (imageCellsAreInitial(component, res.cells, res.fill)) return { kind: 'reset' };
  return { kind: 'active', value: v };
}

// border-image shorthand 문법:
//   <'source'> || <'slice'> [ / <'width'> | / <'width'>? / <'outset'> ]? || <'repeat'>
// top-level `/`로 최대 3구획(구획0=source/slice/repeat 혼합, 1=width, 2=outset)으로 나눈 뒤 각 그룹을
// 슬롯에 배정한다. 배정 불가 그룹이 하나라도 있으면 (c) invalid, 미지 함수 등 판단 불가가 있으면
// (b) unsupported다. 결과가 전부 initial 동등이면 reset(=5 longhand 초기화와 동치).
function classifyBorderImageShorthand(value) {
  const v = String(value).trim();
  const cw = cssWideKeyword(v);
  if (cw === 'initial' || cw === 'unset') return { kind: 'reset' };
  if (cw) return { kind: 'unsupported' }; // inherit/revert/revert-layer
  const deferred = valueHasWellFormedVar(v);
  const bail = (kind) => (kind === 'invalid' && deferred ? { kind: 'unsupported' } : { kind });
  if (v === '') return bail('invalid');
  const top = parseValue(v).nodes.filter((n) => n.type !== 'comment');
  const segments = [[]];
  for (const n of top) {
    if (n.type === 'div' && n.value === '/') segments.push([]);
    else if (n.type === 'div') return bail('invalid'); // top-level 콤마는 border-image 문법에 없다
    else if (n.type !== 'space') segments[segments.length - 1].push(n);
  }
  if (segments.length > 3) return bail('invalid');
  let verdict = 'ok';
  let source = null;
  const sliceNodes = [];
  const repeatNodes = [];
  for (const node of segments[0]) {
    if (isCssWideWordNode(node)) return bail('invalid'); // I2 — 다값 문맥의 CSS-wide
    if (node.type === 'word') {
      const w = lowerIdentOf(node);
      if (w === 'none') { if (source != null) return bail('invalid'); source = 'none'; continue; }
      if (BORDER_IMAGE_REPEAT_KEYWORDS.has(w)) { repeatNodes.push(node); continue; }
      if (w === 'fill' || NUMBER_RE.test(w) || PERCENT_RE.test(w)) { sliceNodes.push(node); continue; }
      return bail('invalid'); // 어느 슬롯도 아닌 bare ident
    }
    if (node.type === 'function' && isVarFunction(node)) {
      if (varFunctionToken(node) == null) return bail('invalid');
      verdict = 'unsupported'; // deferred — 어느 슬롯인지 계산시점에만 알 수 있다
      continue;
    }
    const c = node.type === 'function' ? classifyImageNode(node) : 'invalid';
    if (c === 'invalid') return bail('invalid');
    if (c === 'unsupported') { verdict = 'unsupported'; continue; }
    if (source != null) return bail('invalid'); // source 슬롯 중복
    source = valueParser.stringify(node).trim();
  }
  // `/` 구획은 slice가 선행해야만 나올 수 있다(스펙).
  if (segments.length > 1 && sliceNodes.length === 0) return bail('invalid');
  const parts = { source, slice: null, width: null, outset: null, repeat: null };
  const takeCells = (component, nodes) => {
    if (nodes.length === 0) return true;
    const res = classifyImageComponentCells(component, nodes);
    if (res.kind === 'invalid') return false;
    if (res.kind === 'unsupported') { verdict = 'unsupported'; return true; }
    parts[component] = imageCellsAreInitial(component, res.cells, res.fill) ? null : nodes.map((n) => valueParser.stringify(n).trim()).join(' ');
    return true;
  };
  if (!takeCells('slice', sliceNodes)) return bail('invalid');
  if (!takeCells('repeat', repeatNodes)) return bail('invalid');
  if (segments[1] && segments[1].length && !takeCells('width', segments[1])) return bail('invalid');
  if (segments[2] && segments[2].length && !takeCells('outset', segments[2])) return bail('invalid');
  if (segments.slice(1).some((s) => s.length === 0)) return bail('invalid'); // `url(x) 1 / ` 처럼 빈 구획 = 불법
  if (verdict === 'unsupported') return { kind: 'unsupported' };
  if (deferred) return { kind: 'unsupported' }; // well-formed var 포함 = 계산시점 유예
  const cells = {
    source: source == null || source.toLowerCase() === 'none' ? BORDER_IMAGE_INITIAL.source : source,
    slice: parts.slice == null ? BORDER_IMAGE_INITIAL.slice : parts.slice,
    width: parts.width == null ? BORDER_IMAGE_INITIAL.width : parts.width,
    outset: parts.outset == null ? BORDER_IMAGE_INITIAL.outset : parts.outset,
    repeat: parts.repeat == null ? BORDER_IMAGE_INITIAL.repeat : parts.repeat,
  };
  const allInitial = BORDER_IMAGE_LONGHANDS.every((k) => String(cells[k]).toLowerCase() === String(BORDER_IMAGE_INITIAL[k]).toLowerCase());
  return allInitial ? { kind: 'reset' } : { kind: 'active', source: cells.source, cells };
}

// ─────────────────────────────────────────────────────────────────────────────
// 선언 유효성 = **폐기(discard) 의미론** vs **미지원(unsupported) fail-closed** — 이 둘의 구분 (13라운드 핵심)
//   · invalid(폐기): 미소비 잔여 노드·문법 위반(콤마/슬래시/문자열, 슬롯 중복, unitless 비영 <length>,
//       무효 var() 문법, 미지 키워드)은 **브라우저가 선언 전체를 폐기**한다 → cascade에서 완전 제외 →
//       **이전 유효 선언으로 fallback**(마치 이 선언이 없던 것처럼). 그 결과 perimeter/shadow가 비가시면 RED.
//   · unsupported(fail-closed): calc()·미지원 색 함수처럼 **브라우저는 받아들이지만(유효 선언) 우리가
//       계산·해석할 수 없는 지원 범위 밖 문법**. 선언은 정상 적용(리셋·설정 발생)하되 해당 성분을
//       unsupported로 표시해 fail-closed RED. (예: `border: calc(100% - 2px) solid var(…)`는 유효 선언이라
//       border-image를 리셋하고 width를 세팅하지만, calc를 못 재므로 unsupported → RED.)
//   · deferred(계산시점 유예 재분류, 13R 잔여1): 위 기준으로는 invalid(문법 위반)로 판정될 값이라도
//       **well-formed var()를 하나라도 포함**하면(valueHasWellFormedVar, I2a 재사용) CSS 스펙상
//       parse-time 문법검사가 computed-value time으로 유예돼 브라우저는 폐기하지 않고 유효 선언으로
//       cascade에 참여시킨다(이겼다면 이전 선언을 대체 — fallback이 아니라 "이 선언이 이겨서 계산시점에
//       무효화"). 우리 엔진은 계산시점 재파싱을 재현할 수 없으므로 이 경로는 invalid가 아니라
//       unsupported로 재분류한다(두 번째 항목과 동일하게 처리 — 적용은 되지만 fail-closed).
//       (예: `box-shadow: inset 0 0 0 1px var(--i); box-shadow: inset 0 0 0 var(--zero) var(--i);`의
//       후행은 spread 자리에 var가 있어 우리 grammar로는 위반이지만 well-formed var 포함 → unsupported
//       → 후행이 cascade 승리해 RED. var()가 전혀 없거나(순수 문법 위반) var()가 있어도 그 var() 자체가
//       무효 문법(`var(--x garbage)`, I2a)뿐이면 이 재분류 대상이 아니라 기존 invalid 폐기 그대로다.
//       CSS-wide 키워드(inherit 등)도 계산시점 유예와 이웃한 개념이지만 이미 COLOR_KEYWORDS 등 별도
//       경로로 처리되므로 여기선 구현하지 않는다(기록성 주석).
//   · uncertain(유효성 미확정, I6 15R): unsupported 중에서도 **선언이 유효한지 자체를 확인할 수 없는**
//       경우(미지 함수 `foo()`). 값은 못 재고(→ fail-closed) 게다가 "유효 선언이었다면 일어났을 부작용"
//       (border shorthand의 border-image initial 리셋)도 일으키면 안 된다 — 무효였다면 브라우저는
//       아무것도 안 하기 때문이다. calc처럼 **표준 함수라 유효성은 확실한** unsupported와 구분된다.
// 두 경로의 실차이는 "이전 유효 선언 fallback 여부"와 "border-image 등 부작용 발생 여부"에서 드러난다.
// ─────────────────────────────────────────────────────────────────────────────

// shorthand의 top-level 노드 하나를 성분 슬롯으로 분류. 반환: {slot,value}(정상) | {invalid} | {unsupported}.
// I6(15R) — 반환에 `uncertain`을 추가한다. "지원 밖"에도 두 종류가 있다:
//   · MATH_FUNCTIONS(calc/min/max/clamp…) — <line-width> 자리에 오는 **표준** 함수라 선언이 유효함은
//     확실하다(값만 못 잰다) → unsupported이되 선언의 부작용(border-image reset)은 정상 발생.
//   · 미지 함수(foo()) — 선언이 유효한지 **확인할 수 없다** → unsupported + uncertain. 이때 border-image
//     reset 같은 "유효 선언 전제 부작용"은 일으키면 안 된다(무효라면 브라우저는 아무것도 안 하므로).
function classifyBorderShorthandNode(node) {
  if (node.type === 'word') {
    const ident = identOf(node); // I4(15R) — 값 식별자 decode 1회
    const w = ident.toLowerCase();
    if (CSS_WIDE_KEYWORDS.has(w)) return { invalid: true }; // I2 — 다값 문맥의 CSS-wide = 불법
    if (BORDER_STYLE_KEYWORDS.has(w)) return { slot: 'style', value: ident };
    if (BORDER_WIDTH_KEYWORDS.has(w) || isLengthWord(ident)) return { slot: 'width', value: ident };
    if (w[0] === '#' || COLOR_KEYWORDS.has(w)) return { slot: 'color', value: ident };
    return { invalid: true }; // 미지 키워드·unitless 비영 length = 불법 문법(폐기)
  }
  if (node.type === 'function') {
    if (node.unclosed) return { invalid: true }; // 닫히지 않은 함수 = 문법 자체 파탄
    if (isVarFunction(node)) { // var() 문법 검증(I2/I3) — 무효면 선언 폐기, 유효면 color 슬롯
      if (varFunctionToken(node) == null) return { invalid: true };
      return { slot: 'color', value: valueParser.stringify(node) };
    }
    const fn = lowerIdentOf(node);
    if (COLOR_FUNCTIONS.has(fn)) { // I3(14R) — 색 함수 내부 문법까지 검증(rgb(from junk …)·인자 부족 등 폐기)
      if (!isValidColorFunctionNode(node)) return { invalid: true };
      return { slot: 'color', value: valueParser.stringify(node) };
    }
    if (MATH_FUNCTIONS.has(fn)) return { unsupported: true }; // 표준 <length> 산출 — 유효 선언 확정
    return { unsupported: true, uncertain: true }; // 미지 함수 — 유효성 미확정(fail-closed, 부작용 금지)
  }
  return { invalid: true }; // string·div(comma/slash) 등 = 불법(폐기)
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
  // 14R 삼분 1단계 — 값 전체가 단일 CSS-wide 키워드면 property 무관 공통 처리. shorthand는 전체가 키워드일
  // 때만 유효하다(`border:1px solid initial`처럼 혼합하면 불법이라 아래 grammar가 invalid로 잡는다).
  //   initial/unset → 세 성분 initial(width medium/style none/color currentcolor) → style none이라 비가시.
  //   inherit/revert(-layer) → 모델 불가 fail-closed(세 성분 unsupported).
  const cw = cssWideKeyword(value);
  if (cw) {
    if (cw === 'initial' || cw === 'unset') {
      return {
        width: { value: BORDER_INITIAL.width, unsupported: false },
        style: { value: BORDER_INITIAL.style, unsupported: false },
        color: { value: BORDER_INITIAL.color, unsupported: false },
        invalid: false,
      };
    }
    return {
      width: { value, unsupported: true },
      style: { value, unsupported: true },
      color: { value, unsupported: true },
      invalid: false,
    };
  }
  const result = {
    width: { value: BORDER_INITIAL.width, unsupported: false },
    style: { value: BORDER_INITIAL.style, unsupported: false },
    color: { value: BORDER_INITIAL.color, unsupported: false },
  };
  const assigned = { width: false, style: false, color: false };
  let invalid = false; // 불법 문법 = 선언 폐기(cascade 제외)
  let unsupported = false; // 지원 밖(calc 등) = 유효 선언이나 fail-closed
  let uncertain = false; // I6(15R) — 유효성 자체가 미확정(미지 함수) = 부작용(border-image reset) 금지
  for (const node of parseValue(value).nodes) {
    if (node.type === 'space' || node.type === 'comment') continue; // 공백/주석만 무해하게 스킵
    const c = classifyBorderShorthandNode(node);
    if (c.invalid) { invalid = true; continue; }
    if (c.unsupported) { unsupported = true; if (c.uncertain) uncertain = true; continue; }
    if (assigned[c.slot]) { invalid = true; continue; } // 슬롯 중복 = 문법 오류(폐기)
    result[c.slot] = { value: c.value, unsupported: false };
    assigned[c.slot] = true;
  }
  // 13R 잔여1(deferred 재분류) — invalid로 판정됐어도 값 전체(value, 어떤 노드가 위반을 냈는지 무관)에
  // well-formed var()가 하나라도 있으면 parse-time 문법검사가 계산시점으로 유예된다 — 폐기(invalid)가
  // 아니라 unsupported로 재분류해 cascade 참여(적용은 하되 fail-closed)로 전환한다. 위 분류 이분법
  // 주석의 3번째 축 참고. 예: `border: var(--w) solid var(--t)`는 var(--w)가 classifyBorderShorthandNode에서
  // 항상 color 슬롯으로 분류돼(현 모델은 var()의 위치별 의미를 구분하지 않음) var(--t)와 슬롯이 중복되며
  // (기존이라면 invalid=true), 값 전체에 well-formed var()가 있으므로 unsupported로 재분류된다.
  if (invalid && valueHasWellFormedVar(value)) { invalid = false; unsupported = true; }
  // 불법이든 지원밖이든 세 성분을 fail-closed로도 마킹(단위 단정 보존). 단 invalid는 호출부가
  // 별도로 검사해 선언 자체를 cascade에서 제외한다(폐기) — 그때 아래 셀 값은 사용되지 않는다.
  if (invalid || unsupported) for (const slot of ['width', 'style', 'color']) result[slot].unsupported = true;
  result.invalid = invalid;
  // I6(15R) — `uncertain`이면 "선언이 유효하다"를 전제로 한 부작용(border-image initial 리셋)을 일으키지
  // 않는다. 무효 shorthand는 border-image를 절대 reset하지 않는다는 I4b 원칙의 일반화다.
  result.uncertain = uncertain;
  return result;
}

// 값을 top-level **공백만** 기준 그룹으로 분해(성분 longhand 1~4값 확장용). F4(12라운드) — 이전엔 콤마도
// 구분자로 인정해 `border-width:1px,1px`를 2값으로 쪼갰다(false-GREEN: border-width는 공백 구분만 유효).
// 콤마/슬래시(div) 자체의 미지원 판정은 parseBorderComponentLonghand가 별도로 하므로 여기선 공백만 나눈다.
function splitTopLevelSpaceGroups(value) {
  const groups = [];
  let cur = [];
  for (const node of parseValue(value).nodes) {
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
// I3(13라운드) — leaf classifier가 **모든 non-space/comment 노드를 소비**한다. 이전엔 word/function만
// 필터링해 string·div를 조용히 버려 `border-top-width: 1px "junk"`를 1px로 채택했다(false-green: 잔여
// "junk"가 있으면 브라우저는 선언 전체를 폐기하는데도 1px 성공). 미소비 잔여(2개 이상·string·div)면
// invalid(폐기), calc 등 지원밖 함수면 unsupported(fail-closed) — 위 폐기/미지원 구분 주석 참고.
function classifyComponentValue(component, group) {
  const nodes = parseValue(group).nodes.filter((n) => n.type !== 'space' && n.type !== 'comment');
  // I2(15R) — CSS-wide 키워드는 **셀 단위로 인정하지 않는다**. 이전엔 이 leaf classifier가 `initial`을
  // 셀 값(BORDER_INITIAL[component])으로 바꿔줘서 `border-width: initial 1px`처럼 다값 문맥에 섞인
  // 키워드가 첫 셀에 조용히 적용됐다(false-green: 이전 width 0이 medium으로 부활). CSS-wide는 값 전체가
  // 그 키워드 단독일 때만 유효하므로, 그 인정은 선언 진입부(parseBorderComponentLonghand/
  // parseBorderShorthand의 cssWideKeyword 분기)에서만 하고 여기선 **불법 신호**로 쓴다.
  if (nodes.length === 1 && isCssWideWordNode(nodes[0])) return { value: group, unsupported: true, invalid: true };
  if (nodes.length !== 1) return { value: group, unsupported: true, invalid: true }; // 미소비 잔여 = 불법(폐기)
  const node = nodes[0];
  if (node.type === 'div' || node.type === 'string') return { value: group, unsupported: true, invalid: true };
  if (node.type === 'function' && node.unclosed) return { value: group, unsupported: true, invalid: true }; // 문법 파탄
  const ident = node.type === 'word' ? identOf(node) : null; // I4(15R) — 값 식별자 decode 1회
  if (component === 'style') {
    if (ident != null && BORDER_STYLE_KEYWORDS.has(ident.toLowerCase())) return { value: ident, unsupported: false };
    if (node.type === 'function') return { value: group, unsupported: true }; // 지원밖 함수(fail-closed)
    return { value: group, unsupported: true, invalid: true }; // 미지 키워드 = 불법(폐기)
  }
  if (component === 'width') {
    if (ident != null && (BORDER_WIDTH_KEYWORDS.has(ident.toLowerCase()) || isLengthWord(ident))) return { value: ident, unsupported: false };
    if (node.type === 'function') return { value: group, unsupported: true }; // calc 등 지원밖(fail-closed)
    return { value: group, unsupported: true, invalid: true }; // unitless 비영·미지 키워드 = 불법(폐기)
  }
  // color
  if (node.type === 'function') {
    if (isVarFunction(node)) { if (varFunctionToken(node) == null) return { value: group, unsupported: true, invalid: true }; return { value: group, unsupported: false }; }
    if (COLOR_FUNCTIONS.has(lowerIdentOf(node))) { if (!isValidColorFunctionNode(node)) return { value: group, unsupported: true, invalid: true }; return { value: group, unsupported: false }; } // I3 색 함수 내부 문법
    return { value: group, unsupported: true }; // 색 아닌 함수 = 지원밖(fail-closed)
  }
  if (ident != null && (ident[0] === '#' || COLOR_KEYWORDS.has(ident.toLowerCase()))) return { value: ident, unsupported: false };
  return { value: group, unsupported: true, invalid: true };
}

function parseBorderComponentLonghand(component, value) {
  // F4(12라운드)+I3(13라운드) — border-{width|style|color} longhand는 공백 구분 1~4값만 유효하다. top-level
  // div(comma·slash)가 하나라도 있거나(문법 오류) 그룹 개수가 범위 밖이거나 한 그룹이라도 invalid면 선언
  // 전체가 불법 → 네 면 전부 invalid(폐기 대상). 호출부(synthesizeBorderSides)가 invalid를 검사해 이 선언을
  // cascade에서 제외한다(이전 유효값으로 fallback). 셀도 unsupported로 마킹해 기존 단위 단정을 보존한다.
  // I2(15R) 삼분 1단계 — 값 **전체**가 단일 CSS-wide 키워드일 때만 CSS-wide로 인정한다. 셀 단위 인정은
  // classifyComponentValue에서 제거했다(다값 문맥에 섞이면 선언 전체가 불법 → 폐기).
  const cw = cssWideKeyword(value);
  if (cw) {
    const cell = (cw === 'initial' || cw === 'unset')
      ? { value: BORDER_INITIAL[component], unsupported: false }
      : { value, unsupported: true }; // inherit/revert(-layer) → 모델 불가 fail-closed
    return [cell, cell, cell, cell];
  }
  if (parseValue(value).nodes.some((n) => n.type === 'div')) {
    const bad = { value, unsupported: true, invalid: true };
    return [bad, bad, bad, bad];
  }
  const groups = splitTopLevelSpaceGroups(value);
  if (groups.length === 0 || groups.length > 4) {
    const bad = { value, unsupported: true, invalid: true };
    return [bad, bad, bad, bad];
  }
  const cells = groups.map((g) => classifyComponentValue(component, g));
  if (cells.some((c) => c.invalid)) { // 한 그룹이라도 불법이면 선언 전체 폐기 → 네 면 invalid 전파
    const bad = { value, unsupported: true, invalid: true };
    return [bad, bad, bad, bad];
  }
  return expandFourSides(cells);
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
  //
  // I5(15R, state domain 분리) — border-image의 **불확실성(unsupported)을 일반 border side 셀에 기록하지
  // 않는다**. 이전엔 `border-image: inherit`·`all: inherit`가 markPerimeterUnsupported로 side 셀에 poison을
  // 찍었는데, side 셀과 image 셀은 서로 다른 상태 도메인이라 두 방향으로 전부 어긋났다:
  //   ① 후행 `border-width/style/color`가 side 셀을 덮으면서 **image 불확실성까지 지워** GREEN(false-green).
  //   ② 후행 `border-image: none`은 image 도메인만 리셋하므로 side 셀의 poison을 **못 지워** RED(false-red).
  // 이제 5개 borderImage 셀 각각이 {value, important, unsupported}를 보관한다. image reset은 image 상태만
  // 건드리고, 일반 border longhand는 image 불확실성에 일절 간섭하지 않는다. 최종 fail-closed 반영은
  // 아래 imageActive/imageUncertain 집계 한 곳에서만 일어난다.
  const borderImage = {};
  for (const k of BORDER_IMAGE_LONGHANDS) borderImage[k] = { value: BORDER_IMAGE_INITIAL[k], important: false, unsupported: false };
  const applyImageCell = (comp, value, important, unsupported = false) => {
    const cell = borderImage[comp];
    if (cell.important && !important) return; // important가 후행 non-important를 이김
    cell.value = value;
    cell.unsupported = unsupported;
    cell.important = important;
  };
  const resetBorderImage = (important) => {
    for (const k of BORDER_IMAGE_LONGHANDS) applyImageCell(k, BORDER_IMAGE_INITIAL[k], important, false);
  };
  // image 도메인 전체를 "계산 불가"로 표시(값은 원문 보존 — 진단 메시지용).
  const markImageUnsupported = (rawValue, important) => {
    for (const k of BORDER_IMAGE_LONGHANDS) applyImageCell(k, rawValue, important, true);
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
      // 내부 리뷰 잔여 2 + 14R 삼분 — `all`은 스펙상 CSS-wide 전역값만 받는다. 14R에서 삼분 파이프라인으로
      // 정밀화: initial/unset → 네 면을 border initial(style none → 비가시)로 리셋(+border-image도 리셋),
      // inherit/revert(-layer) → 모델 불가 fail-closed(전체 unsupported), 그 외(비 CSS-wide 값) → 불법 →
      // 폐기(무동작). 세 경로 모두 결과는 RED이나(가시 불가/미지원), 폐기 케이스만 예외로 이전 상태를 유지한다.
      // I1(15R) — 두 도메인(border·indicator)이 **동일한 classifyAllDecl을 공유**한다. 이전엔 border가
      // 여기서 cssWideKeyword를 직접 호출하고 indicator는 classifyAllDecl을 쓰는 이원화 구조라, `all`의
      // deferred(well-formed var) 판정을 한쪽에만 넣으면 다른 쪽이 새는 형태였다. 실제로 둘 다 새 있었다:
      // `all: var(--color-bg)`가 "비 CSS-wide → 불법 → 폐기(무동작)"로 흘러 border/box-shadow가 살아남았다
      // (false-green). Chrome은 well-formed var를 포함한 `all`을 폐기하지 않고 cascade에 참여시킨 뒤
      // 계산시점에 무효화한다 → border-style:none / box-shadow:none. **정의된 토큰으로도 재현**되므로
      // "미정의 var 참조" 게이트가 대신 잡아줄 수 없다.
      // I5(15R) — `all`은 border-image까지 함께 리셋/불확실화하므로 **두 도메인 각각에** 반영한다.
      if (prop === 'all') {
        const v = decl.value.trim();
        const cls = classifyAllDecl(v);
        if (cls.kind === 'valid') { // initial/unset
          for (const side of BORDER_SIDES) {
            applyCell(side, 'width', { value: BORDER_INITIAL.width, unsupported: false }, important);
            applyCell(side, 'style', { value: BORDER_INITIAL.style, unsupported: false }, important);
            applyCell(side, 'color', { value: BORDER_INITIAL.color, unsupported: false }, important);
          }
          resetBorderImage(important);
        } else if (cls.kind === 'unsupported') { // inherit/revert(-layer) 또는 deferred var
          markPerimeterUnsupported(v, important);
          markImageUnsupported(v, important);
        } // else invalid: 폐기(무동작)
        return;
      }
      // F3+I4(a) — border-image shorthand는 **5개 longhand 전부를 initial로 리셋한 뒤** 명시분을 설정한다
      // (W3C shorthand 정의). 이전엔 source만 세팅하고 생략 longhand(slice 등)를 안 건드려, 앞선
      // `border-image-slice: 5` 뒤 `border-image: none`이 와도 slice가 stale 5로 남아 imageActive=true
      // (과잉 RED, false-RED). 이제 리셋 후 'none'이면 source=none(전부 initial), non-none이면 source만
      // 원문으로 둔다(우리는 source가 none인지만 판정하므로 세부 파싱 불필요).
      // I4(14R) — border-image에도 삼분법+CSS-wide. reset(initial/unset/none) → 5 longhand 전부 initial 리셋
      // (일반 보더 가시). active(유효 <image>) → 리셋 후 source 설정(도장 활성 → fail-closed). unsupported
      // (inherit/revert·well-formed var) → fail-closed. invalid(junk 등) → 폐기(아무것도 리셋/설정 안 함 →
      // 이전 border-image 상태 유지). 이전엔 non-none이면 무조건 source=원문으로 둬 `initial`을 활성 이미지로
      // 오인(false-RED)하고, junk도 리셋해 이전 활성 상태를 지워버렸다(false-green).
      // I5/I6(15R) — unsupported는 **image 도메인에만** 기록한다(일반 border side 셀 불간섭). active는
      // 5 longhand 전부를 shorthand가 계산한 값으로 세팅한다(생략분은 initial).
      if (prop === 'border-image') {
        const v = decl.value.trim();
        const cls = classifyBorderImageShorthand(v);
        if (cls.kind === 'invalid') return; // 폐기: 이전 상태 유지(무효 shorthand는 절대 reset하지 않는다)
        if (cls.kind === 'unsupported') { markImageUnsupported(v, important); return; }
        resetBorderImage(important); // reset·active 공통: 5 longhand 초기화 후
        if (cls.kind === 'active') {
          for (const k of BORDER_IMAGE_LONGHANDS) applyImageCell(k, cls.cells[k], important, false);
        }
        return;
      }
      // F3+14R 잔여2 — border-image-{source|slice|width|outset|repeat} longhand: shorthand와 동일한 삼분
      // 파이프라인(classifyBorderImageLonghand)을 거친 뒤 해당 성분만 설정한다. reset(initial/unset/
      // source:none) → 해당 성분 initial. unsupported(inherit/revert·well-formed var) → 전체 perimeter
      // fail-closed(어느 한 longhand라도 계산 불가면 도장 활성 여부를 알 수 없어 안전 방향). invalid
      // (junk 등 문법 위반) → 폐기(아무것도 건드리지 않음 → 이전 상태 유지). active → 해당 성분에 원문 설정.
      const imgLong = BORDER_IMAGE_LONGHAND_RE.exec(prop);
      if (imgLong) {
        const component = imgLong[1];
        const cls = classifyBorderImageLonghand(component, decl.value);
        if (cls.kind === 'invalid') return; // 폐기: 이전 상태 유지
        // I5(15R) — 불확실성은 **그 image 셀에만** 기록한다(이전엔 perimeter 전체를 poison해 도메인이 섞였다).
        if (cls.kind === 'unsupported') { applyImageCell(component, decl.value.trim(), important, true); return; }
        if (cls.kind === 'reset') { applyImageCell(component, BORDER_IMAGE_INITIAL[component], important, false); return; }
        applyImageCell(component, cls.value, important, false); // active
        return;
      }
      const m = BORDER_PROP_RE.exec(prop);
      if (!m) return;
      const [, sideGroup, compGroup] = m;
      const value = decl.value.trim();
      if (!compGroup) {
        // shorthand: border(4면) 또는 border-{side}(해당 면), 세 성분 전부 설정(생략=initial 재설정)
        const parsed = parseBorderShorthand(value);
        // I4(b) — 무효 shorthand(`border: junk` 등)는 브라우저가 폐기하므로 **아무것도 리셋/설정하지
        // 않고** cascade에서 완전 제외한다(이전 유효 선언 유지). 이전엔 무조건 resetBorderImage+셀 세팅을
        // 해서, important longhand+투명 border-image 뒤 `border:junk`가 border-image를 리셋해 버려
        // (브라우저는 유지) 게이트가 GREEN이 됐다. calc 등 unsupported는 invalid가 아니라 유효 선언이므로
        // 이 분기를 타지 않고 정상 적용+fail-closed된다.
        if (parsed.invalid) return;
        for (const side of sideGroup ? [sideGroup] : BORDER_SIDES) {
          applyCell(side, 'width', parsed.width, important);
          applyCell(side, 'style', parsed.style, important);
          applyCell(side, 'color', parsed.color, important);
        }
        // F3 — 유효한 전체 `border` shorthand(방향 없음)만 border-image를 initial로 리셋한다(CSS 스펙).
        // border-{side} shorthand는 border-image를 리셋하지 않는다.
        // I6(15R) — `uncertain`(미지 함수라 선언 유효성 미확정)이면 리셋도 하지 않는다. reset은 "이 선언이
        // 확실히 유효하다"를 전제로 한 부작용이고, 무효라면 브라우저는 border-image를 그대로 둔다.
        if (!sideGroup && !parsed.uncertain) resetBorderImage(important);
      } else if (!sideGroup) {
        // 성분 longhand 전체 면: border-{width|style|color} (1~4값 확장)
        const perSide = parseBorderComponentLonghand(compGroup, value);
        if (perSide.some((c) => c.invalid)) {
          // I1(14R) 삼분 — well-formed var 포함 문법위반은 계산시점 유예(deferred) → 폐기가 아니라 네 면
          // unsupported로 cascade 참여(fail-closed). var 없는 순수 문법 위반만 폐기(이전 유효값 fallback).
          if (valueHasWellFormedVar(value)) {
            const bad = { value, unsupported: true };
            BORDER_SIDES.forEach((side) => applyCell(side, compGroup, bad, important));
          }
          return;
        }
        BORDER_SIDES.forEach((side, i) => applyCell(side, compGroup, perSide[i], important));
      } else {
        // directional 성분 longhand: border-{side}-{width|style|color} — 그 면·성분만
        // I2(15R) — CSS-wide 인정은 값 전체가 단독 키워드일 때만(셀 단위 인정은 leaf에서 제거했다).
        const dirCw = cssWideKeyword(value);
        if (dirCw) {
          const cell = (dirCw === 'initial' || dirCw === 'unset')
            ? { value: BORDER_INITIAL[compGroup], unsupported: false }
            : { value, unsupported: true }; // inherit/revert(-layer) → 모델 불가 fail-closed
          applyCell(sideGroup, compGroup, cell, important);
          return;
        }
        let c = classifyComponentValue(compGroup, value);
        if (c.invalid) {
          // I1(14R) 삼분 — deferred 재분류: well-formed var 포함 문법위반은 폐기가 아니라 unsupported(참여·
          // fail-closed). 예: `border-top-color: var(--t) "junk"` — var 유예로 cascade 참여 → computed 무효 →
          // currentcolor(토큰 소실) → RED. var 없는 순수 문법 위반만 폐기(이전 유효값 fallback).
          if (!valueHasWellFormedVar(value)) return;
          c = { value, unsupported: true };
        }
        applyCell(sideGroup, compGroup, c, important);
      }
    });
  });
  // F3 — 최종 border-image-source가 non-none이면 네 면이 이미지로 대체 도장되므로 일반 보더 색/토큰
  // 계약이 무의미 → fail-closed. 나머지 성분(slice/width/outset/repeat)이 non-initial로 남아도(effective) 동일.
  // **명시 예외(과대 종결 금지)**: 브라우저는 source가 none이면 slice/width/outset/repeat가 무엇이든 도장을
  // 하지 않는다. 여기서 non-initial 성분만으로 fail-closed하는 것은 의도적 과잉 안전(false-red 방향)이며,
  // 이 계약은 12R부터의 고정 단정(`border-image-slice:5` 단독 RED)이 계속 지킨다.
  // I5(15R) — image 도메인의 unsupported는 side 셀이 아니라 **여기서** perimeter로 접힌다. 그래서 후행
  // 일반 border longhand가 이 불확실성을 지울 수 없고(①), 후행 `border-image:none`은 image 셀을
  // 리셋하며 unsupported도 함께 해제한다(②).
  const imageUncertain = BORDER_IMAGE_LONGHANDS.some((k) => borderImage[k].unsupported);
  const imageActive = imageUncertain
    || String(borderImage.source.value).trim().toLowerCase() !== 'none'
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

// ─────────────────────────────────────────────────────────────────────────────
// I5(13라운드, 구조 핵심) — **단일 공용 evaluator**. PINNED 본문과 모든 visibility mutation synthetic이
// 이 한 함수를 통해 **완전히 동일한 체인**(compile 결과 CSS → postcss.parse → findRootRules(root 직속·
// 완전일치) → cascade 합성 → 최종 선언 전체 유효성/가시성 판정)을 탄다. 이전엔 mutation synthetic이
// synthesizeBorderSides/assertVisibleInsetShadowLayer를 개별 호출하는 부분 경로라, PINNED 실경로에서만
// 드러나는 false-green이 165 그린과 공존할 수 있었다. 이제 이번 라운드의 모든 수정(I2~I4)이 이 체인
// 안에서 검증된다. synthetic은 SCSS/CSS 문자열을 compileString으로 컴파일해 PINNED과 동일하게 Sass
// 정규화를 거친다(evalBorderScss/evalIndicatorScss). 단, raw 식별자 escape 디코딩을 검증하는 경로
// (normalizeProp decode)는 Sass가 escape를 선(先)정규화해 버리므로 그 테스트만 raw CSS를 직접 태운다.
const INDICATOR_PROPS = new Set(['box-shadow']);
function evaluateBorderVisibility(rules, token) {
  const sides = synthesizeBorderSides(rules);
  const { visible, perSide } = assertPerimeterVisible(sides, token);
  return { visible, perSide };
}
// I2(14R) — box-shadow 선언 삼분 분류. CSS-wide initial/unset → box-shadow initial(none). inherit/revert →
// 모델 불가 unsupported. 유효 grammar → valid(값). well-formed var 포함 문법위반 → 계산시점 유예 unsupported.
// 순수 문법 위반(var 없음, 예: negative blur `inset 0 0 -1px 1px #000`) → invalid(폐기 → 이전 유효 선언 fallback).
// I3(15R) — boolean isValidBoxShadow 대신 **삼분 결과**(classifyBoxShadowValue)를 소비한다.
//   valid       → 그 값이 cascade 승자 값
//   unsupported → 표준이나 우리가 계산 못 함(calc 등) → 선언은 적용되나 fail-closed
//   invalid     → 확실한 문법 위반(인자 부족 색함수·미지 word·negative blur 등) → 폐기(이전 선언 fallback),
//                 단 well-formed var를 포함하면 계산시점 유예(deferred)라 unsupported로 재분류.
function classifyBoxShadowDecl(v) {
  const cw = cssWideKeyword(v);
  if (cw === 'initial' || cw === 'unset') return { kind: 'valid', value: 'none' };
  if (cw) return { kind: 'unsupported' }; // inherit/revert(-layer)
  const cls = classifyBoxShadowValue(v);
  if (cls === 'valid') return { kind: 'valid', value: v };
  if (cls === 'unsupported') return { kind: 'unsupported' };
  if (valueHasWellFormedVar(v)) return { kind: 'unsupported' }; // deferred(계산시점 유예)
  return { kind: 'invalid' }; // 폐기
}
// `all`은 스펙상 CSS-wide 키워드만 받는다. initial/unset → 전 프로퍼티 initial(box-shadow none/border-style
// none). inherit/revert(-layer) → 모델 불가 fail-closed.
// I1(15R) — 그 외를 무조건 "불법 → 폐기"로 보내던 게 false-green의 원인이었다. `all: var(--x)`처럼
// **well-formed var를 포함**하면 CSS Variables 스펙상 parse-time 검사가 계산시점으로 유예돼 브라우저는
// 이 선언을 폐기하지 않고 cascade에 참여시킨다(이기면 계산시점에 무효화 → 전 프로퍼티 초기/상속값).
// 우리는 그 계산을 재현할 수 없으므로 unsupported(fail-closed)로 참여시킨다. **border·indicator 두
// 도메인이 이 함수 하나를 공유**한다(이원화 재발 방지).
function classifyAllDecl(v) {
  const cw = cssWideKeyword(v);
  if (cw === 'initial' || cw === 'unset') return { kind: 'valid', value: 'none' };
  if (cw) return { kind: 'unsupported' };
  if (valueHasWellFormedVar(v)) return { kind: 'unsupported' }; // deferred(계산시점 유예)
  return { kind: 'invalid' };
}
// I2/I5(14R) — box-shadow 최종 유효 상태를 cascade 합성한다(box-shadow 선언 + `all` 전역 리셋을 문서
// 순서·!important대로). border의 synthesizeBorderSides와 대칭 구조. 반환 { value: <최종값 or 'none'>, unsupported }.
function synthesizeIndicatorShadow(rules) {
  const cell = { value: 'none', important: false, unsupported: false }; // box-shadow initial = none
  const apply = (result, important) => {
    if (result.kind === 'invalid') return; // 폐기 → 무변화(이전 유효 선언 유지 = fallback)
    if (cell.important && !important) return; // important가 후행 non-important를 이김
    if (result.kind === 'unsupported') { cell.value = null; cell.unsupported = true; cell.important = important; return; }
    cell.value = result.value; cell.unsupported = false; cell.important = important;
  };
  rules.forEach((rule) => {
    rule.walkDecls((decl) => {
      const prop = normalizeProp(decl.prop);
      const v = decl.value.trim();
      if (prop === 'box-shadow') apply(classifyBoxShadowDecl(v), !!decl.important);
      else if (prop === 'all') apply(classifyAllDecl(v), !!decl.important);
    });
  });
  return cell;
}
function evaluateIndicatorVisibility(rules, token) {
  // I2/I5(14R) — 공용 삼분 파이프라인으로 box-shadow(+ all CSS-wide 리셋) cascade를 합성한 뒤 최종값의
  // 인디케이터 가시성을 판정한다. unsupported(deferred/inherit) → fail-closed RED. 'none'(또는 미선언·
  // 폐기 fallback으로 none) → 인디케이터 없음 RED. 유효 최종값이면 기대 토큰을 직접 top-level var로 쓰는
  // 레이어를 찾아(wrapper 색함수 fail-closed, F2) 구조적 가시성을 본다.
  const cell = synthesizeIndicatorShadow(rules);
  if (cell.unsupported) return { visible: false, reason: 'box-shadow unsupported(deferred/inherit/revert)', cell };
  if (cell.value === 'none') return { visible: false, reason: 'box-shadow none(또는 미선언/폐기 fallback)', cell };
  const layer = splitTopLevelLayers(cell.value).find((l) => topLevelVarTokens(l).has(token));
  if (!layer) return { visible: false, reason: '직접 var 인디케이터 레이어 미발견', cell };
  const shape = assertVisibleInsetShadowLayer(layer);
  return { visible: shape.visible, shape, layer, cell };
}
function evaluatePinnedContract(cssText, selector, contract) {
  const root = postcss.parse(cssText);
  const rules = findRootRules(root, selector);
  if (rules.length === 0) return { visible: false, rulesFound: 0, reason: `${selector} 규칙(root 직속·완전일치) 미발견` };
  const r = contract.kind === 'indicator'
    ? evaluateIndicatorVisibility(rules, contract.token)
    : evaluateBorderVisibility(rules, contract.token);
  return { rulesFound: rules.length, ...r };
}
// synthetic 진입점 — PINNED과 동일하게 Sass compile을 거쳐 공용 evaluator에 태운다.
const evalBorderScss = (scss, token = 'color-input-border') =>
  evaluatePinnedContract(compileString(scss).css, '.X', { kind: 'border', token });
const evalIndicatorScss = (scss, token) =>
  evaluatePinnedContract(compileString(scss).css, '.X', { kind: 'indicator', token });
// ─────────────────────────────────────────────────────────────────────────────

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
  // INDICATOR_PROPS는 이제 모듈 스코프(공용 evaluator가 공유). 여기선 PINNED 항목의 kind 마커로만 참조한다.
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
    const [expectedToken] = topLevelVarTokens(needle); // needle(직접 var)도 동일 파서로 토큰화(정합성 보장)
    const kind = props === INDICATOR_PROPS ? 'indicator' : 'border';
    // I5 — PINNED 본문도 mutation synthetic과 **완전히 동일한 공용 evaluator**를 호출한다(부분 경로 폐기).
    const res = evaluatePinnedContract(compiledSiteCss(file), selector, { kind, token: expectedToken });
    expect(res.rulesFound, `${selector} 규칙(root 직속·셀렉터 완전일치)을 컴파일된 ${file}에서 찾지 못함`).toBeGreaterThan(0);
    expect(
      res.visible,
      `${selector} ${kind} 계약 위반(기대 토큰 "${expectedToken}") — ${JSON.stringify(res)}`,
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
    // I5 — PINNED과 **동일한 공용 evaluator**를 통해 Sass compile→parse→cascade→가시성 전 체인을 탄다.
    const perimeterVisible = (scss) => evalBorderScss(scss, TOKEN).visible;

    // A(RED) — 실뷰포트에서 보더가 소실/토큰 미사용인데 이전 모델이 false-green 처리하던 케이스.
    // 원 7종(11라운드) + 내부 리뷰 잔여 3종(논리 프로퍼티·`all` 리셋·unitless 비영 width) = 10종.
    it.each([
      ['shorthand 후 border-width:0 → 전면 width 0', `.X{border:1px solid ${V};border-width:0}`],
      ['shorthand 후 border-style:none → 전면 style none', `.X{border:1px solid ${V};border-style:none}`],
      ['shorthand 후 border-color:transparent → 토큰이 후행 override로 소실', `.X{border:1px solid ${V};border-color:transparent}`],
      // calc는 Sass가 상수식을 미리 접으므로(calc(0px)→0px) 컴파일 후에도 남는 형태(calc(100% - 2px),
      // %는 런타임 해석)를 써 "지원 밖 문법 = fail-closed" 경로를 실제로 태운다.
      ['border: calc(100% - 2px) solid var(…) → calc width는 미지원(fail-closed)', `.X{border:calc(100% - 2px) solid ${V}}`],
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

describe('12R F2/F3/F4 — border perimeter 경로 mutation matrix', () => {
  const TOKEN = 'color-input-border';
  const V = 'var(--color-input-border)';
  const perimeterVisible = (scss) => evalBorderScss(scss, TOKEN).visible; // I5 공용 evaluator(compile 경유)

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

  // F4 — border 문법 전체 top-level AST 소비. 미소비 잔여(string·div)·불법 성분은 폐기(cascade 제외),
  // calc 등 지원 밖은 fail-closed. shorthand 전체가 폐기되면 이전 유효값이 없으면 initial(style none)이라 비가시.
  it.each([
    ['1% width(border-width % 불허)', `.X{border:1% solid ${V}}`],
    ['1px/solid(slash div 잔여)', `.X{border:1px/solid ${V}}`],
    ['1px,solid(comma div 잔여)', `.X{border:1px,solid ${V}}`],
    ['string junk 잔여', `.X{border:1px solid ${V} "junk"}`],
    // 무효 comma border-width는 폐기 → 이전 유효값(border-width:0)으로 fallback → width 0 유지(비가시).
    // 만약 comma가 잘못 소비되면 1px로 되살아나 가시가 됐을 것(false-green) — 이 fallback이 RED를 보장한다.
    ['border-width comma 무효 → 폐기, 이전 0으로 fallback', `.X{border-width:0;border-style:solid;border-color:${V};border-width:1px,1px}`],
  ])('F4 RED: %s → 폐기/fail-closed', (_l, cssText) => {
    expect(perimeterVisible(cssText)).toBe(false);
  });
  // 폐기 의미론 명시 — 무효 comma border-width 뒤에 유효 shorthand(1px)가 있으면 브라우저처럼 fallback으로 가시.
  it('F4 GREEN(폐기 의미론): 무효 border-width:1px,1px는 앞선 유효 shorthand 1px로 fallback → 가시', () => {
    expect(perimeterVisible(`.X{border:1px solid ${V};border-width:1px,1px}`)).toBe(true);
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
  const perimeterVisible = (scss) => evalBorderScss(scss, TOKEN).visible; // I5 공용 evaluator(compile 경유)
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

// F1(923행)의 decodeCssIdentifier는 hasProtectedPrefix에만 배선되고 normalizeProp(cascade predicate·
// state 키)에는 미적용이었다(내부 리뷰 실증, 12라운드 리뷰 실증분) — escaped 선언이 reduceEffectiveDecls/
// synthesizeBorderSides 양쪽에서 predicate 탈락·BORDER_PROP_RE 미매치로 cascade에서 통째로 실종됐다.
// normalizeProp이 decodeCssIdentifier로 먼저 디코딩하도록 고치면 두 소비처(다크 cascade·border cascade)가
// 한 번에 닫힌다. findUnprotectedDeclarations는 hasProtectedPrefix 자체 디코딩 경로라 애초에 무관했지만
// (구현자 노트로만 남았던 P3 역방향 우려) 회귀 안전 확인용으로 같이 고정한다.
describe('12R F5 — normalizeProp CSS 식별자 디코더 선통과 (F1 cascade 실종·BORDER_PROP_RE 우회 폐쇄)', () => {
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

  it('border: 후행 \\42order:none(디코딩=border, 핀 아날로그) 선언이 perimeter를 무보호로 되돌린다(BORDER_PROP_RE 우회 폐쇄)', () => {
    const V = 'var(--color-input-border)';
    // 이 테스트는 normalizeProp의 **raw 식별자 디코딩**을 검증한다 — Sass는 escape를 선(先)정규화하므로
    // (\42order→Border) compileString을 태우면 normalizeProp의 decode 경로가 실행되지 않는다. 따라서 공용
    // evaluator를 호출하되(동일 함수) cssText는 raw로 넣어 postcss.parse가 escape를 보존하게 한다.
    const cssText = `.X{border:1px solid ${V};\\42order:none}`;
    const res = evaluatePinnedContract(cssText, '.X', { kind: 'border', token: 'color-input-border' });
    expect(res.visible).toBe(false);
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
  // 리터럴 백슬래시를 낳아, **재디코딩하면 값이 달라진다**(백슬래시가 다음 문자를 다시 escape로 소비).
  // 이는 "정확히 한 번만 디코딩"(단일 decode 지점=normalizeProp 진입부) 계약을 고정한다 — decode를 두
  // 곳에서 하면 이런 이름이 조용히 오독된다. 현실 escape(선행 하이픈)와 달리 이 케이스는 idempotent가
  // 아님을 명시적으로 단정해, 위 멱등 케이스가 "우연히 백슬래시가 없어서" 통과한 게 아님을 대조 증명한다.
  it('멱등성 음성 대조: \\5c(백슬래시 hex escape) 포함 이름은 1회≠2회 디코딩 — 단일 소비 계약 고정', () => {
    const once = decodeCssIdentifier('--color\\5c x'); // \5c → 리터럴 '\' , 뒤 공백 1개 소비
    expect(once).toBe('--color\\x'); // 리터럴 백슬래시 1개 남음
    expect(decodeCssIdentifier(once)).toBe('--colorx'); // 재디코딩: \x → x (백슬래시 소비) → 값 변함
    expect(decodeCssIdentifier(once)).not.toBe(once); // 비-멱등: 이 지점을 두 번 태우면 오독됨을 명시
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13라운드 회귀 게이트 — I1~I5·M1의 false-green/false-RED 구조 폐쇄. border/indicator visibility 계열은
// 전부 공용 evaluator(evalBorderScss/evalIndicatorScss = compileString→evaluatePinnedContract)를 태워
// PINNED 본문과 완전히 동일한 체인에서 검증된다(I5). 각 mutation은 현행 HEAD false-green을 상설 RED로,
// false-RED를 GREEN으로 뒤집는다(선재현 스크립트로 사전 확인).
// ─────────────────────────────────────────────────────────────────────────────
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

describe('13R I2 — var() 문법 유효성 + box-shadow 선언 전체 유효성', () => {
  it('I2a: var(--x garbage)(콤마 없는 잔여 인자)는 무효 문법 → 토큰 미수집', () => {
    expect(topLevelVarTokens('var(--color-input-border garbage)')).toEqual(new Set());
  });
  it('I2a: 유효 var(--x[, fallback])는 계속 수집(GREEN 유지)', () => {
    expect(topLevelVarTokens('var(--color-input-border)')).toEqual(new Set(['color-input-border']));
    expect(topLevelVarTokens('var(--x, #ccc)')).toEqual(new Set(['x']));
  });
  it('I2a: border color가 var(--x garbage)면 perimeter 무보호(RED, 공용 evaluator)', () => {
    expect(evalBorderScss('.X{border:1px solid var(--color-input-border garbage)}').visible).toBe(false);
  });

  const IND = 'color-selected-indicator';
  // I2b — 토큰 레이어만 보던 이전 판정이 놓친 "선언 전체 무효"(폐기 의미론): 한 레이어라도 무효면 RED.
  it.each([
    ['inset 중복', `.X{box-shadow:inset inset 0 0 0 1px var(--${IND})}`],
    ['color 2개(transparent + var)', `.X{box-shadow:inset 0 0 0 1px transparent var(--${IND})}`],
    ['무효 형제 레이어(junk)', `.X{box-shadow:junk, inset 0 0 0 1px var(--${IND})}`],
  ])('I2b RED: %s → 선언 전체 무효(폐기) → 인디케이터 비가시', (_l, scss) => {
    expect(evalIndicatorScss(scss, IND).visible).toBe(false);
  });
  it('I2b GREEN: 유효 단일 inset 레이어는 계속 가시', () => {
    expect(evalIndicatorScss(`.X{box-shadow:inset 0 0 0 1px var(--${IND})}`, IND).visible).toBe(true);
  });
  it('I2b GREEN: 다중 그림자(HomeTabs식 var(--shadow-xs) + inset)도 계속 가시', () => {
    expect(evalIndicatorScss(`.X{box-shadow:var(--shadow-xs), inset 0 0 0 1px var(--${IND})}`, IND).visible).toBe(true);
  });
  it('I2b GREEN(폐기 의미론): 무효 box-shadow(junk) 뒤 순서면 앞선 유효 선언으로 fallback → 가시', () => {
    expect(evalIndicatorScss(`.X{box-shadow:inset 0 0 0 1px var(--${IND});box-shadow:junk}`, IND).visible).toBe(true);
  });
});

describe('13R I3 — directional/성분 longhand 전 노드 소비(미소비 잔여 = 폐기)', () => {
  const V = 'var(--color-input-border)';
  const dir = (suffix) => `border-top-width:${suffix};border-right-width:${suffix};border-bottom-width:${suffix};border-left-width:${suffix}`;
  it('RED: border-width:0 후 4면 directional 잔여노드(1px "junk")는 폐기 → width 0 유지', () => {
    expect(evalBorderScss(`.X{border-width:0;border-style:solid;border-color:${V};${dir('1px "junk"')}}`).visible).toBe(false);
  });
  it('GREEN(대조): 잔여 없는 유효 directional(1px)는 정상 적용 → 가시(잔여만이 폐기 원인임을 증명)', () => {
    expect(evalBorderScss(`.X{border-width:0;border-style:solid;border-color:${V};${dir('1px')}}`).visible).toBe(true);
  });
});

describe('13R I4 — border-image shorthand 의미론 양방향', () => {
  const V = 'var(--color-input-border)';
  it('I4(a) GREEN: border-image:none은 생략 longhand(slice 등)도 initial 리셋 → stale slice 무효화, 보더 가시', () => {
    expect(evalBorderScss(`.X{border:1px solid ${V};border-image-slice:5;border-image:none}`).visible).toBe(true);
  });
  it('I4(b) RED: 무효 shorthand(border:junk)는 아무것도 리셋 안 함 → 이전 투명 border-image 유지 → 비가시', () => {
    const scss = `.X{border-image:linear-gradient(transparent,transparent) 1;border-width:1px !important;border-style:solid !important;border-color:${V} !important;border:junk}`;
    expect(evalBorderScss(scss).visible).toBe(false);
  });
});

describe('13R M1 — 표준 <length> 단위 집합(%는 계속 거부)', () => {
  it.each(['1lh', '1rlh', '1dvw', '1dvh', '1svh', '1lvw', '1vi', '1vb', '1cqw', '1cqi', '1cqmin', '1cqmax'])
    ('%s 는 유효 <length>', (u) => { expect(isLengthWord(u)).toBe(true); });
  it('%는 <length> 아님 → 계속 거부', () => { expect(isLengthWord('1%')).toBe(false); });
  it('unitless 비영은 계속 거부(0만 unitless 유효)', () => {
    expect(isLengthWord('5')).toBe(false);
    expect(isLengthWord('0')).toBe(true);
  });
  it('신규 단위가 실제 소비처(box-shadow spread)에서도 유효 length로 인정된다', () => {
    expect(assertVisibleInsetShadowLayer('inset 0 0 0 1lh var(--x)').visible).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13R 잔여1(내부 리뷰 실증, 13라운드 수렴분) — css-variables deferred validation. CSS 스펙상 well-formed
// var()를 포함한 선언은 parse-time 문법검사가 computed-value time으로 유예돼, 우리 grammar와 안 맞아도
// 브라우저에선 유효 선언으로 cascade에 참여한다(승리하면 계산시점에 무효화 — 이전 선언 fallback이
// 아니다). 이전 모델은 지원 grammar 불일치를 well-formed var() 포함 여부와 무관하게 전부 invalid(폐기)로
// 분류해, 후행의 grammar-위반+var-포함 선언이 이전 유효 선언으로 fallback돼 false-green을 냈다. 이
// describe는 valueHasWellFormedVar 단위 계약과, box-shadow/border 양쪽에서의 재분류를 공용 evaluator
// (evalIndicatorScss/evalBorderScss)로 고정한다.
// ─────────────────────────────────────────────────────────────────────────────
describe('13R 잔여1 — css-variables deferred validation: well-formed var() 포함 문법위반 재분류(invalid→unsupported)', () => {
  describe('valueHasWellFormedVar — 단위 계약(I2a 재사용 경계)', () => {
    it('well-formed var()는 true', () => {
      expect(valueHasWellFormedVar('var(--x)')).toBe(true);
      expect(valueHasWellFormedVar('var(--x, #ccc)')).toBe(true);
    });
    it('형제(top-level 나열) well-formed var 2개도 true', () => {
      expect(valueHasWellFormedVar('inset 0 0 0 var(--zero) var(--ind)')).toBe(true);
    });
    it('중첩(calc() 안 var())도 true — deferred validity는 깊이 무관', () => {
      expect(valueHasWellFormedVar('calc(1px + var(--x))')).toBe(true);
    });
    it('var() 자체가 없으면 false', () => {
      expect(valueHasWellFormedVar('1px solid red')).toBe(false);
      expect(valueHasWellFormedVar('junk')).toBe(false);
    });
    it('well-formed 아닌 var(콤마 없는 잔여 인자)만 있으면 false(I2a 계약 무충돌)', () => {
      expect(valueHasWellFormedVar('var(--x garbage)')).toBe(false);
    });
  });

  describe('RED — 후행이 well-formed var() 포함 grammar 위반이면 unsupported로 cascade 승리(fail-closed)', () => {
    const IND = 'color-selected-indicator';
    it('box-shadow(리뷰어 probe): spread 자리 var(--zero) → 후행이 unsupported로 이겨 비가시', () => {
      const scss = `.X{box-shadow:inset 0 0 0 1px var(--${IND});box-shadow:inset 0 0 0 var(--zero) var(--${IND})}`;
      expect(evalIndicatorScss(scss, IND).visible).toBe(false);
    });

    const TOKEN = 'color-input-border';
    const V = `var(--${TOKEN})`;
    it('border 아날로그: width 자리 var(--w) → 슬롯 중복(invalid였던 것)이 unsupported로 재분류돼 후행이 이겨 비가시', () => {
      const scss = `.X{border:1px solid ${V};border:var(--w) solid ${V}}`;
      expect(evalBorderScss(scss).visible).toBe(false);
    });
  });

  describe('무회귀 — var() 없는 grammar 위반은 기존대로 폐기(invalid) → 이전 유효 선언 fallback(GREEN)', () => {
    const IND = 'color-selected-indicator';
    it('box-shadow: var() 전혀 없는 위반(length 5개 초과)은 폐기 → 이전 선언 유지, 가시', () => {
      const scss = `.X{box-shadow:inset 0 0 0 1px var(--${IND});box-shadow:inset 0 0 0 1px 2px}`;
      expect(evalIndicatorScss(scss, IND).visible).toBe(true);
    });

    const TOKEN = 'color-input-border';
    const V = `var(--${TOKEN})`;
    it('border: var() 전혀 없는 위반(width 슬롯 중복)은 폐기 → 이전 선언 유지, 가시', () => {
      const scss = `.X{border:1px solid ${V};border:1px 2px solid}`;
      expect(evalBorderScss(scss).visible).toBe(true);
    });
  });

  describe('무회귀 — well-formed 아닌 var(예: var(--x garbage))만 포함한 위반은 기존 invalid 폐기 유지(I2a 계약 무충돌)', () => {
    const IND = 'color-selected-indicator';
    it('box-shadow: 값 전체에 var()가 var(--zero garbage) 하나뿐(무효 문법)이면 폐기 → 이전 선언 유지, 가시', () => {
      const scss = `.X{box-shadow:inset 0 0 0 1px var(--${IND});box-shadow:inset 0 0 0 var(--zero garbage)}`;
      expect(evalIndicatorScss(scss, IND).visible).toBe(true);
    });

    const TOKEN = 'color-input-border';
    const V = `var(--${TOKEN})`;
    it('border: 값 전체에 var()가 var(--w garbage) 하나뿐(무효 문법)이면 폐기 → 이전 선언 유지, 가시', () => {
      const scss = `.X{border:1px solid ${V};border:solid var(--w garbage)}`;
      expect(evalBorderScss(scss).visible).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14라운드 회귀 게이트 — 선언 단위 삼분법 일반화(CSS-wide/all·재귀 var·색함수 문법·border-image). 외부
// 검수가 headless Chrome computed style로 대조한 벡터를 상설 synthetic화한다(선재현: HEAD false-green/
// false-RED → 정정). border/indicator visibility는 전부 공용 evaluator(evalBorderScss/evalIndicatorScss =
// compileString→evaluatePinnedContract)를 태워 PINNED 본문과 완전히 동일한 체인에서 검증된다(I5).
// 기대 반전 2건(사유 주석 병기): I2 negative-blur(var 없음)=RED→GREEN, I4 border-image:initial=RED→GREEN.
// ─────────────────────────────────────────────────────────────────────────────

describe('14R I1 — border longhand 삼분(deferred/CSS-wide/named-color) — 공용 evaluator', () => {
  const CIB = 'color-input-border';
  const V = 'var(--color-input-border)';
  const vis = (scss) => evalBorderScss(scss, CIB).visible;
  // RED (선재현: 전부 GREEN false-green — 이전 게이트는 invalid 폐기로 이전 토큰 유지)
  it('RED: directional border-top-color: var(--t) "junk" → deferred(계산시점 유예) 참여 → currentcolor(토큰 소실)', () => {
    expect(vis(`.X{border:1px solid ${V};border-top-color:${V} "junk"}`)).toBe(false);
  });
  it('RED: border-style: initial → CSS-wide → style none → 비가시', () => {
    expect(vis(`.X{border:1px solid ${V};border-style:initial}`)).toBe(false);
  });
  it('RED: border-color: red → named color override(토큰 아님)', () => {
    expect(vis(`.X{border:1px solid ${V};border-color:red}`)).toBe(false);
  });
  it('RED: border-color: inherit → CSS-wide unsupported(fail-closed)', () => {
    expect(vis(`.X{border:1px solid ${V};border-color:inherit}`)).toBe(false);
  });
  it('RED: border-width: unset → 비상속이라 initial(medium)이나 border-style 미변… 실은 style solid 유지 가시', () => {
    // width:unset → medium(가시), style solid·color 토큰 유지 → 가시(대조: unset은 initial 동치라 width만 medium)
    expect(vis(`.X{border:1px solid ${V};border-width:unset}`)).toBe(true);
  });
  // GREEN 대조 — 순수 문법 위반(var 없음)은 폐기 → 이전 유효값 fallback (deferred가 아님을 증명)
  it('GREEN: 잔여 없는 유효 directional 재확인(border-top-color: V)', () => {
    expect(vis(`.X{border:1px solid ${V};border-top-color:${V}}`)).toBe(true);
  });
  it('GREEN(폐기): var 없는 순수 문법위반(border-top-color: red blue) → 폐기 → 이전 토큰 fallback', () => {
    expect(vis(`.X{border:1px solid ${V};border-top-color:red blue}`)).toBe(true);
  });
  it('parseBorderShorthand CSS-wide: initial→세 성분 initial(style none), inherit→unsupported', () => {
    const pi = parseBorderShorthand('initial');
    expect(pi.style.value).toBe('none');
    expect(pi.width.value).toBe('medium');
    expect(pi.color.value).toBe('currentcolor');
    expect(pi.invalid).toBe(false);
    const ph = parseBorderShorthand('inherit');
    expect(ph.width.unsupported && ph.style.unsupported && ph.color.unsupported).toBe(true);
  });
  it('RED: border: initial(shorthand 전체 CSS-wide) → style none → 비가시', () => {
    expect(vis(`.X{border:1px solid ${V};border:initial}`)).toBe(false);
  });
});

describe('14R I2 — indicator CSS-wide·all·negative blur 방향(공용 evaluator)', () => {
  const IND = 'color-selected-indicator';
  const IV = 'var(--color-selected-indicator)';
  const vis = (scss) => evalIndicatorScss(scss, IND).visible;
  it('RED: box-shadow: initial → CSS-wide → none → 인디케이터 없음', () => {
    expect(vis(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:initial}`)).toBe(false);
  });
  it('RED: all: initial → box-shadow none로 리셋', () => {
    expect(vis(`.X{box-shadow:inset 0 0 0 1px ${IV};all:initial}`)).toBe(false);
  });
  it('GREEN(순서 대칭): all: initial 후 box-shadow 토큰 → box-shadow가 이김', () => {
    expect(vis(`.X{all:initial;box-shadow:inset 0 0 0 1px ${IV}}`)).toBe(true);
  });
  it('RED: all: initial !important 는 후행 non-important box-shadow를 이김', () => {
    expect(vis(`.X{all:initial !important;box-shadow:inset 0 0 0 1px ${IV}}`)).toBe(false);
  });
  // ── 기대 반전(선재현: RED → GREEN). 사유: negative blur(var 없음)는 순수 문법위반 → invalid 폐기 →
  //    브라우저(Chrome)는 그 선언을 폐기하고 이전 인디케이터를 유지한다. 이전 게이트는 isValidBoxShadow가
  //    blur 부호를 안 봐 negative blur를 유효로 참여시켜 토큰 미사용 레이어로 판정 → false-RED였다. 브라우저
  //    정합 우선 원칙에 따라 GREEN으로 정정한다(assertVisibleInsetShadowLayer의 시각 단정 RED는 별개로 유지).
  it('기대 반전 GREEN: negative blur(#000, var 없음) 후행은 폐기 → 이전 토큰 선언 fallback', () => {
    expect(vis(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 -1px 1px #000}`)).toBe(true);
  });
  it('대조 RED: negative blur라도 well-formed var 포함이면 deferred(unsupported)로 참여', () => {
    expect(vis(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 -1px 1px ${IV}}`)).toBe(false);
  });
  it('classifyBoxShadowDecl 삼분', () => {
    expect(classifyBoxShadowDecl('initial')).toEqual({ kind: 'valid', value: 'none' });
    expect(classifyBoxShadowDecl('unset')).toEqual({ kind: 'valid', value: 'none' });
    expect(classifyBoxShadowDecl('inherit')).toEqual({ kind: 'unsupported' });
    expect(classifyBoxShadowDecl('inset 0 0 0 1px var(--x)')).toEqual({ kind: 'valid', value: 'inset 0 0 0 1px var(--x)' });
    expect(classifyBoxShadowDecl('inset 0 0 -1px 1px #000')).toEqual({ kind: 'invalid' });
    expect(classifyBoxShadowDecl('inset 0 0 -1px 1px var(--x)')).toEqual({ kind: 'unsupported' });
    expect(classifyBoxShadowDecl('junk')).toEqual({ kind: 'invalid' });
  });
  it('classifyAllDecl: initial/unset→none, inherit→unsupported, 비CSS-wide→invalid', () => {
    expect(classifyAllDecl('initial')).toEqual({ kind: 'valid', value: 'none' });
    expect(classifyAllDecl('unset')).toEqual({ kind: 'valid', value: 'none' });
    expect(classifyAllDecl('inherit')).toEqual({ kind: 'unsupported' });
    expect(classifyAllDecl('red')).toEqual({ kind: 'invalid' });
  });
  it('synthesizeIndicatorShadow: box-shadow + all cascade(문서순서·폐기 fallback)', () => {
    const shadow = (cssText) => synthesizeIndicatorShadow(findRootRules(postcss.parse(cssText), '.X'));
    expect(shadow('.X{box-shadow:inset 0 0 0 1px var(--i);all:initial}').value).toBe('none');
    expect(shadow('.X{all:initial;box-shadow:inset 0 0 0 1px var(--i)}').value).toBe('inset 0 0 0 1px var(--i)');
    expect(shadow('.X{box-shadow:inset 0 0 0 1px var(--i);box-shadow:junk}').value).toBe('inset 0 0 0 1px var(--i)');
  });
});

describe('14R I3 — 재귀 var·색함수 문법·VAR()/--_name 오거부 정정', () => {
  it('재귀 var: fallback 내부 malformed var면 outer도 무효 → 토큰 미수집', () => {
    expect(topLevelVarTokens('var(--color-input-border, var(--bad garbage))')).toEqual(new Set());
  });
  it('재귀 var(대조): fallback이 정상 var면 outer 토큰 정상 수집', () => {
    expect(topLevelVarTokens('var(--color-input-border, var(--fallback))')).toEqual(new Set(['color-input-border']));
  });
  it('재귀 var 통합: border color가 malformed 중첩 var면 선언 무효 → perimeter RED', () => {
    expect(evalBorderScss('.X{border:1px solid var(--color-input-border, var(--bad garbage))}', 'color-input-border').visible).toBe(false);
  });
  it('isVarFunction: 함수명 case-insensitive', () => {
    expect(isVarFunction(valueParser('VAR(--x)').nodes[0])).toBe(true);
    expect(isVarFunction(valueParser('Var(--x)').nodes[0])).toBe(true);
    expect(isVarFunction(valueParser('calc(1px)').nodes[0])).toBe(false);
    expect(isVarFunction(valueParser('1px').nodes[0])).toBe(false);
  });
  it('VAR() 대문자 인정(안전방향 fail-closed → 정확 인정 정정)', () => {
    expect(topLevelVarTokens('VAR(--x)')).toEqual(new Set(['x']));
    expect(valueHasWellFormedVar('Var(--x)')).toBe(true);
  });
  it('--_name(underscore dashed-ident) 인정', () => {
    expect(topLevelVarTokens('var(--_name)')).toEqual(new Set(['_name']));
    expect(varFunctionToken(valueParser('var(--_x-y_z)').nodes[0])).toBe('_x-y_z');
  });
  it('box-shadow 색함수 내부 문법: rgb(from junk r g b) 레이어 무효 → 선언 유예/폐기 → RED', () => {
    expect(evalIndicatorScss('.X{box-shadow:0 0 rgb(from junk r g b), inset 0 0 0 1px var(--color-selected-indicator)}', 'color-selected-indicator').visible).toBe(false);
  });
  it('isValidColorFunctionNode 단위: from junk 무효, from var 유효, color-mix 유효, 미지 채널 무효', () => {
    expect(isValidColorFunctionNode(valueParser('rgb(from junk r g b)').nodes[0])).toBe(false);
    expect(isValidColorFunctionNode(valueParser('rgb(from var(--t) r g b)').nodes[0])).toBe(true);
    expect(isValidColorFunctionNode(valueParser('color-mix(in srgb, var(--t) 40%, transparent)').nodes[0])).toBe(true);
    expect(isValidColorFunctionNode(valueParser('rgb(1 2 junk)').nodes[0])).toBe(false);
    expect(isValidColorFunctionNode(valueParser('rgba(94, 106, 210, 0.1)').nodes[0])).toBe(true);
  });
  it('성분 순서: color가 length 사이에 끼면 무효 layer', () => {
    // `0 red 0` = length,color,length → length 비연속 → invalid box-shadow
    expect(isValidBoxShadow('inset 0 red 0 1px var(--x)')).toBe(false);
    expect(isValidBoxShadow('inset 0 0 0 1px red')).toBe(true);
  });
});

describe('14R I4 — border-image 삼분+CSS-wide 양방향', () => {
  const CIB = 'color-input-border';
  const V = 'var(--color-input-border)';
  const vis = (scss) => evalBorderScss(scss, CIB).visible;
  // 기대 반전(선재현: RED → GREEN). 사유: 이전 게이트는 non-none이면 source=원문으로 둬 CSS-wide "initial"을
  // 활성 이미지로 오인(false-RED). initial은 5 longhand를 initial로 리셋 → 일반 보더가 그대로 보인다.
  it('기대 반전 GREEN: border-image: initial → 5 longhand initial 리셋 → 일반 보더 가시(순수형)', () => {
    expect(vis(`.X{border:1px solid ${V};border-image:initial}`)).toBe(true);
  });
  it('기대 반전 GREEN: stale slice:5 후 border-image:initial → 리셋으로 slice 무효화 → 가시', () => {
    expect(vis(`.X{border:1px solid ${V};border-image-slice:5;border-image:initial}`)).toBe(true);
  });
  it('RED: border-image: junk 후 source:none → junk 폐기(slice 5 잔존) → 도장 활성 fail-closed', () => {
    expect(vis(`.X{border:1px solid ${V};border-image-slice:5;border-image:junk;border-image-source:none}`)).toBe(false);
  });
  it('RED: border-image: inherit → 모델 불가 unsupported(fail-closed)', () => {
    expect(vis(`.X{border:1px solid ${V};border-image:inherit}`)).toBe(false);
  });
  it('classifyBorderImageShorthand 분류(reset/active/unsupported/invalid)', () => {
    expect(classifyBorderImageShorthand('initial').kind).toBe('reset');
    expect(classifyBorderImageShorthand('unset').kind).toBe('reset');
    expect(classifyBorderImageShorthand('none').kind).toBe('reset');
    expect(classifyBorderImageShorthand('junk').kind).toBe('invalid');
    expect(classifyBorderImageShorthand('inherit').kind).toBe('unsupported');
    expect(classifyBorderImageShorthand('var(--img)').kind).toBe('unsupported');
    expect(classifyBorderImageShorthand('linear-gradient(red,blue) 1').kind).toBe('active');
    expect(classifyBorderImageShorthand('url(a.png) 30 fill').kind).toBe('active');
  });
});

describe('14R I5 — evaluator 통일: 필수 전이 3형태 × border·indicator(전부 공용 evaluator 경유)', () => {
  const CIB = 'color-input-border';
  const V = 'var(--color-input-border)';
  const IND = 'color-selected-indicator';
  const IV = 'var(--color-selected-indicator)';
  const bvis = (scss) => evalBorderScss(scss, CIB).visible;
  const ivis = (scss) => evalIndicatorScss(scss, IND).visible;
  // ① 이전 유효 → 후행 invalid(순수 문법위반, 폐기) → 이전 유효 fallback → 가시(GREEN)
  it('border ①: 유효 → 후행 순수 문법위반(값 5개>4, var 없음, 폐기) → fallback 가시', () => {
    expect(bvis(`.X{border:1px solid ${V};border-color:red red red red red}`)).toBe(true);
  });
  it('indicator ①: 유효 → 후행 순수 문법위반(폐기) → fallback 가시', () => {
    expect(ivis(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px 2px 3px}`)).toBe(true);
  });
  // ② 이전 유효 → 후행 unsupported/deferred(well-formed var 포함 위반) → 참여 fail-closed → RED
  it('border ②: 유효 → 후행 deferred → fail-closed RED', () => {
    expect(bvis(`.X{border:1px solid ${V};border-color:${V} "junk"}`)).toBe(false);
  });
  it('indicator ②: 유효 → 후행 deferred → fail-closed RED', () => {
    expect(ivis(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero) ${IV}}`)).toBe(false);
  });
  // ③ 후행 deferred → 최종 valid winner가 이김 → 가시(GREEN)
  it('border ③: deferred 후 유효 winner가 이김 → 가시', () => {
    expect(bvis(`.X{border:${V} "junk";border:1px solid ${V}}`)).toBe(true);
  });
  it('indicator ③: deferred 후 유효 winner가 이김 → 가시', () => {
    expect(ivis(`.X{box-shadow:inset 0 0 0 var(--zero) ${IV};box-shadow:inset 0 0 0 1px ${IV}}`)).toBe(true);
  });
});

describe('14R — cssWideKeyword 단위(공통 삼분 1단계)', () => {
  it('단일 CSS-wide 키워드만 인식(대소문자·공백 무관), 그 외 null', () => {
    expect(cssWideKeyword('initial')).toBe('initial');
    expect(cssWideKeyword(' UNSET ')).toBe('unset');
    expect(cssWideKeyword('revert-layer')).toBe('revert-layer');
    expect(cssWideKeyword('inherit')).toBe('inherit');
    expect(cssWideKeyword('1px solid red')).toBeNull();
    expect(cssWideKeyword('initial initial')).toBeNull();
    expect(cssWideKeyword('red')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14R 잔여1/2(내부 리뷰 실증, 14라운드 수렴분) — 리뷰어 probe가 실증한 잔여 2건. 둘 다 공용 evaluator
// (evalBorderScss/evalIndicatorScss)를 태워 PINNED 본문과 동일 체인에서 검증한다(I5 계약 유지).
// ─────────────────────────────────────────────────────────────────────────────

describe('14R 잔여1 — CSS 시스템 색(system colors) 유효 인정 (리뷰어 probe: false-green)', () => {
  const CIB = 'color-input-border';
  const V = `var(--${CIB})`;
  const bvis = (scss) => evalBorderScss(scss, CIB).visible;
  const IND = 'color-selected-indicator';
  const IV = `var(--${IND})`;
  const ivis = (scss) => evalIndicatorScss(scss, IND).visible;
  // 선재현(RED-proof): 이 두 벡터는 수정 전엔 AccentColor/ButtonText가 미지 ident=invalid(폐기)로
  // 처리돼 이전 토큰 선언으로 fallback했다 — 브라우저는 override를 적용해 토큰이 실제로 소실되는데
  // 게이트는 GREEN(false-green)이었다. 이번 라운드 #3의 `border-color: red`와 동일 모양.
  it('RED: border-color: AccentColor → 유효 시스템 색 override(토큰 아님)', () => {
    expect(bvis(`.X{border:1px solid ${V};border-color:AccentColor}`)).toBe(false);
  });
  it('RED: box-shadow inset … ButtonText → 유효 시스템 색으로 인디케이터 색 대체(토큰 아님)', () => {
    expect(ivis(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px ButtonText}`)).toBe(false);
  });
  it('RED: 대소문자 변형(accentcolor, 소문자)도 동일 — 키워드는 ASCII case-insensitive', () => {
    expect(bvis(`.X{border:1px solid ${V};border-color:accentcolor}`)).toBe(false);
  });
  it('RED: deprecated 시스템 색(ThreeDFace)도 유효 색으로 인정', () => {
    expect(bvis(`.X{border:1px solid ${V};border-color:ThreeDFace}`)).toBe(false);
  });
  it('GREEN(대조, 회귀 없음): 여전히 미지인 ident(NotAColor)는 계속 invalid(폐기) → 이전 토큰 fallback', () => {
    expect(bvis(`.X{border:1px solid ${V};border-color:NotAColor}`)).toBe(true);
  });
  it('isColorWord/COLOR_KEYWORDS 단위: 시스템 색 인정(대소문자 무관), 미지 ident는 계속 거부', () => {
    expect(isColorWord('AccentColor')).toBe(true);
    expect(isColorWord('buttontext')).toBe(true);
    expect(isColorWord('THREEDFACE')).toBe(true);
    expect(COLOR_KEYWORDS.has('accentcolor')).toBe(true);
    expect(COLOR_KEYWORDS.has('buttontext')).toBe(true);
    expect(isColorWord('NotAColor')).toBe(false);
    expect(COLOR_KEYWORDS.has('notacolor')).toBe(false);
  });
});

describe('14R 잔여2 — border-image longhand 삼분 파이프라인 정합 (리뷰어 probe: 삼분 비대칭)', () => {
  const CIB = 'color-input-border';
  const V = `var(--${CIB})`;
  const bvis = (scss) => evalBorderScss(scss, CIB).visible;
  // 기대 반전(선재현: RED → GREEN, I4a shorthand `border-image:initial` GREEN과 대칭). 사유: 이전엔
  // longhand가 triage 미경유 raw 설정이라 "initial" 문자열 자체를 non-none 값으로 오인해 도장 활성으로
  // 오판했다(false-RED). CSS-wide 리셋 인식 후엔 source가 none으로 리셋 → 일반 보더 가시.
  it('기대 반전 GREEN: border-image-source: initial → source none 리셋 → 일반 보더 가시(I4a와 대칭)', () => {
    expect(bvis(`.X{border:1px solid ${V};border-image-source:initial}`)).toBe(true);
  });
  // 이전엔 junk도 raw 문자열 그대로 채택돼 이전 상태(none)를 "junk"로 덮어써 도장 활성 오판(false-RED).
  // 문법 위반 → 폐기 → 이전 상태(none) 유지가 옳다.
  it('폐기 fallback GREEN: border-image-source: junk(이전 상태=none) → 폐기 → none 유지 → 가시', () => {
    expect(bvis(`.X{border:1px solid ${V};border-image-source:junk}`)).toBe(true);
  });
  // 대조(이전 상태 기준 판정의 반대 방향, I4(b)와 동일 원칙) — 이전 상태가 활성 이미지였다면 junk는
  // 그 활성 상태를 지우지 않는다(폐기 = 무동작이지 리셋이 아님).
  it('폐기 fallback 대조 RED: 이전 상태=활성 이미지일 때 junk는 활성 상태를 지우지 않음(계속 비가시)', () => {
    const scss = `.X{border:1px solid ${V};border-image-source:linear-gradient(red,blue);border-image-source:junk}`;
    expect(bvis(scss)).toBe(false);
  });
  // deferred(계산시점 유예) — well-formed var 포함 문법위반은 폐기가 아니라 unsupported로 cascade 참여
  // → 전체 perimeter fail-closed. slice/width/outset/repeat는 정밀 grammar를 새로 모델링하지 않지만
  // well-formed var만은 명시적으로 deferred 분류한다.
  it('deferred RED: border-image-slice: var(--x) → unsupported(fail-closed) → perimeter 비가시', () => {
    expect(bvis(`.X{border:1px solid ${V};border-image-slice:var(--x)}`)).toBe(false);
  });
  it('classifyBorderImageLonghand 분류(reset/active/unsupported/invalid) — source', () => {
    expect(classifyBorderImageLonghand('source', 'initial')).toEqual({ kind: 'reset' });
    expect(classifyBorderImageLonghand('source', 'unset')).toEqual({ kind: 'reset' });
    expect(classifyBorderImageLonghand('source', 'none')).toEqual({ kind: 'reset' });
    expect(classifyBorderImageLonghand('source', 'junk').kind).toBe('invalid');
    expect(classifyBorderImageLonghand('source', 'inherit').kind).toBe('unsupported');
    expect(classifyBorderImageLonghand('source', 'var(--img)').kind).toBe('unsupported');
    expect(classifyBorderImageLonghand('source', 'linear-gradient(red,blue)').kind).toBe('active');
    expect(classifyBorderImageLonghand('source', 'url(a.png)').kind).toBe('active');
  });
  it('classifyBorderImageLonghand 분류 — slice/width/outset/repeat(정밀 grammar 없음, var만 deferred)', () => {
    expect(classifyBorderImageLonghand('slice', 'initial')).toEqual({ kind: 'reset' });
    expect(classifyBorderImageLonghand('slice', 'inherit').kind).toBe('unsupported');
    expect(classifyBorderImageLonghand('slice', 'var(--x)').kind).toBe('unsupported');
    expect(classifyBorderImageLonghand('slice', '5')).toEqual({ kind: 'active', value: '5' });
    expect(classifyBorderImageLonghand('width', '10px')).toEqual({ kind: 'active', value: '10px' });
    expect(classifyBorderImageLonghand('outset', '').kind).toBe('invalid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15R — grammar 판정 근본화 + state domain 분리(I1~I6). 외부 검수가 공용 evaluator에서 16/16 불일치를
// 재현하고 대표 벡터를 headless Chrome 계산값과 대조했다 — **브라우저 의미론이 정답 기준**이다.
// 아래 16 mutation은 전부 공용 evaluator(evalBorderScss/evalIndicatorScss)를 경유해 PINNED 본문과
// 동일한 체인(Sass compile → postcss.parse → findRootRules → cascade 합성 → 가시성 판정)을 탄다.
// 각 it 위 주석의 "선재현"은 수정 전 게이트가 낸 값(= false-green/false-red의 실체)이다.
// ─────────────────────────────────────────────────────────────────────────────

const R15_CIB = 'color-input-border';
const R15_V = 'var(--color-input-border)';
const R15_IND = 'color-selected-indicator';
const R15_IV = 'var(--color-selected-indicator)';
const r15b = (scss) => evalBorderScss(scss, R15_CIB).visible;
const r15i = (scss) => evalIndicatorScss(scss, R15_IND).visible;

describe('15R I1 — `all: var(...)`는 폐기가 아니라 deferred(계산시점 유예) → 두 도메인 공통 fail-closed', () => {
  // M1 선재현: true(false-green). `all`이 비 CSS-wide면 무조건 invalid 폐기로 봐서 무동작이었다.
  // Chrome: well-formed var를 포함한 `all`은 폐기되지 않고 cascade에 참여 → 계산시점에 border-style:none.
  // **정의된 토큰**(--color-bg)으로도 재현되므로 "미정의 var 검사"가 대신 잡아줄 수 없다.
  it('M1 RED: border — all: var(--color-bg) 는 deferred로 참여해 perimeter fail-closed', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};all:var(--color-bg)}`)).toBe(false);
  });
  // M2 선재현: true(false-green). Chrome: box-shadow:none.
  it('M2 RED: indicator — all: var(--color-bg) 는 deferred로 참여해 box-shadow fail-closed', () => {
    expect(r15i(`.X{box-shadow:inset 0 0 0 1px ${R15_IV};all:var(--color-bg)}`)).toBe(false);
  });
  it('M2b 단위: classifyAllDecl 삼분 — CSS-wide/deferred/invalid', () => {
    expect(classifyAllDecl('initial')).toEqual({ kind: 'valid', value: 'none' });
    expect(classifyAllDecl('inherit').kind).toBe('unsupported');
    expect(classifyAllDecl('var(--color-bg)').kind).toBe('unsupported'); // deferred
    expect(classifyAllDecl('var(--x garbage)').kind).toBe('invalid'); // well-formed var 아님 → 폐기
    expect(classifyAllDecl('junk').kind).toBe('invalid');
    expect(classifyAllDecl('initial 1px').kind).toBe('invalid'); // 다값 = 불법
  });
});

describe('15R I2 — CSS-wide 키워드는 값 전체가 단독일 때만 인정(다값 longhand 셀 허용 금지)', () => {
  // M3 선재현: true(false-green). `initial`을 첫 셀 medium으로 적용해 width 0을 되살렸다.
  // Chrome: `border-width: initial 1px`는 선언 전체 불법 → 폐기 → width 0 유지 → 비가시.
  it('M3 RED: border-width: initial 1px → 선언 폐기 → 이전 width 0 유지', () => {
    expect(r15b(`.X{border:0 solid ${R15_V};border-width:initial 1px}`)).toBe(false);
  });
  // M4 선재현: false(false-red). `initial`을 첫 셀 none으로 적용해 top면을 없앴다.
  // Chrome: 선언 폐기 → shorthand의 solid 유지 → 가시.
  it('M4 GREEN: border-style: initial solid → 선언 폐기 → 이전 solid 유지 → 가시', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-style:initial solid}`)).toBe(true);
  });
});

describe('15R I3 — box-shadow 삼분 양방향(표준미해석=unsupported / 문법위반=invalid-discard)', () => {
  // M5 선재현: true(false-green). calc 레이어를 invalid 폐기로 봐 **이전 인디케이터가 부활**했다.
  // Chrome: calc는 유효 <length> → 후행 선언이 이겨 색이 #000(토큰 아님) → 인디케이터 소실.
  it('M5 RED: calc 포함 유효 shadow winner는 unsupported로 cascade 참여(이전 선언 부활 금지)', () => {
    expect(r15i(`.X{box-shadow:inset 0 0 0 1px ${R15_IV};box-shadow:inset 0 0 calc(1px + 1vw) 1px #000}`)).toBe(false);
  });
  // M6 선재현: false. `rgb(from red)`(채널 부족)를 valid로 통과시켜 후행 선언이 이긴 것으로 봤다.
  // Chrome: 인자 부족 = 문법 위반 → 선언 폐기 → 이전 토큰 선언 fallback(가시).
  it('M6 GREEN: 인자 부족 색함수 rgb(from red) 는 invalid-discard → 이전 토큰 선언 fallback', () => {
    expect(r15i(`.X{box-shadow:inset 0 0 0 1px ${R15_IV};box-shadow:inset 0 0 0 1px rgb(from red)}`)).toBe(true);
  });
  it('M6b GREEN: border-color: color-mix(in srgb)(피연산자 부족) 도 invalid-discard → 토큰 유지', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-color:color-mix(in srgb)}`)).toBe(true);
  });
});

describe('15R I4 — 값 쪽 CSS 식별자 정규화(prop 쪽과 동일 함수 1회 적용) + 전체 <dashed-ident>', () => {
  // M7 선재현: true(false-green). `tr\61 nsparent`를 미지 ident=폐기로 봐 이전 토큰이 살아남았다.
  // Chrome: escaped ident는 transparent와 동일 → 토큰 소실.
  it('M7 RED: border-color: tr\\61 nsparent → transparent override(토큰 소실)', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-color:tr\\61 nsparent}`)).toBe(false);
  });
  // M8 선재현: true(false-green). Chrome: r\65 d = red → 인디케이터 색이 토큰이 아님.
  it('M8 RED: box-shadow … r\\65 d → red override(토큰 소실)', () => {
    expect(r15i(`.X{box-shadow:inset 0 0 0 1px ${R15_IV};box-shadow:inset 0 0 0 1px r\\65 d}`)).toBe(false);
  });
  // M9 선재현: true(false-green). `--é`를 ASCII 정규식이 거부해 var가 "무효 문법"이 되고,
  // 뒤의 "junk" 잔여와 합쳐져 순수 문법위반=폐기로 흘렀다. Chrome: `--é`는 유효 <dashed-ident>라
  // well-formed var → 선언 전체가 deferred로 참여 → 계산시점 무효 → currentcolor(토큰 소실).
  it('M9 RED: border-color: var(--é) "junk" → 비ASCII dashed-ident도 well-formed var → deferred', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-color:var(--é) "junk"}`)).toBe(false);
  });
});

describe('15R I5 — border-image unsupported의 state domain 분리(5셀 각각 {value,important,unsupported})', () => {
  // M10 선재현: true(false-green). `border-image:inherit`가 **일반 border side 셀**에 poison을 찍어
  // 뒤따르는 border-width/style/color가 그 poison을 지워버렸다.
  it('M10 RED: border-image: inherit 후 일반 border longhand가 image uncertainty를 지우지 못한다', () => {
    expect(r15b(`.X{border-image:inherit;border-width:1px;border-style:solid;border-color:${R15_V}}`)).toBe(false);
  });
  // M11 선재현: false(false-red). poison이 border side 셀에 있어 `border-image:none`이 못 지웠다.
  // Chrome: border-image:none → 도장 없음 → 일반 보더 그대로 가시.
  it('M11 GREEN: border-image: inherit 후 border-image: none 은 image 상태만 리셋해 가시 복구', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-image:inherit;border-image:none}`)).toBe(true);
  });
  // M12 선재현: true(false-green). `all: inherit`도 border side 셀에만 poison을 찍어 후행 longhand가 지웠다.
  // all은 border-image까지 inherit시키므로 image 도메인에도 불확실성이 남아야 한다.
  it('M12 RED: all: inherit 는 image 도메인에도 반영돼 후행 border longhand로 지워지지 않는다', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};all:inherit;border-width:1px;border-style:solid;border-color:${R15_V}}`)).toBe(false);
  });
});

describe('15R I6 — border-image 판정을 함수-존재 휴리스틱에서 선언 전체 grammar 삼분으로 전환', () => {
  // M13 선재현: true(false-green). `border: foo()`를 "unsupported=유효 선언"으로 취급해
  // **border-image를 reset**해버렸다. Chrome: foo()가 border shorthand 문법을 만족한다고 확인할 수
  // 없고, 무효라면 선언 자체가 폐기돼 border-image는 그대로다 → 이미지 도장 유지 → 비가시.
  it('M13 RED: 확인 불가 shorthand(border: foo())는 border-image를 절대 reset하지 않는다', () => {
    // important는 **성분 longhand**에 건다 — `border:… !important` shorthand로 걸면 그 shorthand 자신이
    // border-image까지 !important로 리셋해버려(스펙대로) 후행 border-image가 애초에 적용되지 못한다.
    const scss = `.X{border-width:1px !important;border-style:solid !important;border-color:${R15_V} !important;`
      + 'border-image:url(a.png);border:foo()}';
    expect(r15b(scss)).toBe(false);
  });
  // M14 선재현: true(false-green). `-webkit-image-set(...)`가 함수 화이트리스트에 없어 invalid-discard로
  // 흘러 **활성 이미지를 놓쳤다**. Chrome 지원 함수 → 도장 활성 → 일반 보더 계약 무의미(fail-closed).
  it('M14 RED: -webkit-image-set 도 <image>로 성립 → 활성 도장(놓치면 false-green)', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-image-source:-webkit-image-set("a.png" 1x)}`)).toBe(false);
  });
  // M15 선재현: false(false-red). slice/width/outset/repeat가 "빈 값 외 전부 active"라 junk까지
  // non-initial 활성으로 봤다. Chrome: junk는 slice 문법 위반 → 선언 폐기 → slice 100% 유지 → 가시.
  it('M15 GREEN: border-image-slice: junk 는 문법 위반 → invalid-discard(활성 아님)', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-image-slice:junk}`)).toBe(true);
  });
  // M16 선재현: false(false-red). repeat는 최대 2값인데 3값도 raw active로 받았다.
  // Chrome: 값 개수 초과 = 문법 위반 → 폐기 → repeat stretch 유지 → 가시.
  it('M16 GREEN: border-image-repeat: 3값(최대 2 초과)은 invalid-discard', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-image-repeat:stretch stretch stretch}`)).toBe(true);
  });
});

describe('15R 적대적 자가 재검토 — 구조 단정(휴리스틱 재유입·이중 디코딩·도메인 누수 차단)', () => {
  it('I6 grammar 삼분 단위 — source: 미지 함수=unsupported(fail-closed), 닫히지 않은 함수=invalid, 벤더 접두 이미지 함수=active', () => {
    expect(classifyBorderImageLonghand('source', 'foo()').kind).toBe('unsupported'); // (b) 성립 여지 배제 불가
    expect(classifyBorderImageLonghand('source', '-webkit-image-set("a.png" 1x)').kind).toBe('active');
    expect(classifyBorderImageLonghand('source', 'linear-gradient(red,blue').kind).toBe('invalid'); // (c) 괄호 미종결
    expect(classifyBorderImageLonghand('source', 'calc(1px)').kind).toBe('invalid'); // 수학 함수는 <image>가 아니다
    expect(classifyBorderImageLonghand('source', '"a.png"').kind).toBe('invalid'); // 문자열은 <image>가 아니다
  });
  it('I6 slice/width/outset/repeat 도 grammar 삼분 — 표기만 다른 initial은 reset, 개수 초과·미지 ident는 invalid', () => {
    expect(classifyBorderImageLonghand('slice', '100% 100% 100% 100%').kind).toBe('reset'); // initial 동등
    expect(classifyBorderImageLonghand('width', '1 1').kind).toBe('reset');
    expect(classifyBorderImageLonghand('repeat', 'stretch stretch').kind).toBe('reset');
    expect(classifyBorderImageLonghand('repeat', 'round').kind).toBe('active');
    expect(classifyBorderImageLonghand('repeat', 'junk').kind).toBe('invalid');
    expect(classifyBorderImageLonghand('slice', '1 2 3 4 5').kind).toBe('invalid'); // 4값 초과
    expect(classifyBorderImageLonghand('outset', '1px junk').kind).toBe('invalid');
    expect(classifyBorderImageLonghand('slice', 'calc(1px)').kind).toBe('unsupported'); // 표준이나 미해석
  });
  it('I6 shorthand — 무효/미확정 값은 절대 reset을 유발하지 않는다(부작용 금지 계약)', () => {
    expect(classifyBorderImageShorthand('junk').kind).toBe('invalid');
    expect(classifyBorderImageShorthand('foo()').kind).toBe('unsupported');
    expect(classifyBorderImageShorthand('url(a.png) 1 /').kind).toBe('invalid'); // 빈 구획
    expect(classifyBorderImageShorthand('url(a.png), url(b.png)').kind).toBe('invalid'); // top-level 콤마
    expect(classifyBorderImageShorthand('none stretch').kind).toBe('reset'); // 전부 initial 동등
  });
  it('I3 색함수 인자 개수 계약 — 부족은 invalid, 정상 개수는 계속 valid(회귀 없음)', () => {
    expect(isValidColorFunctionNode(valueParser('rgb(from red)').nodes[0])).toBe(false);
    expect(isValidColorFunctionNode(valueParser('color-mix(in srgb)').nodes[0])).toBe(false);
    expect(isValidColorFunctionNode(valueParser('rgb(1 2)').nodes[0])).toBe(false);
    expect(isValidColorFunctionNode(valueParser('rgb(1 2 3)').nodes[0])).toBe(true);
    expect(isValidColorFunctionNode(valueParser('color(display-p3 1 0 0)').nodes[0])).toBe(true);
    expect(isValidColorFunctionNode(valueParser('oklch(0.7 0.1 200)').nodes[0])).toBe(true);
  });
  it('I3 삼분 단위 — calc 레이어=unsupported, 인자부족 색함수=invalid, 정상=valid', () => {
    expect(classifyBoxShadowValue('inset 0 0 calc(1px + 1vw) 1px #000')).toBe('unsupported');
    expect(classifyBoxShadowValue('inset 0 0 0 1px rgb(from red)')).toBe('invalid');
    expect(classifyBoxShadowValue('inset 0 0 0 1px var(--t)')).toBe('valid');
    expect(classifyBoxShadowValue('none')).toBe('valid');
  });
  it('I4 값 식별자 decode는 정확히 1회 — escaped 백슬래시(\\5c)가 2회 디코딩되지 않는다(음성 대조)', () => {
    // `\5c 61` 은 1회 디코딩하면 리터럴 `\61`(= 백슬래시+"61")이고, 2회 디코딩하면 'a'가 된다.
    // 값 경로가 1회만 적용된다는 증거: 이 ident는 색 키워드로 인정되지 않아야 한다(2회면 'a'가 되지만
    // 그래도 색은 아니므로, 대신 결정적 문자열 단정으로 회차를 고정한다).
    const [word] = parseValue('\\5c 61').nodes;
    expect(identOf(word)).toBe('\\61');
    expect(decodeCssIdentifier(identOf(word))).toBe('a'); // 2회차는 달라진다 = 1회 계약이 유의미
  });
  it('I4 escape 재결합은 멱등 — stringify→재파싱 왕복에도 ident 1개가 유지된다', () => {
    const once = splitTopLevelSpaceGroups('tr\\61 nsparent');
    expect(once).toEqual(['tr\\61 nsparent']);
    expect(splitTopLevelSpaceGroups(once[0])).toEqual(['tr\\61 nsparent']);
    expect(identOf(parseValue(once[0]).nodes[0])).toBe('transparent');
  });
  it('I4 escaped backslash는 결합 대상이 아니다(오결합 방지)', () => {
    expect(splitTopLevelSpaceGroups('a\\\\61 b')).toEqual(['a\\\\61', 'b']);
  });
  it('I4 <dashed-ident> — 비ASCII/언더스코어 인정, 공백·비명칭문자는 계속 거부', () => {
    expect(topLevelVarTokens('var(--é)')).toEqual(new Set(['é']));
    expect(topLevelVarTokens('var(--_x)')).toEqual(new Set(['_x']));
    expect(topLevelVarTokens('var(--\\65 x)')).toEqual(new Set(['ex'])); // escape 해석 후 이름
    expect(topLevelVarTokens('var(--x garbage)').size).toBe(0); // I2a 계약 유지
  });
  it('I5 도메인 분리 — image 활성 상태는 후행 일반 border longhand로 지워지지 않는다(역방향)', () => {
    const scss = `.X{border-image-source:linear-gradient(red,blue);border-width:1px;border-style:solid;border-color:${R15_V}}`;
    expect(r15b(scss)).toBe(false);
  });
  it('I5 도메인 분리 — 반대로 border shorthand(유효)는 스펙대로 image를 리셋한다(무회귀)', () => {
    expect(r15b(`.X{border-image:inherit;border:1px solid ${R15_V}}`)).toBe(true);
  });
  // 명시 예외(과대 종결 금지) — 아래 두 계약은 브라우저 의미론보다 **의도적으로 보수적**이다.
  it('명시 예외 A: source가 none이어도 non-initial slice면 fail-closed RED(브라우저는 도장 안 함 — 의도적 과잉 안전)', () => {
    expect(r15b(`.X{border:1px solid ${R15_V};border-image-slice:5}`)).toBe(false);
  });
  it('명시 예외 B: 단위만 다른 0(`outset:0px` vs initial `0`)은 initial 동등으로 접지 않는다(fail-closed)', () => {
    expect(classifyBorderImageLonghand('outset', '0px').kind).toBe('active');
    expect(r15b(`.X{border:1px solid ${R15_V};border-image-outset:0px}`)).toBe(false);
  });
});
