import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(resolve(FRONTEND, rel), 'utf8');

// S6 계획 「플로우/그래프 색 결정 13종 형태」(§2.3) — @xyflow/react 소비 7파일 + 같은 색 결정 경로를 가진 3파일
// ⚠️ 이 목록 == 스캔 대상이지 == 수정 대상이 아니다.
//    S6이 실제로 고치는 것은 FlowCanvas / TrackFlowCanvas / TrackEdge / ProgressRing 4개뿐.
//    EpicFlow.js는 리터럴 1건이 stored-color 폴백이라 offender 0 → 수정하지 않는다(§3 참조).
//    DeletableEdge / TaskNode / CrossBranchTaskNode / RestrictedNode / TrackTimeline도 수정 0이 정상.
const FLOW_FILES = [
  'components/Branch/Flow/FlowCanvas.js',
  'components/Branch/Flow/DeletableEdge.js',
  'components/Branch/Flow/TaskNode.js',
  'components/Branch/Flow/EpicFlow.js',
  'components/Track/Flow/TrackFlowCanvas.js',
  'components/Track/Flow/TrackEdge.js',
  'components/Track/Flow/CrossBranchTaskNode.js',
  'components/Track/Flow/RestrictedNode.js',
  'components/Track/Timeline/TrackTimeline.js',
  'components/Home/shared/ProgressRing.js',
];

// S7이 가져갈 stored-color 폴백.
// ⚠️ anchor 하나가 소비하는 것은 **그 줄 전체가 아니라 value 하나**다.
//    줄 단위로 skip하면 `stroke: ws.color || '#9CA3AF', fill: '#FAFAF7'`처럼
//    같은 줄에 섞인 다른 리터럴이 조용히 통과한다.
// anchor+value 쌍이 파일에서 사라지면 dead-allowlist 테스트가 RED가 된다.
const STORED_COLOR_FALLBACKS = [
  { file: 'components/Branch/Flow/FlowCanvas.js',       anchor: "ws?.color || '#9CA3AF'",                 value: '#9CA3AF' },
  { file: 'components/Branch/Flow/EpicFlow.js',         anchor: "epic.color || '#5E6AD2'",                value: '#5E6AD2' },
  { file: 'components/Track/Flow/TrackFlowCanvas.js',   anchor: "statusColor: ws.color || '#9CA3AF'",     value: '#9CA3AF' },
  { file: 'components/Track/Flow/TrackFlowCanvas.js',   anchor: "branchColor: branch.color || '#9CA3AF'", value: '#9CA3AF' },
  { file: 'components/Track/Timeline/TrackTimeline.js', anchor: "color: '#9CA3AF', key: '?'",             value: '#9CA3AF' },
  { file: 'components/Track/Timeline/TrackTimeline.js', anchor: "ws.color || '#9CA3AF'",                  value: '#9CA3AF' },
  { file: 'components/Home/shared/ProgressRing.js',     anchor: "color = '#5E6AD2'",                      value: '#5E6AD2' },
];

// <<S6-SWEEP-LOGIC-START>>
// ⚠️ 이 블록은 순수 로직만 담는다(import·expect·fs 참조 금지).
//    scratchpad의 mutation 하네스가 이 블록을 **그대로 떼어** 합성 회귀에 돌린다.
//    블록 밖 헬퍼를 부르면 하네스가 깨지므로 자급자족 상태를 유지할 것.

