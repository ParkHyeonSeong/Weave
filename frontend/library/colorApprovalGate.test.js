// theme-dependent 승인 원장(s6-theme-dep-approval.tsv)의 판정 규칙 1벌.
// §13-3-b의 awk 블록과 같은 규칙이고, 그 블록은 리뷰 당일 1회용인 반면 이 파일은 tracked다.
// 오라클은 literalColorSweep.hitsFor 하나뿐이다 — DECL을 여기서 따로 만들지 않는다.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hitsFor } from './literalColorSweep.js';
import { COLOR_CLASSIFIED } from './colorClassified.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TAB = String.fromCharCode(9);
const COLS = ['file', 'selector', 'prop', 'value', 'dark_selector', 'dark_prop', 'dark_value', 'approver'];
const HEADER = COLS.join(TAB);
const DIRS = ['canvas', 'messenger', 'shared', 'admin', 'myTasks', 'profile', 'track'];

const key = (h) => [h.file, h.selector ?? '-', h.prop ?? '-', h.value].join(TAB);

// --- awk 블록과 같은 규칙 1벌 -------------------------------------------------
const nrm = (s) => String(s).replace(/[ \t]+/g, ' ').replace(/^ /, '').replace(/ $/, '');
const nsel = (s) => nrm(s).replace(/^html\[data-theme=dark\][ \t\n\r\f\v]+/, '');

function calbad(d) {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const dd = Number(d.slice(8, 10));
  if (!(m >= 1 && m <= 12) || !(dd >= 1)) return true;
  let lim = 31;
  if (m === 4 || m === 6 || m === 9 || m === 11) lim = 30;
  if (m === 2) lim = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return dd > lim;
}

/**
 * @param ledger  원장 TSV 전문
 * @param decl    커밋된 SCSS에서 hitsFor로 재생성한 `file\tselector\tprop\tvalue` 집합
 * @param classified  COLOR_CLASSIFIED의 같은 형식 튜플 집합
 * awk와 같은 판정 순서 — 앞선 규칙이 발화하면 그 행은 거기서 끝난다(next).
 */
