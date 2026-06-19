import { describe, it, expect } from 'vitest';
import { matchesFilters } from './taskFilters.js';

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