// 형태 #1 — 16진/rgb()/hsl() 리터럴.
const LITERAL_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?)\(\s*[0-9.]/g;

// 형태 #1의 재진입 경로 — `stroke="white"`처럼 리터럴이되 grep(#/rgb)에 안 걸리는 named color.
// CSS Color 4의 named color 148종(닫힌 데이터 배열이다. 파서가 아니다).
const CSS_NAMED_COLORS = new Set([
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

// 테마를 타는 키워드는 색 리터럴이 아니다.
const NAMED_COLOR_ALLOW = new Set(['none', 'currentcolor', 'transparent', 'inherit']);

// **색 값 위치**에서만 본다 — 주석·자유 텍스트·색 아닌 문자열은 스캔 대상이 아니다.
// 값 하나만 보면 `stroke: sel ? "white" : base`(삼항)·`fill={c ? "black" : x}`(JSX 식)가
// 통째로 새므로, **키 뒤 표현식 전체**에서 따옴표 토큰을 훑는다.
// 앞자리 lookbehind로 statusColor·bgcolor·--color 같은 접미 일치를 막고,
// `=(?!>)`로 화살표 함수(`color => …`)를 뺀다.
const COLOR_KEY_RE = new RegExp(
  '(?<![A-Za-z0-9_$-])'
  + '(lightingColor|backgroundColor|floodColor|trackColor|background|stopColor|textColor|stroke|color|fill)'
  + '\\s*(?:=(?!>)|:)',
  'g'
);

// 색 식별자 선언(`const baseStroke = …`, `let ringColor = …`)은 RHS 전체가 색 값 위치다.
const COLOR_DECL_RE = /(?:^|[^A-Za-z0-9_$.])(?:const|let|var)\s+([A-Za-z0-9_$]*(?:Color|Stroke))\s*=(?!=)/;

// 표현식 조각 안의 따옴표 토큰(문자열 리터럴). 백틱 템플릿은 값이 아니므로 제외.
const QUOTED_RE = /"([^"\n]*)"|'([^'\n]*)'/g;

// 주석은 색 값 위치가 아니다 — `//`~EOL과 `/* … */`(JSX `{/* … */}` 포함)를 공백으로 덮는다.
// 따옴표 안을 따라가므로 `"https://x"`의 `://`를 주석 시작으로 오인하지 않는다(`:` 직후도 제외).
// 블록 주석 상태(st.block)는 줄을 넘어 이어진다. 파서가 아니라 문자 훑기다.
function maskComments(line, st) {
  let out = '';
  let q = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (st.block) {
      if (c === '*' && line[i + 1] === '/') { st.block = false; out += '  '; i += 1; } else out += ' ';
    } else if (q) {
      out += c;
      if (c === '\\') { out += line[i + 1] || ''; i += 1; } else if (c === q) q = null;
    } else if (c === '"' || c === "'" || c === '`') { q = c; out += c; }
    else if (c === '/' && line[i + 1] === '/' && line[i - 1] !== ':') return out + ' '.repeat(line.length - i);
    else if (c === '/' && line[i + 1] === '*') { st.block = true; out += '  '; i += 1; }
    else out += c;
  }
  return out;
}

// hit 단위 소비. 한 줄에서 anchor가 걸리면 그 anchor의 value **하나만** 예산에서 깎고,
// 나머지 리터럴은 전부 offender로 남는다. 같은 값이 두 번 나오면 anchor도 두 개 필요하다.
function offendersInSource(rel, text, allowed) {
  const out = [];
  const st = { block: false };
  let pending = 0;     // 색 식별자 선언 RHS가 다음 줄로 이어지는 잔여 줄수(`;`까지, 최대 4줄)
  let pendingName = '';
  text.split('\n').forEach((line, i) => {
    const budget = allowed.filter((e) => line.includes(e.anchor)).map((e) => e.value.toLowerCase());
    for (const h of line.match(LITERAL_RE) || []) {
      const k = budget.indexOf(h.toLowerCase());
      if (k >= 0) { budget.splice(k, 1); continue; }  // stored-color 폴백 1건 소비 — S7 소유
      out.push(`${rel}:${i + 1}: ${h}`);
    }

    // named color는 **주석을 덮은 줄**에서, [라벨, 표현식 조각] 단위로만 훑는다.
    const masked = maskComments(line, st);
    const frags = [];
    const d = COLOR_DECL_RE.exec(masked);
    if (d) {
      const rhs = masked.slice(d.index + d[0].length);
      frags.push([d[1], rhs]);
      pendingName = d[1];
      pending = rhs.includes(';') ? 0 : 4;
    } else if (pending > 0) {
      frags.push([pendingName, masked]);
      pending = masked.includes(';') ? 0 : pending - 1;
    }
    COLOR_KEY_RE.lastIndex = 0;
    let m;
    while ((m = COLOR_KEY_RE.exec(masked)) !== null) frags.push([m[1], masked.slice(m.index + m[0].length)]);

    const seen = new Set();
    for (const [label, frag] of frags) {
      QUOTED_RE.lastIndex = 0;
      let s;
      while ((s = QUOTED_RE.exec(frag)) !== null) {
        const raw = (s[1] !== undefined ? s[1] : s[2]).trim();
        const v = raw.toLowerCase();
        if (NAMED_COLOR_ALLOW.has(v) || !CSS_NAMED_COLORS.has(v)) continue;
        const msg = `${rel}:${i + 1}: ${label}="${raw}" (CSS named color)`;
        if (!seen.has(msg)) { seen.add(msg); out.push(msg); }
      }
    }
  });
  return out;
}