function auditLedger(ledger, decl, classified) {
  const violations = [];
  const seen = new Set();
  const approved = new Set();
  const lines = ledger.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  lines.forEach((line, i) => {
    if (i === 0) {
      if (line !== HEADER) violations.push(`BAD_HEADER | ${line}`);
      return;
    }
    const f = line.split(TAB);
    const nf = line === '' ? 0 : f.length;
    if (nf !== 8) return void violations.push(`COLUMNS(${nf}) | ${line}`);
    const [file, sel, prop, val, dsel, dprop, dval, approver] = f;
    const tup = [file, sel, prop, val].join(TAB);
    const at = `${file} | ${sel} | ${prop} | ${val}`;
    if (seen.has(tup)) return void violations.push(`DUPLICATE_TUPLE | ${at}`);
    seen.add(tup);
    if (dsel === '' || dprop === '' || dval === '') return void violations.push(`NO_DARK_EVIDENCE | ${at}`);
    if (approver === '') return void violations.push(`NO_APPROVER | ${at}`);
    if (!/^[^ \t][^\t]* [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/.test(approver))
      return void violations.push(`BAD_APPROVER | ${file} | ${sel} | approver=[${approver}]`);
    if (calbad(approver.slice(-10)))
      return void violations.push(`BAD_APPROVER_DATE | ${file} | ${sel} | approver=[${approver}]`);
    if (!decl.has([file, dsel, dprop, dval].join(TAB)))
      return void violations.push(`EVIDENCE_NOT_A_DECL | ${file} | ${dsel} | ${dprop} | ${dval}`);
    if (nsel(dsel) !== nsel(sel))
      return void violations.push(`EVIDENCE_SELECTOR_MISMATCH | ${sel} != ${dsel}`);
    if (nsel(dsel) === nrm(dsel)) return void violations.push(`EVIDENCE_NOT_DARK | ${file} | ${dsel}`);
    approved.add(tup);
  });

  // awk가 RED면 comm 단계에 가지 않는다 — 같은 단락을 여기서도 지킨다.
  if (violations.length) return { violations, missing: [], extra: [] };
  const missing = [...classified].filter((k) => !approved.has(k)).sort();
  const extra = [...approved].filter((k) => !classified.has(k)).sort();
  return { violations, missing, extra };
}

const labels = (r) => r.violations.map((v) => v.split(' | ')[0]);

// --- 커밋된 정본 위에서 --------------------------------------------------------
function repoDecl() {
  const out = new Set();
  for (const d of DIRS) {
    const dir = `styles/components/${d}`;
    for (const f of readdirSync(`${ROOT}${dir}`).filter((x) => x.endsWith('.scss'))) {
      const rel = `${dir}/${f}`;
      for (const h of hitsFor(rel, readFileSync(`${ROOT}${rel}`, 'utf8'))) out.add(key(h));
    }
  }
  return out;
}

describe('승인 원장 — 커밋된 정본 위에서 GREEN', () => {
  const ledger = readFileSync(`${ROOT}library/s6-theme-dep-approval.tsv`, 'utf8');
  const classified = new Set(COLOR_CLASSIFIED.map(key));
  const res = auditLedger(ledger, repoDecl(), classified);

  it('원장 위반 0 — 헤더·8열·중복·근거·승인자 전부 통과', () => {
    expect(res.violations).toEqual([]);
  });

  it('COLOR_CLASSIFIED와 양방향 exact — 누락 0 · 잉여 0', () => {
    expect({ missing: res.missing, extra: res.extra }).toEqual({ missing: [], extra: [] });
  });
});

// --- 검출력: 합성 세계(같은 hitsFor로 만든 DECL) --------------------------------
const MINI_REL = 'styles/components/__synthetic__.scss';
const MINI_SCSS = `
.Mini {
  &__Card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04); }
  &__Panel { background: rgba(0, 0, 0, 0.04); }
  &__Link { color: #334155; }
  &__Link--mat { color: #334155; }
}
html[data-theme=dark] {
  .Mini__Card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }
  .Mini__Link { color: #94A3B8; }
  .Mini__Link--mat { color: #94A3B8; }
}
html[data-theme=dark].Mini__Card { outline-color: #123456; }
.Mini__Card[data-theme=dark] { outline-color: #223456; }
.Mini__Card[data-theme=darkness] { outline-color: #323456; }
`;
const MINI_DECL = new Set(hitsFor(MINI_REL, MINI_SCSS).map(key));
const APPROVER = 'HyeonSeong 2026-08-12';
const row = (...c) => c.join(TAB);

// 정상 원장: 라이트 짝 2행(Card·Link) + 다크 자기근거 2행
const BASE_ROWS = [
  row(MINI_REL, '.Mini__Card', 'box-shadow', 'rgba(0, 0, 0, 0.04)',
    'html[data-theme=dark] .Mini__Card', 'box-shadow', 'rgba(0, 0, 0, 0.5)', APPROVER),
  row(MINI_REL, '.Mini__Link', 'color', '#334155',
    'html[data-theme=dark] .Mini__Link', 'color', '#94A3B8', APPROVER),
  row(MINI_REL, 'html[data-theme=dark] .Mini__Card', 'box-shadow', 'rgba(0, 0, 0, 0.5)',
    'html[data-theme=dark] .Mini__Card', 'box-shadow', 'rgba(0, 0, 0, 0.5)', APPROVER),
  row(MINI_REL, 'html[data-theme=dark] .Mini__Link', 'color', '#94A3B8',
    'html[data-theme=dark] .Mini__Link', 'color', '#94A3B8', APPROVER),
];
const BASE_CLS = new Set(BASE_ROWS.map((r) => r.split(TAB).slice(0, 4).join(TAB)));
const build = (rows) => [HEADER, ...rows].join('\n') + '\n';
const run = (rows, cls = BASE_CLS) => auditLedger(build(rows), MINI_DECL, cls);
const edit = (i, fn) => BASE_ROWS.map((r, j) => (j === i ? fn(r.split(TAB)).join(TAB) : r));

// 라벨은 §13-3-b 변이표 15행과 같은 순서·같은 이름이다.
const CASES = [
  ['없음(정상 원장)', () => run(BASE_ROWS), []],
  ['a) 승인표 행 1건 삭제', () => run(BASE_ROWS.slice(1)), 'MISSING'],
  ['b1) 정본에서 tuple 1건 삭제', () => run(BASE_ROWS, new Set([...BASE_CLS].slice(1))), 'EXTRA'],
  ['b2) 정본에 없는 tuple로 승인 행 추가', () => run([...BASE_ROWS,
    row(MINI_REL, '.Mini__Card', 'outline-color', '#ABCDEF',
      'html[data-theme=dark] .Mini__Card', 'box-shadow', 'rgba(0, 0, 0, 0.5)', APPROVER)]), 'EXTRA'],
  ['c) approver=x', () => run(BASE_ROWS.map((r) => {
    const c = r.split(TAB); c[7] = 'x'; return c.join(TAB);
  })), ['BAD_APPROVER', 'BAD_APPROVER', 'BAD_APPROVER', 'BAD_APPROVER']],
  ['d) 근거 selector를 접두 형제로 위조', () => run(edit(1, (c) => {
    c[4] = 'html[data-theme=dark] .Mini__Link--mat'; return c;
  })), ['EVIDENCE_SELECTOR_MISMATCH']],
  ['e) 커밋된 SCSS에 없는 다크 선언 인용', () => run(edit(0, (c) => {
    c[6] = 'rgba(9, 9, 9, 0.9)'; return c;
  })), ['EVIDENCE_NOT_A_DECL']],
  ['f) 근거 selector를 same-element로 위조', () => run(edit(0, (c) => {
    c[4] = 'html[data-theme=dark].Mini__Card'; c[5] = 'outline-color'; c[6] = '#123456'; return c;
  })), ['EVIDENCE_SELECTOR_MISMATCH']],
  ['g) 같은 tuple을 두 번 서명', () => run([...BASE_ROWS, BASE_ROWS[0]]), ['DUPLICATE_TUPLE']],
  ['h) approver 날짜가 달력에 없다', () => run(edit(0, (c) => {
    c[7] = 'HyeonSeong 2026-02-31'; return c;
  })), ['BAD_APPROVER_DATE']],
  ['i) 다크가 아닌 선언을 근거로(라이트 자기인용)', () => run(edit(0, (c) => {
    c[4] = '.Mini__Card'; c[5] = 'box-shadow'; c[6] = 'rgba(0, 0, 0, 0.04)'; return c;
  })), ['EVIDENCE_NOT_DARK']],
  ['j) 근거 3열 중 하나가 공란', () => run(edit(0, (c) => { c[5] = ''; return c; })),
    ['NO_DARK_EVIDENCE']],
  ['k) 근거 selector 속성값이 dark가 아니다', () => run(edit(0, (c) => {
    c[1] = '.Mini__Card[data-theme=darkness]'; c[2] = 'outline-color'; c[3] = '#323456';
    c[4] = '.Mini__Card[data-theme=darkness]'; c[5] = 'outline-color'; c[6] = '#323456'; return c;
  })), ['EVIDENCE_NOT_DARK']],
  ['l) 근거 selector가 루트가 아닌 요소의 속성', () => run(edit(0, (c) => {
    c[1] = '.Mini__Card[data-theme=dark]'; c[2] = 'outline-color'; c[3] = '#223456';
    c[4] = '.Mini__Card[data-theme=dark]'; c[5] = 'outline-color'; c[6] = '#223456'; return c;
  })), ['EVIDENCE_NOT_DARK']],
  ['m) same-element 자기인용', () => run(edit(0, (c) => {
    c[1] = 'html[data-theme=dark].Mini__Card'; c[2] = 'outline-color'; c[3] = '#123456';
    c[4] = 'html[data-theme=dark].Mini__Card'; c[5] = 'outline-color'; c[6] = '#123456'; return c;
  })), ['EVIDENCE_NOT_DARK']],
];

describe('검출력 — §13-3-b 변이표 15행이 각각 같은 라벨로 RED', () => {
  it.each(CASES)('%s', (_name, mutate, expected) => {
    const r = mutate();
    if (expected === 'MISSING') {
      expect(labels(r)).toEqual([]);
      expect([r.missing.length > 0, r.extra.length]).toEqual([true, 0]);
    } else if (expected === 'EXTRA') {
      expect(labels(r)).toEqual([]);
      expect([r.missing.length, r.extra.length > 0]).toEqual([0, true]);
    } else {
      expect(labels(r)).toEqual(expected);
      expect([r.missing, r.extra]).toEqual([[], []]);
    }
  });
});

describe('BAD_APPROVER_DATE — 실 달력(윤년 포함)', () => {
  it('2024-02-29·2000-02-29는 통과, 2026-02-29·1900-02-29·2026-02-31·2026-04-31·2026-19-39·2026-00-00은 RED', () => {
    const label = (d) => labels(run(edit(0, (c) => { c[7] = `HyeonSeong ${d}`; return c; })));
    expect(['2024-02-29', '2000-02-29'].map(label)).toEqual([[], []]);
    expect(['2026-02-29', '1900-02-29', '2026-02-31', '2026-04-31', '2026-19-39', '2026-00-00'].map(label))
      .toEqual(Array(6).fill(['BAD_APPROVER_DATE']));
  });
});

describe('구조 — 헤더와 열 수', () => {
  it('헤더가 8열 계약과 다르면 BAD_HEADER', () => {
    expect(labels(auditLedger([COLS.slice(0, 7).join(TAB), ...BASE_ROWS].join('\n') + '\n',
      MINI_DECL, BASE_CLS))).toEqual(['BAD_HEADER']);
  });

  it('8열이 아닌 행은 COLUMNS(n)', () => {
    expect(labels(run(BASE_ROWS.map((r, i) => (i === 0 ? r.split(TAB).slice(0, 7).join(TAB) : r)))))
      .toEqual(['COLUMNS(7)']);
  });
});
