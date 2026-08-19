import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from 'sass';
import postcss from 'postcss';
import TaskFilterBar from '@/components/Branch/TaskFilterBar';
import {
  STATUS_CATEGORY_TOKENS, PRIORITY_TOKENS, DEFAULT_STATUS_FALLBACK,
  tokenVar, statusCategoryVar, priorityVar, FALLBACK_TOKEN,
  CHIP_COLOR_VAR, CHIP_TINT_PERCENT, chipTintStyle,
} from './themePalette.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('themePalette — 토큰 이름만 돌려준다(hex 금지)', () => {
  it('tokenVar는 토큰 이름을 var() 참조로 감싼다', () => {
    expect(tokenVar('--color-success')).toBe('var(--color-success)');
  });

  it('STATUS_CATEGORY_TOKENS/PRIORITY_TOKENS의 값은 전부 --color- 접두 토큰 이름이다', () => {
    for (const [k, v] of Object.entries({ ...STATUS_CATEGORY_TOKENS, ...PRIORITY_TOKENS })) {
      expect(v, k).toMatch(/^--color-[a-z0-9-]+$/);
    }
  });

  it('모듈이 hex 리터럴을 export하지 않는다 (DEFAULT_STATUS_FALLBACK 포함)', () => {
    const json = JSON.stringify({ STATUS_CATEGORY_TOKENS, PRIORITY_TOKENS, DEFAULT_STATUS_FALLBACK });
    expect(json).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

describe('themePalette — 백엔드 열거와 키가 정확히 일치한다', () => {
  it('STATUS_CATEGORY_TOKENS 키는 정확히 4개이고 workflow_status validator와 같다', () => {
    // backend/routers/schema/workflow_status.py:23 — ('todo','in_progress','done','cancelled')
    expect(Object.keys(STATUS_CATEGORY_TOKENS).sort())
      .toEqual(['cancelled', 'done', 'in_progress', 'todo']);
  });

  it('백엔드 validator 소스에서 직접 읽은 튜플과 대조한다 (계약 드리프트 감지)', () => {
    const src = readFileSync(resolve(here, '../../backend/routers/schema/workflow_status.py'), 'utf8');
    const m = src.match(/if v not in \(([^)]*)\):/);
    expect(m, 'workflow_status.py의 category validator를 찾지 못했다').not.toBeNull();
    const backend = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(Object.keys(STATUS_CATEGORY_TOKENS).sort()).toEqual(backend);
  });

  it('PRIORITY_TOKENS 키는 백엔드 task validator와 같다', () => {
    // backend/routers/schema/task.py:53 — ('low','medium','high','urgent')
    const src = readFileSync(resolve(here, '../../backend/routers/schema/task.py'), 'utf8');
    const m = src.match(/if v not in \('low'[^)]*\):/);
    expect(m, 'task.py의 priority validator를 찾지 못했다').not.toBeNull();
    const backend = [...m[0].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort();
    expect(Object.keys(PRIORITY_TOKENS).sort()).toEqual(backend);
  });

  it('blocked는 상태로 실재하지 않으므로 키에 없다', () => {
    expect('blocked' in STATUS_CATEGORY_TOKENS).toBe(false);
  });
});

describe('themePalette — 조회와 폴백', () => {
  it('알려진 카테고리를 var() 참조로 돌려준다', () => {
    expect(statusCategoryVar('done')).toBe('var(--color-success)');
    expect(statusCategoryVar('in_progress')).toBe('var(--color-status-in-progress)');
    expect(statusCategoryVar('cancelled')).toBe('var(--color-error)');
  });

  it('미지 카테고리·우선순위는 text-secondary로 폴백한다', () => {
    expect(FALLBACK_TOKEN).toBe('--color-text-secondary');
    for (const v of ['nope', undefined, null, '', 0]) {
      expect(statusCategoryVar(v)).toBe('var(--color-text-secondary)');
      expect(priorityVar(v)).toBe('var(--color-text-secondary)');
    }
  });

  it('priorityVar는 4값을 각각 돌려준다', () => {
    expect(priorityVar('urgent')).toBe('var(--color-error)');
    expect(priorityVar('high')).toBe('var(--color-warning)');
    expect(priorityVar('medium')).toBe('var(--color-primary)');   // 브랜드색(의미색 아님) — 현행 유지
    expect(priorityVar('low')).toBe('var(--color-text-tertiary)');
  });
});

describe('themePalette — DEFAULT_STATUS_FALLBACK', () => {
  it('시드 4개와 같은 순서·key·label이고 color는 var() 참조다', () => {
    // backend/core/model/workflow_status.py:97-100 seed_defaults
    expect(DEFAULT_STATUS_FALLBACK).toEqual([
      { value: 'todo',        label: 'To Do',       color: 'var(--color-text-secondary)' },
      { value: 'in_progress', label: 'In Progress', color: 'var(--color-status-in-progress)' },
      { value: 'done',        label: 'Done',        color: 'var(--color-success)' },
      { value: 'cancelled',   label: 'Cancelled',   color: 'var(--color-error)' },
    ]);
  });
});

describe('themePalette — 참조 토큰이 _themes.scss :root에 실재한다', () => {
  it('참조 토큰 중 :root 미정의가 0건이다', () => {
    const src = readFileSync(resolve(here, '../styles/_themes.scss'), 'utf8');
    const root = src.match(/:root\s*\{([\s\S]*?)\n\}/);
    expect(root, '_themes.scss의 :root 블록을 찾지 못했다').not.toBeNull();
    const defined = new Set(root[1].match(/--[a-z0-9-]+(?=\s*:)/g) || []);
    const referenced = [...new Set([
      ...Object.values(STATUS_CATEGORY_TOKENS),
      ...Object.values(PRIORITY_TOKENS),
      FALLBACK_TOKEN,
    ])];
    expect(referenced.filter((t) => !defined.has(t))).toEqual([]);
  });
});

describe('themePalette 소비 — 우선순위 옵션 배열에 hex가 남아 있지 않다', () => {
  const FILES = [
    'components/Branch/Tasks/TaskListRow.js',
    'components/Branch/Tasks/TaskDetailPanel.js',
    'components/Branch/Tasks/TaskFullPage.js',
    'components/Branch/TaskFilterBar.js',
    'components/MyTasks/MyTasksView.js',
    'components/Branch/FilterBuilder.js',
  ];

  // ⚠️ 스코프는 **우선순위 옵션 배열 블록**뿐이다. 파일 전역이 아니다.
  //    이 6파일에는 사용자/서버 저장색 폴백(에픽 색·타입 색 `?? '#5E6AD2'`, 에픽 'None' 옵션
  //    '#9CA3AF')이 남는다. 그것들은 **S7 소유**이고 이 슬라이스가 손대지 않는다.
  //    파일 전역 hex를 금지하면 S7 이전까지 영구 RED가 되어 회귀 감시가 아니라 방해가 된다.
  //
  // 블록 경계 = `value: 'urgent'` 줄 ~ `value: 'low'` 줄(양끝 포함).
  // 6파일 모두 이 두 앵커가 정확히 1회씩만 나온다(계획 Task 7 실측표).
  const priorityBlock = (f) => {
    const lines = readFileSync(resolve(here, '..', f), 'utf8').split('\n');
    const hits = (re) => lines.reduce((a, l, i) => (re.test(l) ? [...a, i] : a), []);
    const s = hits(/value:\s*'urgent'/);
    const e = hits(/value:\s*'low'/);
    expect(s.length, `${f}: value: 'urgent' 앵커가 1회가 아니다`).toBe(1);
    expect(e.length, `${f}: value: 'low' 앵커가 1회가 아니다`).toBe(1);
    expect(e[0], `${f}: 앵커 순서가 뒤집혔다`).toBeGreaterThan(s[0]);
    return lines.slice(s[0], e[0] + 1).join('\n');
  };

  it('6파일의 우선순위 옵션 블록에 hex 리터럴이 없다', () => {
    const offenders = [];
    for (const f of FILES) {
      for (const m of priorityBlock(f).match(/#[0-9a-fA-F]{3,8}\b/g) || []) offenders.push(`${f}: ${m}`);
    }
    expect(offenders).toEqual([]);
  });

  it('6파일의 우선순위 옵션 블록이 priorityVar를 4회 호출한다', () => {
    const bad = [];
    for (const f of FILES) {
      const n = (priorityBlock(f).match(/priorityVar\(/g) || []).length;
      if (n !== 4) bad.push(`${f}: priorityVar ${n}회`);
    }
    expect(bad).toEqual([]);
  });

  it('지정 6파일이 themePalette를 import한다', () => {
    const missing = FILES.filter(
      (f) => !readFileSync(resolve(here, '..', f), 'utf8').includes('themePalette'),
    );
    expect(missing).toEqual([]);
  });
});

describe('cancelled 카테고리 커버리지 — 4카테고리를 다루는 곳이 3개만 열거하지 않는다', () => {
  const JS_FILES = [
    'components/Branch/FilterBuilder.js',
    'components/Branch/Epics/EpicDetailPanel.js',
    'components/Branch/Tasks/TaskFullPage.js',
    'components/Track/BulkAddModal.js',
  ];
  const SCSS_FILES = [
    'styles/components/branch/taskList.scss',
    'styles/components/myTasks/myTasks.scss',
  ];

  it('JS: in_progress를 열거하는 파일은 cancelled도 열거한다', () => {
    const bad = JS_FILES.filter((f) => {
      const src = readFileSync(resolve(here, '..', f), 'utf8');
      return src.includes("'in_progress'") && !src.includes("'cancelled'");
    });
    expect(bad).toEqual([]);
  });

  it('SCSS: &--in_progress 상태 modifier가 있는 파일은 &--cancelled도 갖는다', () => {
    const bad = SCSS_FILES.filter((f) => {
      const src = readFileSync(resolve(here, '..', f), 'utf8');
      return src.includes('&--in_progress') && !src.includes('&--cancelled');
    });
    expect(bad).toEqual([]);
  });

  it('canceled(l 1개) 오타가 없다', () => {
    const bad = [...JS_FILES, ...SCSS_FILES].filter((f) =>
      /\bcanceled\b/.test(readFileSync(resolve(here, '..', f), 'utf8')),
    );
    expect(bad).toEqual([]);
  });
});

describe('themePalette 소비 — TaskListRow 상태 폴백이 공용 상수로 통합됐다', () => {
  const F = 'components/Branch/Tasks/TaskListRow.js';
  const src = () => readFileSync(resolve(here, '..', F), 'utf8');

  it('workflowStatuses가 비었을 때 DEFAULT_STATUS_FALLBACK을 쓴다', () => {
    expect(src()).toMatch(/import \{[^}]*DEFAULT_STATUS_FALLBACK[^}]*\} from '@\/library\/themePalette'/);
    expect(src()).toMatch(/:\s*DEFAULT_STATUS_FALLBACK;/);
  });

  it('로컬 상태 옵션 상수를 다시 만들지 않는다', () => {
    // 통합 전 로컬 상수(DEFAULT_STATUS_OPTIONS, hex 4색)가 부활하면 RED.
    expect(src()).not.toMatch(/DEFAULT_STATUS_OPTIONS/);
    expect(src()).not.toMatch(/label:\s*'In Progress'/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 활성 필터 칩 틴트 — 저장색(#RRGGBB)과 토큰 참조(var(--color-*)) 양쪽에서 유효해야 한다
//
// 선재현(수정 전 HEAD): TaskFilterBar가 `backgroundColor: chip.color + '15'`로 알파를 이어 붙였다.
//   priority 칩의 chip.color는 priorityVar()가 돌려주는 토큰 참조라 결과가
//   `background-color: var(--color-error)15` — var() 치환 후 문법 검사에서 탈락하는 무효 선언이다.
//   background-color는 상속되지 않으므로 unset=initial=transparent가 되어 틴트가 사라진다
//   (실브라우저 실측 computed rgba(0, 0, 0, 0) / SSR 실측 아래 렌더 문자열과 일치).
//   statusKeys·labelIds·epicIds 칩은 chip.color가 DB 저장 hex라 같은 코드에서 계속 동작했다
//   — 그래서 회귀 감시는 **두 경로를 모두** 렌더해서 확인한다.
//
// ⚠️ 옵션 배열만 보는 검사로는 이 결함을 못 잡는다(옵션 배열의 color는 정상 토큰이다).
//    아래는 @testing-library 없이 react-dom/server로 **실제 TaskFilterBar를 렌더**해
//    브라우저에 실제로 나가는 style 속성 문자열을 직접 검사한다.
// ═════════════════════════════════════════════════════════════════════════════

// 완결된 CSS 색 값만 허용하는 **앵커** 검사. `var(--color-error)15`처럼 참조 뒤에 무언가
// 이어 붙은 값은 여기서 탈락한다(= 되돌리기 mutation의 RED 지점).
const COMPLETE_COLOR_VALUE = /^(?:#[0-9a-fA-F]{3,8}|var\(--[a-z0-9-]+\))$/;

function parseInlineStyle(attr) {
  const out = {};
  for (const part of String(attr).split(';')) {
    if (!part) continue;
    const i = part.indexOf(':');
    expect(i, `선언에 콜론이 없다: ${part}`).toBeGreaterThan(0);
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const BASE_PROPS = {
  members: [],
  searchQuery: '',
  onSearchChange: () => {},
  selectedUserIds: new Set(),
  onToggleUser: () => {},
  onToggleFilter: () => {},
  onClearFilters: () => {},
};

// 실제 컴포넌트를 SSR로 렌더하고 활성 칩 span + 제거 버튼의 class/style을 그대로 뽑는다.
// 정규식이 마크업 모양에 엄격한 것은 의도다 — 칩 렌더 구조가 바뀌면 chips.length 단정에서 RED가 된다.
const CHIP_RE = new RegExp(
  '<span class="(TaskFilterBar__ActiveChip[^"]*)"( style="([^"]*)")?>([^<]*)'
  + '<button type="button" class="TaskFilterBar__ActiveChipRemove"( style="([^"]*)")?>',
  'g',
);

function renderChips(props) {
  const html = renderToStaticMarkup(<TaskFilterBar {...BASE_PROPS} {...props} />);
  return [...html.matchAll(CHIP_RE)].map((m) => ({
    classes: m[1].split(' ').filter(Boolean),
    styleAttr: m[3],            // 속성 자체가 없으면 undefined
    label: m[4],
    removeStyleAttr: m[6],
  }));
}

describe('활성 필터 칩 — 실제 TaskFilterBar 렌더가 유효한 CSS만 내보낸다 (finding 1 회귀)', () => {
  it('우선순위 칩(토큰 색)의 인라인 style 값이 전부 완결된 CSS 색이다', () => {
    const chips = renderChips({ filters: { priorities: new Set(['urgent']) } });
    expect(chips.map((c) => c.label)).toEqual(['Urgent']);
    const decls = parseInlineStyle(chips[0].styleAttr);
    expect(Object.keys(decls).length).toBeGreaterThan(0);
    for (const [prop, value] of Object.entries(decls)) {
      // 되돌리면 background-color: var(--color-error)15 가 되어 여기서 RED.
      expect(value, `${prop}: ${value}`).toMatch(COMPLETE_COLOR_VALUE);
    }
  });

  it('style 속성 어디에도 var() 참조 뒤에 이어 붙은 문자가 없다', () => {
    const chips = renderChips({
      filters: { priorities: new Set(['urgent', 'high', 'medium', 'low']) },
    });
    expect(chips).toHaveLength(4);
    for (const c of chips) {
      // `var(--x)15` → `)1` 매치 → RED. 정상은 `)` 뒤가 `;` 또는 문자열 끝뿐이다.
      expect(`${c.styleAttr};`, c.label).not.toMatch(/\)[^;]/);
      expect(`${c.removeStyleAttr};`, `${c.label} remove`).not.toMatch(/\)[^;]/);
    }
  });

  it('우선순위 4종이 각각 자기 토큰을 --chip-color로만 실어 보낸다(색 가공 없음)', () => {
    const chips = renderChips({
      filters: { priorities: new Set(['urgent', 'high', 'medium', 'low']) },
    });
    expect(chips.map((c) => c.label)).toEqual(['Urgent', 'High', 'Medium', 'Low']);
    const expected = ['urgent', 'high', 'medium', 'low'].map((p) => priorityVar(p));
    chips.forEach((c, i) => {
      expect(c.classes).toContain('TaskFilterBar__ActiveChip');
      expect(c.classes).toContain('TaskFilterBar__ActiveChip--tinted');
      expect(parseInlineStyle(c.styleAttr)).toEqual({ [CHIP_COLOR_VAR]: expected[i] });
    });
  });

  it('DB 저장색(원시 hex) 경로 — status·label·epic 칩도 같은 통로를 쓴다', () => {
    const chips = renderChips({
      filters: {
        statusKeys: new Set(['done']),
        labelIds: new Set([7]),
        epicIds: new Set([3]),
      },
      workflowStatuses: [{ key: 'done', label: 'Done', color: '#16A34A' }],
      labels: [{ label_id: 7, label_name: 'bug', color: '#DC2626' }],
      epics: [{ epic_id: 3, epic_name: 'Alpha', color: '#5E6AD2' }],
    });
    expect(chips.map((c) => c.label)).toEqual(['Done', 'bug', 'Alpha']);
    expect(chips.map((c) => parseInlineStyle(c.styleAttr))).toEqual([
      { [CHIP_COLOR_VAR]: '#16A34A' },
      { [CHIP_COLOR_VAR]: '#DC2626' },
      { [CHIP_COLOR_VAR]: '#5E6AD2' },
    ]);
    for (const c of chips) expect(c.classes).toContain('TaskFilterBar__ActiveChip--tinted');
  });

  it('색 없는 칩(Type)은 style 속성도 --tinted 클래스도 달지 않는다', () => {
    const chips = renderChips({
      filters: { typeKeys: new Set(['task']) },
      taskTypes: [{ type_key: 'task', type_name: 'Task' }],
    });
    expect(chips.map((c) => c.label)).toEqual(['Task']);
    expect(chips[0].styleAttr).toBeUndefined();
    expect(chips[0].classes).toEqual(['TaskFilterBar__ActiveChip']);
  });

  it('제거 버튼의 color는 토큰·hex 양쪽에서 완결된 CSS 색이다(단일 var() 참조는 유효 — 현행 유지 판정)', () => {
    const tokenChip = renderChips({ filters: { priorities: new Set(['urgent']) } })[0];
    expect(parseInlineStyle(tokenChip.removeStyleAttr)).toEqual({ color: priorityVar('urgent') });
    expect(parseInlineStyle(tokenChip.removeStyleAttr).color).toMatch(COMPLETE_COLOR_VALUE);

    const hexChip = renderChips({
      filters: { statusKeys: new Set(['done']) },
      workflowStatuses: [{ key: 'done', label: 'Done', color: '#16A34A' }],
    })[0];
    expect(parseInlineStyle(hexChip.removeStyleAttr)).toEqual({ color: '#16A34A' });

    // 색 없는 칩은 제거 버튼에도 style이 붙지 않는다.
    const plain = renderChips({
      filters: { typeKeys: new Set(['task']) },
      taskTypes: [{ type_key: 'task', type_name: 'Task' }],
    })[0];
    expect(plain.removeStyleAttr).toBeUndefined();
  });

  it('TaskFilterBar 소스가 칩 색에 문자열을 이어 붙이지 않는다', () => {
    const src = readFileSync(resolve(here, '../components/Branch/TaskFilterBar.js'), 'utf8');
    const code = src.split('\n').map((l) => l.split('//')[0]).join('\n'); // 주석 제외
    expect(code).not.toMatch(/chip\.color\s*\+/);
    expect(code).toContain('chipTintStyle(chip.color)');
  });
});

describe('chipTintStyle — 색을 가공하지 않고 커스텀 프로퍼티로만 넘긴다', () => {
  it('색을 그대로 --chip-color에 싣는다(토큰·hex 불문)', () => {
    expect(chipTintStyle('var(--color-error)')).toEqual({ '--chip-color': 'var(--color-error)' });
    expect(chipTintStyle('#16A34A')).toEqual({ '--chip-color': '#16A34A' });
  });

  it('색이 없으면 style을 만들지 않는다', () => {
    for (const v of [undefined, null, '', 0]) expect(chipTintStyle(v)).toBeUndefined();
  });

  it('CHIP_COLOR_VAR는 보호 접두(--color-/--track-/--shadow-)가 아니다', () => {
    // 보호 네임스페이스를 컴포넌트가 주입하면 themeTokens.test.js의 P4 선언 금지 계약과 충돌한다.
    expect(CHIP_COLOR_VAR).toBe('--chip-color');
    expect(CHIP_COLOR_VAR).not.toMatch(/^--(?:color|track|shadow)-/);
  });
});

describe('칩 틴트 SCSS 계약 — 0x15 알파를 color-mix로 보존한다', () => {
  const compiled = compile(resolve(here, '../styles/components/branch/taskList.scss')).css;
  const ruleOf = (selector) => {
    const found = [];
    postcss.parse(compiled).walkRules((r) => {
      if (r.selectors.some((p) => p.trim() === selector)) found.push(r);
    });
    expect(found.length, `${selector} 규칙이 정확히 1개가 아니다`).toBe(1);
    return found[0];
  };
  const declsOf = (selector) => {
    const out = {};
    ruleOf(selector).walkDecls((d) => { out[d.prop] = d.value; });
    return out;
  };

  it('--tinted 규칙이 테두리·글자·배경을 전부 --chip-color에서 파생한다', () => {
    const d = declsOf('.TaskFilterBar__ActiveChip--tinted');
    expect(d['border-color']).toBe('var(--chip-color)');
    expect(d.color).toBe('var(--chip-color)');
    expect(d['background-color']).toBe(
      `color-mix(in srgb, var(--chip-color) ${CHIP_TINT_PERCENT}%, transparent)`,
    );
  });

  it('틴트 퍼센트가 옛 8자리 hex 알파 0x15(=21/255)와 같은 값이다', () => {
    // #RRGGBB15 → 알파 21/255 = 0.0823529411…  → 8.235294…%
    expect(CHIP_TINT_PERCENT).toBeCloseTo((0x15 / 0xff) * 100, 5);
    const m = declsOf('.TaskFilterBar__ActiveChip--tinted')['background-color']
      .match(/color-mix\(in srgb, var\(--chip-color\) ([0-9.]+)%, transparent\)/);
    expect(m, 'background-color가 레포 관용구 color-mix(in srgb, <색> N%, transparent) 형태가 아니다').not.toBeNull();
    expect(Number(m[1])).toBe(CHIP_TINT_PERCENT);   // JS 상수와 SCSS가 같은 수여야 한다
  });

  it('--tinted가 base 칩 규칙보다 뒤에 와서 border-color를 이긴다(동일 specificity)', () => {
    // base는 `border: 1px solid var(--color-border)` 축약이라 순서가 뒤집히면 테두리 색이 죽는다.
    expect(ruleOf('.TaskFilterBar__ActiveChip').source.start.offset)
      .toBeLessThan(ruleOf('.TaskFilterBar__ActiveChip--tinted').source.start.offset);
  });
});