// `<ReactFlow …>` 여는 태그 하나를 통째로 뜬다. props 안의 `=>`·`>`에 안 속게
// 중괄호 깊이를 세고 depth 0의 `>`에서만 끊는다. `<ReactFlowProvider`는 제외.
function reactFlowOpeningTag(s) {
  const m = /<ReactFlow(?![A-Za-z0-9_])/.exec(s);
  if (!m) return null;
  let depth = 0;
  for (let j = m.index + m[0].length; j < s.length; j++) {
    const ch = s[j];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return s.slice(m.index, j + 1);
  }
  return null;
}

// `name={ … }` JSX prop의 중괄호 안 표현식 텍스트들.
function jsxBraceProps(s, name) {
  const re = new RegExp(`(?<![A-Za-z0-9_$])${name}\\s*=\\s*\\{`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let j = open; j < s.length; j++) {
      if (s[j] === '{') depth += 1;
      else if (s[j] === '}') {
        depth -= 1;
        if (depth === 0) { out.push(s.slice(open + 1, j)); break; }
      }
    }
  }
  return out;
}

// <marker id="…"> … <path fill="…"> … </marker> 정의를 {id: fill}로.
function markerDefs(s) {
  const out = {};
  for (const m of s.match(/<marker[\s\S]*?<\/marker>/g) || []) {
    const id = (m.match(/\bid="([^"]*)"/) || [])[1];
    const fill = (m.match(/<path[^>]*?\sfill="([^"]*)"/) || [])[1];
    out[id === undefined ? '(no id)' : id] = fill === undefined ? '(no path fill)' : fill;
  }
  return out;
}

// <<S6-SWEEP-LOGIC-END>>

const offendersIn = (rel) =>
  offendersInSource(rel, src(rel), STORED_COLOR_FALLBACKS.filter((e) => e.file === rel));

describe('플로우 색 결정 경로 — 리터럴 잔존 금지 (S6 계획 「플로우/그래프 색 결정 13종 형태」)', () => {
  it('stored-color 폴백을 뺀 나머지 리터럴이 0이다 (16진/rgb/hsl + 색 위치의 named color)', () => {
    const offenders = FLOW_FILES.flatMap(offendersIn);
    expect(offenders).toEqual([]);
  });

  it('stored-color allowlist에 죽은 항목이 없다', () => {
    // anchor와 value가 **같은 줄에** 있어야 살아 있는 항목이다.
    // anchor만 남고 값이 토큰으로 바뀐 경우도 죽은 항목으로 잡는다.
    const dead = STORED_COLOR_FALLBACKS.filter((e) =>
      !src(e.file).split('\n').some((t) => t.includes(e.anchor) && t.includes(e.value)));
    expect(dead).toEqual([]);
  });
});

