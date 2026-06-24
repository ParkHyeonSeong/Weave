import { describe, it, expect } from 'vitest';
import { toSavedPayload, applySavedView } from './savedViewState';

const empty = { priorities: new Set(), labelIds: new Set(), epicIds: new Set(), typeKeys: new Set(), statusKeys: new Set() };

describe('savedViewState', () => {
  it('toSavedPayload composes legacy + advanced into filter_spec', () => {
    const p = toSavedPayload({
      legacyCtx: { searchQuery: '', selectedUserIds: new Set(), filters: { ...empty, priorities: new Set(['high']) } },
      filterSpec: { type: 'group', op: 'AND', negate: false, children: [{ type: 'cond', field: 'status', op: 'in', value: ['todo'], negate: false }] },
      groupBy: 'status', multiSort: [{ field: 'due_date', dir: 'asc' }],
    });
    const s = JSON.stringify(p.filter_spec);
    expect(s).toContain('priority'); expect(s).toContain('status');
    expect(p.group_by).toBe('status'); expect(p.sort[0].field).toBe('due_date');
  });
  it('toSavedPayload normalizes empty groupBy/sort to null/[]', () => {
    const p = toSavedPayload({ legacyCtx: { searchQuery: '', selectedUserIds: new Set(), filters: empty }, filterSpec: null, groupBy: 'none', multiSort: [] });
    expect(p.group_by).toBe(null); expect(p.sort).toEqual([]);
  });
  it('toSavedPayload saves flat-view sortConfig as sort (groupBy none → 단일정렬 보존)', () => {
    // 평면 뷰에서 Due Date 정렬을 저장하면 sort에 담겨야 한다(리뷰 P1 — sortConfig 유실 방지).
    const p = toSavedPayload({ legacyCtx: { searchQuery: '', selectedUserIds: new Set(), filters: empty }, filterSpec: null, groupBy: 'none', multiSort: [], sortConfig: { field: 'due_date', direction: 'asc' } });
    expect(p.group_by).toBe(null);
    expect(p.sort).toEqual([{ field: 'due_date', dir: 'asc' }]);
  });
  it('toSavedPayload uses multiSort for grouping view and ignores sortConfig', () => {
    const p = toSavedPayload({ legacyCtx: { searchQuery: '', selectedUserIds: new Set(), filters: empty }, filterSpec: null, groupBy: 'status', multiSort: [{ field: 'priority', dir: 'desc' }], sortConfig: { field: 'due_date', direction: 'asc' } });
    expect(p.sort).toEqual([{ field: 'priority', dir: 'desc' }]);
  });
  it('applySavedView returns spec/groupBy/multiSort + sortConfig(평면 뷰 정렬)', () => {
    const v = { filter_spec: { type: 'group', op: 'AND', negate: false, children: [] }, group_by: 'assignee', sort: [{ field: 'priority', dir: 'desc' }] };
    const r = applySavedView(v);
    expect(r.groupBy).toBe('assignee'); expect(r.multiSort[0].field).toBe('priority');
    expect(r.filterSpec.type).toBe('group');
    expect(r.sortConfig).toEqual({ field: 'priority', direction: 'desc' });
  });
  it('applySavedView tolerates null group_by/sort', () => {
    const r = applySavedView({ filter_spec: { type: 'group', op: 'AND', negate: false, children: [] }, group_by: null, sort: null });
    expect(r.groupBy).toBe('none'); expect(r.multiSort).toEqual([]);
    expect(r.sortConfig).toEqual({ field: null, direction: 'asc' });
  });
  it('applySavedView wraps a cond-root spec into an AND group (조용한 전체보기 버그 방지)', () => {
    // 백엔드가 보존한 cond 루트(test_cond_root_spec_preserved)를 적용해도 필터가 살아 있어야 한다.
    const cond = { type: 'cond', field: 'priority', op: 'eq', value: 'high', negate: false };
    const r = applySavedView({ filter_spec: cond, group_by: null, sort: null });
    expect(r.filterSpec.type).toBe('group');
    expect(r.filterSpec.children).toEqual([cond]);   // emptyGroup(children:[])이 아님 = '전체보기' 아님
  });
});
