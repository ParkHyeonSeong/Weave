// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import TaskRefCard from '@/components/Messenger/TaskRefCard';
import { applyFallbackBadges } from '@/library/refHydration';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import { entityTintStyle, ENTITY_SURFACE_PROFILES } from '@/library/entityTint';
import { contrastRatio, tintFor, BADGE_MIN, TEXT_MIN } from '@/library/colorContrast';
import { CORPUS, SURFACE_PARENTS } from '@/library/__fixtures__/storedColorCorpus';

const here = dirname(fileURLToPath(import.meta.url));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
afterEach(() => { if (root) { act(() => root.unmount()); root = null; } });

// TaskRefCard는 props만 받는 순수 표현 컴포넌트다(라우터·컨텍스트 없음).
// removable=true면 NavLink 분기도 타지 않아 4개 표면 중 유일하게 단독 마운트가 된다.
const render = (status_color) => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  act(() => root.render(
    <TaskRefCard
      taskRef={{ task_id: 1, display_id: 'WV-1', title: 't', priority: 'medium', status: 'todo', status_category: 'todo', status_color }}
      removable
      onRemove={() => {}}
    />,
  ));
  return document.querySelector('.TaskRefCard__Status');
};

describe('상태 배지 — 저장색이 없거나 잘못됐으면 category 클래스가 그대로 산다', () => {
  it('유효한 hex면 EntityTint와 --et-* 변수가 붙는다', () => {
    const el = render('#16A34A');
    expect(el.classList.contains('EntityTint')).toBe(true);
    expect(el.classList.contains('TaskRefCard__Status--todo')).toBe(true);
    expect(el.style.getPropertyValue('--et-bg')).toMatch(/^#[0-9A-F]{6}$/);
  });

  it.each([null, undefined, '', 'nope', '#12345', 42])('%s면 EntityTint를 붙이지 않고 인라인도 비운다', (bad) => {
    const el = render(bad);
    expect(el.classList.contains('EntityTint')).toBe(false);
    expect(el.classList.contains('TaskRefCard__Status--todo')).toBe(true);
    expect(el.getAttribute('style')).toBeNull();   // category 클래스 배경·글자색이 유일한 소스로 남는다
  });

  // 지원 밖이지만 **오늘 선언이 실제로 나가는** 값 — passthrough가 그것을 문자 그대로 지켜야 한다.
  // 기대값은 브라우저(Chrome standards) / jsdom 양쪽 실측이다.
  it.each([
    ['red',          'color: red;'],
    ['#1a6',         'color: rgb(17, 170, 102);'],
    ['#11223344',    'color: rgba(17, 34, 51, 0.267);'],
    ['  #16A34A ',   'color: rgb(22, 163, 74);'],
  ])('%s는 EntityTint 없이 오늘의 선언을 그대로 남긴다', (raw, expected) => {
    const el = render(raw);
    expect(el.classList.contains('EntityTint')).toBe(false);      // var()로 태우면 클래스 배경이 죽는다
    expect(el.classList.contains('TaskRefCard__Status--todo')).toBe(true);
    expect(el.getAttribute('style')).toBe(expected);
    expect(el.style.getPropertyValue('--et-on')).toBe('');        // themed 변수가 실리면 안 된다
  });
});

// 나머지 3곳은 단독 마운트에 라우터/훅이 필요해 소스 계약으로 고정한다.
// 조건부 클래스를 지우는 순간(=`EntityTint`를 무조건 붙이는 순간) RED가 된다.
describe('상태 배지 4곳 전부가 조건부 EntityTint를 쓴다', () => {
  const SURFACES = [
    ['components/MyTasks/MyTasksView.js', 'MyTasksRow__Status'],
    ['components/Messenger/TaskSearchPopup.js', 'TaskSearchPopup__ItemStatus'],
    ['components/Messenger/TaskRefCard.js', 'TaskRefCard__Status'],
    ['components/Canvas/extensions/TaskRefPopup.js', 'TaskRefPopup__ItemStatus'],
  ];
  it.each(SURFACES)('%s: `${tint?.[\'--et-on\'] ? \' EntityTint\' : \'\'}` 형태다', (file, block) => {
    const src = readFileSync(resolve(here, '..', file), 'utf8');
    expect(src).toMatch(new RegExp(`${block}--\\$\\{[^}]+\\}\\$\\{tint\\?\\.\\['--et-on'\\] \\? ' EntityTint' : ''\\}`));
    expect(src).not.toMatch(new RegExp(`${block}--\\$\\{[^}]+\\} EntityTint`));       // 무조건 붙이기 금지
    expect(src).not.toMatch(new RegExp(`${block}--\\$\\{[^}]+\\}\\$\\{tint \\? `));   // truthiness 판정 금지 (passthrough가 새어 들어온다)
  });
});

describe('폴백이 의지하는 category 클래스가 SCSS에 살아 있다', () => {
  const SCSS = [
    // myTasks의 --todo 배경은 S5가 하드코딩 리터럴 rgba(156,163,175,.15)에서 토큰으로 옮겼다.
    // 계약은 "저장색이 없을 때 이 규칙이 배경을 준다"는 것이고, 그 값의 현재 정본이 아래다.
    ['styles/components/myTasks/myTasks.scss', 'color-mix(in srgb, var(--color-text-secondary) 15%, transparent)'],
    ['styles/components/messenger/taskSearchPopup.scss', '$color-surface-hover'],
    ['styles/components/messenger/taskRefCard.scss', '$color-surface-hover'],
    ['styles/components/canvas/canvasEditor.scss', '$color-surface-hover'],
  ];
  it.each(SCSS)('%s의 --todo/--in_progress/--done 3규칙이 유지된다', (file, todoBg) => {
    const scss = readFileSync(resolve(here, '..', file), 'utf8');
    for (const mod of ['--todo', '--in_progress', '--done']) expect(scss).toContain(`&${mod}`);
    expect(scss).toContain(todoBg);
  });
});

describe('Task 3 Step 5 — 각 호출부가 자기 접미를 넘기고 클래스를 조건부로 붙인다', () => {
  const SITES = [
    ['components/common/LabelTagInput.js',
      ["entityTintStyle(label.color, { alpha: '20' })", 'entityBorderStyle(label.color)'],
      ['LabelTagInput__Chip', 'LabelTagInput__ChipRemove']],
    ['components/Track/Detail/TrackItemDetail.js',
      ["entityTintStyle(branch.color, { from: 8, alpha: '14', surface: 'track-card' })", "entityTintStyle(ws.color, { from: 8, alpha: '14', surface: 'track-card' })",
       'entitySolidStyle(ws.color)', 'entityInkStyle(prio.color)', "entityBorderStyle(prio.color, { from: 25, alpha: '40' })"],
      ['TrackDetail__BranchPill', 'TrackDetail__StatusPill', 'TrackDetail__StatusDot', 'TrackDetail__PrioPill']],
    // ⚠️ TrackHeader 배경은 단색이 아니라 --track-paper → --track-paper-raised 세로 그라데이션이다.
    //    종전 계약은 위쪽 끝만 보고 default를 승인했는데, 아래쪽 끝(다크 최악)에서 31색 중 17색이
    //    미달이었다(브라우저 실측: 칩 위치 44~54%, 구간 하단 #1B1D22). 그래서 track-header 프로파일이다.
    ['components/Track/TrackHeader.js',
      ["entityTintStyle(b.color, { from: 8, alpha: '14', surface: 'track-header' })", "entityBorderStyle(b.color, { from: 20, alpha: '33' })"],
      ['TrackHeader__ParticipatingChip']],
    // ⚠️ TrackTree 상태 배지만 track-card 프로파일이다 — 부모가 트리 **행**(--track-card)이고
    //    다크에서 그게 --color-surface보다 밝아 default로 계산하면 31색 중 17색이 미달이었다.
    //    이 문자열에서 `surface: 'track-card'`를 빼면(= default로 되돌리면) 여기가 RED다.
    ['components/Track/Tree/TrackTree.js',
      ["entityTintStyle(ws.color, { from: 8, alpha: '14', surface: 'track-card' })", 'entitySolidStyle(ws.color)'],
      ['TrackTree__StatusPill', 'TrackTree__StatusDot']],
    ['components/Track/Flow/CrossBranchTaskNode.js',
      ["entityTintStyle(branchColor, { from: 8, alpha: '14', surface: 'track-card' })"],
      ['TrackNode__BranchChip']],
  ];
  // track-card 프로파일은 **부모가 --track-card인 배지 전부**에 붙고 그 밖에는 붙지 않는다.
  it('track-card 프로파일은 --track-card 위 배지 3파일에만 쓰인다', () => {
    const users = SITES.map(([f]) => f).filter((f) => readFileSync(resolve(here, '..', f), 'utf8').includes("surface: 'track-card'"));
    expect(users.sort()).toEqual([
      'components/Track/Detail/TrackItemDetail.js',
      'components/Track/Flow/CrossBranchTaskNode.js',
      'components/Track/Tree/TrackTree.js',
    ]);
  });

  // TrackHeader는 track-header 프로파일이다 — track-card를 빌려 쓰면 안 된다.
  // 다크 값이 우연히 가깝다는 이유로 재사용하면 --track-card와 --track-paper-raised가
  // 갈리는 순간 조용히 어긋난다. 역할이 다르면 프로파일도 다르다.
  it('TrackHeader는 track-header 프로파일이다 (track-card 전용값을 빌려 쓰지 않는다)', () => {
    const src = readFileSync(resolve(here, '../components/Track/TrackHeader.js'), 'utf8');
    expect(src).toContain("surface: 'track-header'");
    expect(src).not.toContain("surface: 'track-card'");
    expect(src).not.toContain("surface: 'task-ref'");
  });

  it.each(SITES)('%s', (file, calls, blocks) => {
    const src = readFileSync(resolve(here, '..', file), 'utf8');
    for (const c of calls) expect(src, c).toContain(c);
    for (const b of blocks) {
      expect(src, `${b} 조건부`).toMatch(new RegExp(`${b}\\$\\{\\w+\\?\\.\\['--et-on'\\] \\? ' Entity`));
      expect(src, `${b} 고정금지`).not.toMatch(new RegExp(`${b} Entity`));       // 고정 문자열 금지
      expect(src, `${b} truthiness금지`).not.toMatch(new RegExp(`${b}\\$\\{\\w+ \\? `));  // passthrough 누수 금지
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TaskFilterBar — 호출표 9·10행의 **하이브리드 계약**(2026-08-26 A안 확정)
// 이 표면만 색 도메인이 둘이라 위 SITES의 단일 형태로 묶지 않는다.
//   supported #RRGGBB → entityTint 경로 / 토큰·passthrough → 기존 chipTintStyle 경로
// 표면 행동(SSR 4상태)은 themePalette.test.js가, 소스 형태는 여기가 고정한다.
// ─────────────────────────────────────────────────────────────────────────────
describe('TaskFilterBar 하이브리드 — 두 메커니즘이 --et-on으로만 갈린다', () => {
  const src = () => readFileSync(resolve(here, '../components/Branch/TaskFilterBar.js'), 'utf8');

  it('두 경로의 호출을 모두 유지한다 (한쪽을 지우면 RED)', () => {
    const s = src();
    expect(s).toContain("entityTintStyle(chip.color, { from: 8, alpha: '15' })");   // 접미 15 유지
    expect(s).toContain('entityBorderStyle(chip.color)');
    expect(s).toContain('chipTintStyle(chip.color)');                               // 토큰 참조 경로 보존
  });

  it('판정 변수는 --et-on 하나뿐이다 (객체 truthiness 금지)', () => {
    const s = src();
    expect(s).toContain("const isStoredHex = !!storedTint?.['--et-on'];");
    expect(s).not.toMatch(/\bstoredTint \? /);      // 객체 truthiness면 passthrough가 새어 들어온다
    expect(s).not.toMatch(/\bstoredBorder \? /);
  });

  it('부모 칩과 제거 버튼의 짝 클래스가 조건부다 (고정 문자열 금지)', () => {
    const s = src();
    expect(s).toMatch(/TaskFilterBar__ActiveChip\$\{isStoredHex\s*\n?\s*\? ' EntityTint EntityBorder'/);
    expect(s).toContain("TaskFilterBar__ActiveChipRemove${isStoredHex ? ' EntityInk' : ''}");
    expect(s).not.toMatch(/TaskFilterBar__ActiveChip Entity/);
    expect(s).not.toMatch(/TaskFilterBar__ActiveChipRemove Entity/);
  });

  it('토큰 참조 경로에는 접미를 이어 붙이지 않는다 (IACVT 회귀 가드)', () => {
    // 주석은 제외 — 되돌리지 말라는 경고 자체가 잡히면 안 된다(themePalette.test.js:365와 같은 관용구)
    const code = src().split('\n').map((l) => l.split('//')[0]).join('\n');
    expect(code).not.toMatch(/chip\.color\s*\+/);
    expect(code).not.toMatch(/\$\{chip\.color\}[0-9a-fA-F]{2}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4 — DOM 직접 조작 경로 2곳. 두 경로를 describe.each로 함께 돌린다(한쪽만 고치면 RED).
// ─────────────────────────────────────────────────────────────────────────────

// setBadge는 비공개다. 실전 진입점 applyFallbackBadges로 그대로 태운다.
// addNodeView는 `this`를 안 쓰므로 config에서 바로 꺼내 부를 수 있다.
const PATHS = [
  ['refHydration.applyFallbackBadges', (color) => {
    document.body.innerHTML = '<span data-task-ref="true" data-status="todo" data-status-category="todo" data-status-label="To Do"'
      + (color == null ? '' : ` data-status-color="${color}"`) + '></span>';
    applyFallbackBadges(document.body);
    return document.querySelector('[data-ref-badge]');
  }],
  ['TaskRefExtension.addNodeView', (color) => TaskRefNode.config.addNodeView()({
    node: { attrs: { branchId: 1, taskId: 1, displayId: 'WV-1', title: 't', status: 'todo', statusLabel: 'To Do', statusCategory: 'todo', statusColor: color } },
  }).dom.querySelector('[data-ref-badge]')],
];

describe.each(PATHS)('%s — EntityTint는 --et-on이 있을 때만 붙는다', (_name, mount) => {
  it('supported #16A34A → EntityTint 있음 + --et-* 있음', () => {
    const b = mount('#16A34A');
    expect(b.classList.contains('EntityTint')).toBe(true);
    expect(b.classList.contains('ref-chip__badge--todo')).toBe(true);
    expect(b.style.getPropertyValue('--et-bg')).toMatch(/^#[0-9A-F]{6}$/);
    expect(b.style.getPropertyValue('--et-bg-dark')).toMatch(/^#[0-9A-F]{6}$/);
    expect(b.style.background).toBe('var(--et-bg)');
    expect(b.style.color).toBe('var(--et-fg)');
  });

  it('red → EntityTint 없음, color:red 유지', () => {
    const b = mount('red');
    expect(b.classList.contains('EntityTint')).toBe(false);
    expect(b.classList.contains('ref-chip__badge--todo')).toBe(true);
    expect(b.getAttribute('style')).toBe('color: red;');   // 'red20'은 파싱 거부 — 오늘과 같다
    expect(b.style.getPropertyValue('--et-on')).toBe('');
  });

  it('#1a6f → EntityTint 없음, 접미 20 배경과 color 유지', () => {
    const b = mount('#1a6f');
    expect(b.classList.contains('EntityTint')).toBe(false);
    expect(b.style.getPropertyValue('background-color')).toBe('rgb(26, 111, 32)');   // #1a6f20
    expect(b.style.getPropertyValue('color')).toBe('rgb(17, 170, 102)');             // #1a6f
    expect(b.style.getPropertyValue('--et-on')).toBe('');
  });

  it('blank → 클래스도 인라인 선언도 없다', () => {
    for (const blank of [null, '', '   ']) {
      const b = mount(blank);
      expect(b.classList.contains('EntityTint'), String(blank)).toBe(false);
      expect(b.getAttribute('style'), String(blank)).toBeNull();
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// S7 blocker correction (2026-08-31) — ref 배지는 task-ref 프로파일을 쓴다
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ 이 게이트는 `entityTintStyle`을 다시 계산해 비교하는 동어반복이 **아니다**.
//    위 PATHS가 실제 제품 경로(applyFallbackBadges → setBadge / addNodeView)를 태워
//    DOM에 실제로 꽂힌 `--et-bg`를 읽는다. 호출부에서 `surface: 'task-ref'`를 지우면
//    default 산출이 나오고 아래 기대값과 어긋나 RED가 된다.
//
// 배지의 부모는 문서 표면이 아니라 **ref 칩 자신의 배경**이다(--color-primary-subtle 합성).
describe.each(PATHS)('%s — 배지는 task-ref 프로파일로 칠해진다', (_name, mount) => {
  const P = ENTITY_SURFACE_PROFILES['task-ref'];

  it('코퍼스 전건: DOM에 꽂힌 --et-bg/--et-bg-dark가 task-ref 기준 산출과 같다', () => {
    for (const c of CORPUS) {
      const b = mount(c);
      expect(b.style.getPropertyValue('--et-bg'), `${c} light`).toBe(tintFor(c, P.light, 12));
      expect(b.style.getPropertyValue('--et-bg-dark'), `${c} dark`).toBe(tintFor(c, P.dark, 12));
    }
  });

  it('default 프로파일 산출과 다르다 — 되돌리면 여기가 RED다', () => {
    const differing = CORPUS.filter((c) => {
      const b = mount(c);
      const d = entityTintStyle(c, { alpha: '20' });   // default (= 되돌린 모습)
      return b.style.getPropertyValue('--et-bg') !== d['--et-bg']
        || b.style.getPropertyValue('--et-bg-dark') !== d['--et-bg-dark'];
    });
    expect(differing.length).toBeGreaterThan(0);
  });

  it('실제 칩 부모 전건에서 BADGE_MIN·TEXT_MIN을 만족한다', () => {
    for (const theme of ['light', 'dark']) {
      const bgKey = theme === 'light' ? '--et-bg' : '--et-bg-dark';
      const fgKey = theme === 'light' ? '--et-fg' : '--et-fg-dark';
      for (const [, parent] of SURFACE_PARENTS['task-ref'][theme]) {
        for (const c of CORPUS) {
          const b = mount(c);
          const bg = b.style.getPropertyValue(bgKey);
          const fg = b.style.getPropertyValue(fgKey);
          expect(contrastRatio(bg, parent), `${theme} ${c} bg ${bg} vs ${parent}`)
            .toBeGreaterThanOrEqual(BADGE_MIN);
          expect(contrastRatio(fg, bg), `${theme} ${c} fg ${fg} on ${bg}`)
            .toBeGreaterThanOrEqual(TEXT_MIN);
        }
      }
    }
  });
});

// 두 경로가 **같은** 프로파일을 써야 한다 — 한쪽만 고치면 편집/읽기에서 색이 갈린다.
describe('addNodeView와 setBadge는 같은 색을 낸다', () => {
  const [, hydrate] = PATHS[0];
  const [, nodeView] = PATHS[1];
  it.each(CORPUS)('%s: 두 경로의 --et-* 4값이 모두 같다', (c) => {
    const a = hydrate(c);
    const vars = ['--et-bg', '--et-fg', '--et-bg-dark', '--et-fg-dark']
      .map((k) => [k, a.style.getPropertyValue(k)]);
    const b = nodeView(c);
    for (const [k, v] of vars) expect(b.style.getPropertyValue(k), `${c} ${k}`).toBe(v);
  });
});

describe('renderHTML(저장 직렬화)은 손대지 않는다', () => {
  it('renderHTML은 여전히 hex 접미 20을 인라인으로 굳힌다', () => {
    const out = TaskRefNode.config.renderHTML.call(
      { options: {}, name: 'taskRef' },
      { node: { attrs: { branchId: 1, taskId: 1, displayId: 'WV-1', title: 't', status: 'todo', statusLabel: 'To Do', statusCategory: 'todo', statusColor: '#16A34A' } }, HTMLAttributes: {} },
    );
    expect(JSON.stringify(out)).toContain('background-color: #16A34A20');
  });
});

describe('미하이드레이션 배지 폴백 규칙이 다크 스코프에 있다', () => {
  const SEL = '.task-ref > .ref-chip__badge:not(.EntityTint)';

  it('storedColor.scss가 persisted Task ref 배지만 중립 토큰으로 누른다', () => {
    const scss = readFileSync(resolve(here, '../styles/components/common/storedColor.scss'), 'utf8');
    const darkIdx = scss.indexOf("html[data-theme='dark']");
    expect(darkIdx).toBeGreaterThanOrEqual(0);
    // 규칙은 반드시 다크 스코프 **안**에만 있어야 한다 — 라이트로 새면 저장색이 통째로 죽는다.
    expect(scss.slice(0, darkIdx)).not.toContain('.ref-chip__badge');
    expect(scss.slice(darkIdx)).toContain(SEL);
    // 중립 토큰과 !important 의미는 유지한다.
    expect(scss.slice(darkIdx)).toContain('background: var(--color-surface-hover) !important;');
    expect(scss.slice(darkIdx)).toContain('color: var(--color-text-secondary) !important;');
  });

  // 회귀: 부모 한정이 없으면 IssueRefExtension이 만드는 .issue-ref 배지까지 덮어
  //       다크에서 open(파랑)/closed(초록)이 같은 회색으로 뭉갠다.
  //       Issue ref는 색을 안 넘기므로(setBadge color: null) EntityTint가 절대 안 붙는다.
  it('selector가 Task ref 배지에는 걸리고 Issue ref 배지에는 안 걸린다', () => {
    document.body.innerHTML = `
      <span class="task-ref"><span class="ref-chip__badge ref-chip__badge--todo" data-ref-badge="true">To Do</span></span>
      <span class="issue-ref"><span class="ref-chip__badge ref-chip__badge--open" data-ref-badge="true">Open</span></span>
      <span class="issue-ref"><span class="ref-chip__badge ref-chip__badge--closed" data-ref-badge="true">Closed</span></span>`;
    const at = (parent) => document.querySelector(`.${parent} > .ref-chip__badge`);
    expect(at('task-ref').matches(SEL), 'Task ref는 눌러야 한다').toBe(true);
    expect(at('issue-ref').matches(SEL), 'Issue ref는 건드리면 안 된다').toBe(false);
    for (const b of document.querySelectorAll('.issue-ref > .ref-chip__badge')) {
      expect(b.matches(SEL), b.className).toBe(false);
    }
    // 하이드레이션이 EntityTint를 붙인 Task ref는 제외된다(자기 저장색을 그대로 쓴다).
    at('task-ref').classList.add('EntityTint');
    expect(at('task-ref').matches(SEL)).toBe(false);
  });
});