describe('플로우 색 결정 경로 — grep에 안 잡히는 형태 (S6 계획 「플로우/그래프 색 결정 13종 형태」 #2 #4 #11)', () => {
  it('markerEnd는 color를 명시한다 — 라이브러리 기본 #b1b1b7 누출 차단', () => {
    const s = src('components/Branch/Flow/FlowCanvas.js');
    const decls = s.match(/markerEnd:\s*\{[^}]*\}/g) || [];
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) expect(d).toMatch(/color:\s*'var\(--/);
  });

  it('<Background>는 color를 CSS 변수로 넘긴다', () => {
    for (const f of ['components/Branch/Flow/FlowCanvas.js', 'components/Track/Flow/TrackFlowCanvas.js']) {
      const tags = src(f).match(/<Background[\s\S]*?\/>/g) || [];
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) expect(t).toMatch(/color="var\(--/);
    }
  });

  it('두 캔버스의 colorMode가 useTheme().resolved에 실제로 묶여 있다', () => {
    // `colorMode={` 존재만 보면 `colorMode={'light'}` 하드코딩도 통과한다.
    // import → 구조분해 → 실제 <ReactFlow> 태그 안의 값, 세 지점을 다 본다.
    for (const f of ['components/Branch/Flow/FlowCanvas.js', 'components/Track/Flow/TrackFlowCanvas.js']) {
      const s = src(f);
      expect(s, `${f}: useTheme import`).toMatch(/^import\s*\{[^}]*\buseTheme\b[^}]*\}\s*from\s*'@\/library\/theme';/m);
      expect(s, `${f}: const { resolved } = useTheme()`).toMatch(/\bconst\s*\{[^}]*\bresolved\b[^}]*\}\s*=\s*useTheme\(\s*\)/);
      const tag = reactFlowOpeningTag(s);
      expect(tag, `${f}: <ReactFlow> 여는 태그`).toBeTruthy();
      expect(tag, `${f}: <ReactFlow>의 colorMode`).toContain('colorMode={resolved}');
    }
  });

  it('marker 2종이 토큰으로 정의되고 TrackEdge가 둘 다 실제로 소비한다', () => {
    const s = src('components/Track/Flow/TrackFlowCanvas.js');
    expect(s).not.toMatch(/<marker[\s\S]*?currentColor[\s\S]*?<\/marker>/);
    // track-arrow(draft/relates) + track-arrow-mat(materialized)
    expect(markerDefs(s)).toEqual({
      'track-arrow': 'var(--color-text-tertiary)',
      'track-arrow-mat': 'var(--color-primary)',
    });

    // 소비 — marker를 2개 정의해놓고 1개만 쓰는 구멍을 닫는다.
    // TrackEdge의 markerEnd 표현식을 그대로 떼어 세 분기를 평가한다.
    // (new Function의 입력은 레포 안 소스 파일이다. 테스트 전용이고 번들에 안 들어간다.)
    const exprs = jsxBraceProps(src('components/Track/Flow/TrackEdge.js'), 'markerEnd');
    expect(exprs.length, 'TrackEdge의 markerEnd prop 개수').toBe(1);
    // eslint-disable-next-line no-new-func
    const markerEndFor = new Function('isRelates', 'isMaterialized', `return (${exprs[0]});`);
    expect(markerEndFor(true, true), 'relates(materialized)').toBeUndefined();
    expect(markerEndFor(true, false), 'relates').toBeUndefined();
    expect(markerEndFor(false, true), 'materialized').toBe('url(#track-arrow-mat)');
    expect(markerEndFor(false, false), 'draft').toBe('url(#track-arrow)');

    const consumed = [markerEndFor(false, true), markerEndFor(false, false)]
      .map((u) => u.slice('url(#'.length, -1)).sort();
    expect(consumed, '정의된 marker가 전부 소비된다').toEqual(Object.keys(markerDefs(s)).sort());
  });
});
