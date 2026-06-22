import { describe, it, expect } from 'vitest';
import { matchesFilters, filterTaskTree, countMatchedTasks } from './taskFilters.js';

const emptyFilters = { priorities: new Set(), labelIds: new Set(), epicIds: new Set(), typeKeys: new Set(), statusKeys: new Set() };
const baseTask = { task_id: 1, title: 'Hello world', priority: 'medium', status: 'todo', task_type: 'task', epic_id: null, assignees: [], labels: [] };

describe('matchesFilters', () => {
  it('필터 없음 → true', () => {
    expect(matchesFilters(baseTask, { searchQuery: '', selectedUserIds: new Set(), filters: emptyFilters })).toBe(true);
  });
  it('검색 일치/불일치', () => {
    expect(matchesFilters(baseTask, { searchQuery: 'hello', selectedUserIds: new Set(), filters: emptyFilters })).toBe(true);
    expect(matchesFilters(baseTask, { searchQuery: 'xyz', selectedUserIds: new Set(), filters: emptyFilters })).toBe(false);
  });
  it('[의도적 확장] 검색이 본문(description)까지 매칭', () => {
    const task = { ...baseTask, title: 'Hello world', description: '<p>Foobar payload</p>' };
    expect(matchesFilters(task, { searchQuery: 'payload', selectedUserIds: new Set(), filters: emptyFilters })).toBe(true);
  });
  it('unassigned: 담당자 없음 통과 / 있음 거부', () => {
    expect(matchesFilters(baseTask, { searchQuery: '', selectedUserIds: new Set([0]), filters: emptyFilters })).toBe(true);
    expect(matchesFilters({ ...baseTask, assignees: [{ user_id: 5 }] }, { searchQuery: '', selectedUserIds: new Set([0]), filters: emptyFilters })).toBe(false);
  });
  it('[버그수정] unassigned + 상태 불일치 → false (예전엔 true 누출)', () => {
    const filters = { ...emptyFilters, statusKeys: new Set(['done']) };
    expect(matchesFilters({ ...baseTask, status: 'todo' }, { searchQuery: '', selectedUserIds: new Set([0]), filters })).toBe(false);
  });
  it('[버그수정] unassigned + 상태 일치 → true', () => {
    const filters = { ...emptyFilters, statusKeys: new Set(['done']) };
    expect(matchesFilters({ ...baseTask, status: 'done' }, { searchQuery: '', selectedUserIds: new Set([0]), filters })).toBe(true);
  });
  it('우선순위/레이블/타입 필터', () => {
    expect(matchesFilters(baseTask, { searchQuery: '', selectedUserIds: new Set(), filters: { ...emptyFilters, priorities: new Set(['high']) } })).toBe(false);
    expect(matchesFilters({ ...baseTask, labels: [{ label_id: 7 }] }, { searchQuery: '', selectedUserIds: new Set(), filters: { ...emptyFilters, labelIds: new Set([7]) } })).toBe(true);
    expect(matchesFilters(baseTask, { searchQuery: '', selectedUserIds: new Set(), filters: { ...emptyFilters, typeKeys: new Set(['bug']) } })).toBe(false);
  });
});

// statusKeys 만 지정한 필터 ctx 헬퍼 (emptyFilters, baseTask 는 파일 상단에 이미 정의됨).
// 두 describe(filterTaskTree, countMatchedTasks)가 공유하므로 모듈 레벨에 둔다.
const ctx = (statusKeys) => ({
  searchQuery: '',
  selectedUserIds: new Set(),
  filters: { ...emptyFilters, statusKeys: new Set(statusKeys) },
});

