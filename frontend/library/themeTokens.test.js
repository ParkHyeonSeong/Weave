import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'sass';

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

// 컴파일된 CSS에서 flat 규칙(selector { decls })을 순회 추출.
// 대상 5파일 중 4개(taskList·myTasks·home-shared·browseBranches)는 mobile 믹스인 경유로
// @media 블록을 실제로 방출한다(canvasEditor만 무사용) — 단 아래 8핀 셀렉터는 전부 @media
// 밖 최상위 규칙이라 이 flat 정규식으로 충분하다. 한계의 실패 방향은 안전: 핀이 @media
// 안으로 이동하면 규칙을 못 찾아 테스트가 RED로 알려준다(조용한 통과 아님).
function extractRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

// 규칙 prelude(콤마 그룹·조상 결합자 포함)가 핀 셀렉터를 "소유"하는지 판정.
// 순수 문자열 포함(includes)은 쓰지 않는다 — `.CanvasEditor`가 `.CanvasEditorToolbar__ColorSwatch`나
// `.CanvasEditor__Content`까지 접두 매칭돼 버려 남의 규칙 선언까지 끌어와 격리가 깨진다(강등 시뮬레이션
// (a)에서 재현: 다른 규칙의 미변경 선언이 섞여 들어와 커밋 대상 선언을 주석 처리해도 GREEN으로 남는다).
// 콤마로 나눈 각 파트의 "마지막 콤파운드 토큰"이 핀 셀렉터와 정확히 같거나, 그 핀 셀렉터로 시작하는
// 의사클래스 연속(`SELECTOR:hover` 등)일 때만 소유로 인정한다 — BEM 접두사·형제 클래스는 배제된다.
function ownsSelector(prelude, pinSelector) {
  return prelude.split(',').some((part) => {
    const tokens = part.trim().split(/[\s>+~]+/).filter(Boolean);
    const last = tokens[tokens.length - 1] || '';
    return last === pinSelector || last.startsWith(`${pinSelector}:`);
  });
}

// 핀 셀렉터를 소유하는 모든 규칙의 선언부를 합쳐 반환. 하나도 못 찾으면 null —
// "선언 불일치"와 "셀렉터 자체가 사라짐(리팩터링)"을 구분해 후자를 더 명확한 실패로 드러낸다.
function ownDeclarations(css, pinSelector) {
  const bodies = extractRules(css).filter((r) => ownsSelector(r.selector, pinSelector)).map((r) => r.body);
  return bodies.length ? bodies.join('\n') : null;
}

const scssCompileCache = new Map();
function compiledSiteCss(relPath) {
  if (!scssCompileCache.has(relPath)) {
    scssCompileCache.set(relPath, compile(resolve(__dirname, '../styles', relPath)).css);
  }
  return scssCompileCache.get(relPath);
}

describe('컨트롤 보더/인디케이터 재분류 고정 — 컴파일 CSS 선언 기반 (외부 검수 회귀 방지)', () => {
  // 가변 fill 등으로 보더가 유일한 형상 단서인 컨트롤들 — 전수 재감사(2026-07-15)에서 승격 확정.
  // 대표: canvasEditor ColorSwatch(검정 프리셋이 다크 bg 대비 1.1:1이라 보더 없으면 소실).
  // 컴파일 결과는 주석 제거·중첩 평탄화·Sass `_`≡`-` 별칭 정규화가 끝난 텍스트라 원문 정규식의
  // 잔여 허점(주석 처리된 선언 통과·미사용 속성 통과·`_hover` 별칭 경계 통과)이 구조적으로 소멸한다.
  // declPattern은 값의 닫는 `)`까지 정확히 요구 — `--color-input-border-hover` 같은 별칭 컴파일
  // 결과를 원천 차단한다(중간에 다른 문자가 오면 매치 실패).
  const INPUT_BORDER_DECL = /(?:border[^:;{]*|box-shadow):[^;{]*var\(--color-input-border\)/;
  const SELECTED_INDICATOR_DECL = /box-shadow:[^;{]*var\(--color-selected-indicator\)/;
  const PINNED = [
    { label: 'canvasEditor .CanvasEditor', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditor', re: INPUT_BORDER_DECL },
    { label: 'canvasEditor ColorSwatch(Toolbar)', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditorToolbar__ColorSwatch', re: INPUT_BORDER_DECL },
    { label: 'taskList FilterBuilder OpToggle', file: 'components/branch/taskList.scss', selector: '.FilterBuilder__OpToggle', re: INPUT_BORDER_DECL },
    { label: 'myTasks ScopeToggle', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeToggle', re: INPUT_BORDER_DECL },
    { label: 'home-shared HomeTabs', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs', re: INPUT_BORDER_DECL },
    { label: 'browseBranches JoinBtn--joined', file: 'components/browse/browseBranches.scss', selector: '.BrowseBranches__JoinBtn--joined', re: INPUT_BORDER_DECL },
    // 선택 상태 인디케이터(수정 1, SC 1.4.11) — active 셀렉터가 토큰을 실제로 소비하는지만 여기서 고정.
    // 다크 값 자체의 시맨틱(투명 회귀 방지)은 아래 별도 describe에서 대비비로 고정한다.
    { label: 'home-shared HomeTabs__Tab.is-on', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs__Tab.is-on', re: SELECTED_INDICATOR_DECL },
    { label: 'myTasks ScopeBtn--active', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeBtn--active', re: SELECTED_INDICATOR_DECL },
  ];
  it.each(PINNED)('$label 가 컴파일된 규칙에서 기대 선언을 사용', ({ file, selector, re }) => {
    const decls = ownDeclarations(compiledSiteCss(file), selector);
    expect(decls, `${selector} 규칙을 컴파일된 ${file}에서 찾지 못함`).not.toBeNull();
    expect(decls).toMatch(re);
  });
});

// WCAG 2.x 상대휘도/대비비 — hex 6자리만 지원. transparent 등 6자리 hex가 아닌 값은 파싱 실패로
// null → contrastRatio가 0을 반환해 아래 >=3 단정이 RED가 된다(다크 인디케이터 투명 회귀 검출).
function hexToRgb(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 0;
  const [lo, hi] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}

describe('다크 selected-indicator 값 시맨틱 고정 (SC 1.4.11 비텍스트 대비 3:1)', () => {
  const darkBody = css.match(/html\[data-theme=(?:dark|["']dark["'])\]\s*\{([^}]*)\}/)[1];
  const darkValues = Object.fromEntries(
    [...darkBody.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
  it('bg·surface 대비 3:1 이상 — transparent 등으로 되돌리면 파싱 실패로 RED', () => {
    const indicator = darkValues['color-selected-indicator'];
    expect(contrastRatio(indicator, darkValues['color-bg']), `vs bg: ${indicator}`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(indicator, darkValues['color-surface']), `vs surface: ${indicator}`).toBeGreaterThanOrEqual(3);
  });
});
