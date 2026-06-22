import { describe, it, expect } from 'vitest';
import { toFilterSpec, buildEffectiveSpec } from './filterSpecAdapter';
import { matchesFilters } from './taskFilters';
const empty = { priorities: new Set(), labelIds: new Set(), epicIds: new Set(), typeKeys: new Set(), statusKeys: new Set() };

describe('toFilterSpec', () => {
  it('priorities → in cond', () => {
    const s = toFilterSpec({ searchQuery: '', selectedUserIds: new Set(), filters: { ...empty, priorities: new Set(['high']) } });
    expect(s.children.find((c) => c.field === 'priority').op).toBe('in');
  });
  it('only unassigned(0) → assignee is_empty', () => {
    const s = toFilterSpec({ searchQuery: '', selectedUserIds: new Set([0]), filters: empty });
    expect(s.children.find((c) => c.field === 'assignee').op).toBe('is_empty');
  });
  it('unassigned + user → OR group (의미 보존)', () => {
    const s = toFilterSpec({ searchQuery: '', selectedUserIds: new Set([0, 5]), filters: empty });
    const node = s.children.find((c) => c.type === 'group' && c.op === 'OR');
    expect(node).toBeTruthy();
    expect(node.children.some((c) => c.op === 'is_empty')).toBe(true);
    expect(node.children.some((c) => c.field === 'assignee' && c.op === 'in')).toBe(true);
  });
  it('search → text contains (title+description로 확장)', () => {
    const s = toFilterSpec({ searchQuery: 'abc', selectedUserIds: new Set(), filters: empty });
    expect(s.children.find((c) => c.field === 'text')).toMatchObject({ op: 'contains', value: 'abc' });
  });
});

describe('buildEffectiveSpec', () => {
  const advanced = { type: 'group', op: 'AND', negate: false,
    children: [{ type: 'cond', field: 'status', op: 'in', value: ['todo'], negate: false }] };

  it('legacy priority AND advanced status를 합성', () => {
    const legacyCtx = { searchQuery: '', selectedUserIds: new Set(), filters: { ...empty, priorities: new Set(['high']) } };
    const eff = buildEffectiveSpec({ legacyCtx, filterSpec: advanced });
    expect(eff.op).toBe('AND');
    const flat = JSON.stringify(eff);
    expect(flat).toContain('priority');  // 레거시
    expect(flat).toContain('status');    // 고급
  });

  it('legacy가 비면 advanced만 반환', () => {
    const eff = buildEffectiveSpec({ legacyCtx: { searchQuery: '', selectedUserIds: new Set(), filters: empty }, filterSpec: advanced });
    expect(JSON.stringify(eff)).toContain('status');
    expect(JSON.stringify(eff)).not.toContain('priority');
  });

  it('둘 다 비면 빈 그룹(=전체)', () => {
    const eff = buildEffectiveSpec({ legacyCtx: { searchQuery: '', selectedUserIds: new Set(), filters: empty }, filterSpec: null });
    expect(eff.children).toHaveLength(0);
  });
});

describe('matchesFilters ctx.spec 경로', () => {
  it('prebuilt spec을 직접 평가(legacy 무시)', () => {
    const spec = { type: 'group', op: 'AND', negate: false,
      children: [{ type: 'cond', field: 'priority', op: 'eq', value: 'high', negate: false }] };
    const ctx = { spec, userId: 1, today: '2026-06-22' };
    const hi = { priority: 'high', assignees: [], labels: [], custom_fields: {} };
    const lo = { priority: 'low', assignees: [], labels: [], custom_fields: {} };
    expect(matchesFilters(hi, ctx)).toBe(true);
    expect(matchesFilters(lo, ctx)).toBe(false);
  });
});
