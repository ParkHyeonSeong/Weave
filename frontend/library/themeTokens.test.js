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

// CSS <length> word 판정 — 부호 옵션 + 정수/소수 + 옵션 단위(단위 없는 `0`도 유효 length). box-shadow의
// offset-x/y·blur·spread, border의 width 판별에 공용으로 쓴다. `inset`·`solid` 같은 키워드나
// var(...)(word가 아니라 function 노드라 애초에 words 목록에 안 잡힘)는 매치되지 않는다.
const LENGTH_WORD_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|pc|in|cm|mm|q)?$/i;
function isLengthWord(word) {
  return LENGTH_WORD_RE.test(word);
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
function assertVisibleInsetShadowLayer(layerValue) {
  const words = wordsOf(layerValue);
  const hasInset = words.some((w) => w.toLowerCase() === 'inset');
  const lengths = words.filter(isLengthWord);
  const spread = lengths[3];
  const spreadPositive = spread != null && parseFloat(spread) > 0;
  return { hasInset, lengthCount: lengths.length, spread, visible: hasInset && lengths.length >= 4 && spreadPositive };
}

// 대칭 구멍 A(컨트롤러 발견, 승격핀 6곳) — border 가시성도 동일하게 미보장이었다: `border: 1px
// var(--x)`(style 생략 → UA는 style 없으면 보더 자체를 렌더 안 함 → none 취급), `border: 0 solid
// var(--x)`(width 0 → 선이 안 보임), `border: 1px none var(--x)`(style이 명시적으로 비가시 키워드) 전부
// 이전엔 outermostVarTokens 토큰 사용 여부만 봐서 GREEN이었다. 기대 토큰을 실제로 쓰는 최종 선언
// 값(들)에 대해 구조를 직접 단정한다: style 키워드가 가시 집합에 존재(생략·none/hidden은 FAIL) +
// width가 명시됐다면(length word 존재) 0보다 커야 함(미명시=UA 기본 medium은 가시로 허용).
const VISIBLE_BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);
const INVISIBLE_BORDER_STYLE_KEYWORDS = new Set(['none', 'hidden']);
function assertVisibleBorder(values) {
  const words = values.flatMap(wordsOf);
  const styleWord = words.find((w) => {
    const lw = w.toLowerCase();
    return VISIBLE_BORDER_STYLES.has(lw) || INVISIBLE_BORDER_STYLE_KEYWORDS.has(lw);
  });
  const hasVisibleStyle = styleWord != null && VISIBLE_BORDER_STYLES.has(styleWord.toLowerCase());
  const lengths = words.filter(isLengthWord);
  const width = lengths[0];
  const widthOk = width == null || parseFloat(width) > 0; // 미명시=medium 허용, 명시됐으면 >0 필수
  return { hasVisibleStyle, styleWord, width, visible: hasVisibleStyle && widthOk };
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
  // 아래 it.each 본문에서 assertVisibleInsetShadowLayer/assertVisibleBorder로 구조를 직접 단정해 막는다.
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
    const final = effectiveValue(rules, props); // 매치 규칙 전부에 cascade(!important·후행승리) 적용한 최종값
    const finalValues = Object.values(final).map((v) => v.value);
    const [expectedToken] = outermostVarTokens(needle); // needle 자체도 동일 파서로 토큰화(정합성 보장)

    if (props === INDICATOR_PROPS) {
      // box-shadow는 콤마 레이어를 가질 수 있다(HomeTabs 다중 그림자) — 기대 토큰을 outermost var로
      // 쓰는 레이어를 찾아 그 레이어 하나만 구조 검사한다(Important 2).
      const layer = finalValues.flatMap(splitTopLevelLayers).find((l) => outermostVarTokens(l).has(expectedToken));
      expect(layer, `${selector}의 최종 box-shadow에서 outermost var 토큰 "${expectedToken}"을 쓰는 레이어 미발견 (finalValues=${JSON.stringify(finalValues)})`).toBeDefined();
      const shape = assertVisibleInsetShadowLayer(layer);
      expect(shape.visible, `${selector} indicator 레이어가 구조적으로 비가시 — inset=${shape.hasInset}, length개수=${shape.lengthCount}, spread=${shape.spread} (layer="${layer}")`).toBe(true);
      return;
    }

    // 대칭 구멍 A: border 계열 — 기대 토큰을 쓰는 최종 선언 값(들)에 대해서만 구조 검사.
    const tokenValues = finalValues.filter((v) => outermostVarTokens(v).has(expectedToken));
    expect(tokenValues.length, `${selector}의 최종 유효 [${[...props].join('/')}] 선언에서 outermost var 토큰 "${expectedToken}" 미발견 (finalValues=${JSON.stringify(finalValues)})`).toBeGreaterThan(0);
    const shape = assertVisibleBorder(tokenValues);
    expect(shape.visible, `${selector} border가 구조적으로 비가시 — style="${shape.styleWord}", width="${shape.width}" (values=${JSON.stringify(tokenValues)})`).toBe(true);
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

// styles/ 아래 임의 파일(.scss는 컴파일, .css는 그대로 읽기)을 컴파일된/원본 CSS 텍스트로 반환한다.
// scssCompileCache를 그대로 재사용해(relPath 키 공간이 겹치지 않으므로 안전) 핀 5파일과 캐시를
// 공유한다 — Important 1 수정 지시("컴파일 결과는 모듈 스코프 캐시(핀 5파일과 공유)로 1회만").
function siteCssText(relPath) {
  if (relPath.endsWith('.css')) {
    if (!scssCompileCache.has(relPath)) {
      scssCompileCache.set(relPath, readFileSync(resolve(__dirname, '../styles', relPath), 'utf8'));
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

describe('styles/ 전체 컴파일/AST 스윕 — 비핀 파일 보호 토큰 선언 금지 (P4, 컴파일 기반)', () => {
  const stylesDir = resolve(__dirname, '../styles');
  const targetFiles = readdirSync(stylesDir, { recursive: true })
    .map(String)
    .filter((f) => (f.endsWith('.scss') && !f.endsWith('_themes.scss')) || f.endsWith('.css'));

  it('스윕 대상 파일이 90개를 넘는다(범위 축소 감지 — .scss 92 + .css 1 실측 기준)', () => {
    expect(targetFiles.length).toBeGreaterThan(90);
  });

  it('.scss 전부(컴파일 후 AST)+.css 전부(직접 파싱)가 --color-/--track-/--shadow- 를 선언하지 않는다', () => {
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
function hasProtectedPrefix(prop) {
  return PROTECTED_TOKEN_PREFIXES.some((p) => prop.startsWith(p));
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
  });

  describe('assertVisibleBorder — 대칭 구멍 A(승격핀 border 가시성) 구조 단정, 10라운드', () => {
    it('정상 형태(1px solid var(--x))는 visible', () => {
      expect(assertVisibleBorder(['1px solid var(--x)']).visible).toBe(true);
    });
    it('style 키워드 생략(1px var(--x))은 FAIL', () => {
      const shape = assertVisibleBorder(['1px var(--x)']);
      expect(shape.hasVisibleStyle).toBe(false);
      expect(shape.visible).toBe(false);
    });
    it('style이 명시적 none(1px none var(--x))은 FAIL', () => {
      const shape = assertVisibleBorder(['1px none var(--x)']);
      expect(shape.styleWord).toBe('none');
      expect(shape.visible).toBe(false);
    });
    it('width 0(0 solid var(--x))은 FAIL', () => {
      const shape = assertVisibleBorder(['0 solid var(--x)']);
      expect(shape.width).toBe('0');
      expect(shape.visible).toBe(false);
    });
    it('width 미명시(solid var(--x))는 UA 기본 medium으로 간주해 visible 허용', () => {
      expect(assertVisibleBorder(['solid var(--x)']).visible).toBe(true);
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