describe('filterTaskTree', () => {
  it('부모 불일치 + done 하위 일치 → 컨텍스트 부모로 유지, 일치 하위만 visibleSubtasks', () => {
    const parent = {
      ...baseTask, task_id: 10, status: 'in_progress',
      subtasks: [
        { ...baseTask, task_id: 11, status: 'done' },
        { ...baseTask, task_id: 12, status: 'todo' },
      ],
    };
    const out = filterTaskTree([parent], ctx(['done']));
    expect(out).toHaveLength(1);
    expect(out[0].isContextOnly).toBe(true);
    expect(out[0].visibleSubtasks.map((s) => s.task_id)).toEqual([11]);
    expect(out[0].subtasks).toHaveLength(2); // 원본 보존
  });

  it('부모 done 일치 → isContextOnly=false, 불일치 하위는 visibleSubtasks 제외', () => {
    const parent = {
      ...baseTask, task_id: 20, status: 'done',
      subtasks: [{ ...baseTask, task_id: 21, status: 'todo' }],
    };
    const out = filterTaskTree([parent], ctx(['done']));
    expect(out).toHaveLength(1);
    expect(out[0].isContextOnly).toBe(false);
    expect(out[0].visibleSubtasks).toEqual([]);
  });

  it('부모 done 일치 + done 하위도 일치 → isContextOnly=false, visibleSubtasks=[matched]', () => {
    const parent = {
      ...baseTask, task_id: 25, status: 'done',
      subtasks: [
        { ...baseTask, task_id: 26, status: 'done' },
        { ...baseTask, task_id: 27, status: 'todo' },
      ],
    };
    const out = filterTaskTree([parent], ctx(['done']));
    expect(out).toHaveLength(1);
    expect(out[0].isContextOnly).toBe(false);
    expect(out[0].visibleSubtasks.map((s) => s.task_id)).toEqual([26]);
  });

  it('부모·하위 모두 불일치 → 결과에서 제거', () => {
    const parent = {
      ...baseTask, task_id: 30, status: 'todo',
      subtasks: [{ ...baseTask, task_id: 31, status: 'in_progress' }],
    };
    expect(filterTaskTree([parent], ctx(['done']))).toEqual([]);
  });

  it('하위 없는 부모(subtasks undefined)도 정상 동작', () => {
    const out = filterTaskTree([{ ...baseTask, task_id: 40, status: 'done' }], ctx(['done']));
    expect(out).toHaveLength(1);
    expect(out[0].isContextOnly).toBe(false);
    expect(out[0].visibleSubtasks).toEqual([]);
  });
});

describe('countMatchedTasks', () => {
  it('컨텍스트 부모는 자기 자신 0, autoExpand 로 펼쳐진 매칭 하위만 카운트', () => {
    const filtered = [
      { ...baseTask, task_id: 10, status: 'in_progress', isContextOnly: true,
        visibleSubtasks: [{ ...baseTask, task_id: 11, status: 'done' }] },
    ];
    expect(countMatchedTasks(filtered)).toBe(1);
  });

  it('[P3] 직접 매칭 부모는 매칭 하위가 있어도 1 (하위는 접힘 → 미카운트)', () => {
    // 부모 done(직접 매칭)은 autoExpand 대상이 아님 → 하위 접힘 → 화면 1행 → 배지 1.
    // (기존 정의처럼 1+1=2 로 세면 접힌 하위까지 세어 배지>화면 불일치 = 코덱스 P3)
    const filtered = [
      { ...baseTask, task_id: 20, status: 'done', isContextOnly: false,
        visibleSubtasks: [{ ...baseTask, task_id: 21, status: 'done' }] },
      { ...baseTask, task_id: 30, status: 'done', isContextOnly: false, visibleSubtasks: [] },
    ];
    expect(countMatchedTasks(filtered)).toBe(2);
  });

  it('필터 비활성 원본 배열(플래그 없음)은 length 와 동일', () => {
    const raw = [{ ...baseTask, task_id: 40 }, { ...baseTask, task_id: 41 }];
    expect(countMatchedTasks(raw)).toBe(2);
  });

  it('[통합] filterTaskTree → countMatchedTasks: 컨텍스트 1 + 직접매칭 1 = 2', () => {
    const tasks = [
      // 부모 in_progress(컨텍스트) + done 하위 1 + todo 하위 1 → visibleSubtasks=[done] → 1
      { ...baseTask, task_id: 50, status: 'in_progress', subtasks: [
        { ...baseTask, task_id: 51, status: 'done' },
        { ...baseTask, task_id: 52, status: 'todo' },
      ] },
      // 부모 done(직접 매칭) 하위 없음 → 1
      { ...baseTask, task_id: 60, status: 'done', subtasks: [] },
      // 부모 todo + todo 하위 → 모두 불일치 → 제거
      { ...baseTask, task_id: 70, status: 'todo', subtasks: [
        { ...baseTask, task_id: 71, status: 'todo' },
      ] },
    ];
    expect(countMatchedTasks(filterTaskTree(tasks, ctx(['done'])))).toBe(2);
  });
});
