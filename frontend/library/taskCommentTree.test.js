import { describe, it, expect } from 'vitest';
import { buildTree, SORT_VALUES } from './taskCommentTree';

const c = (id, createdAt, parent = null) => ({
  comment_id: id, created_at: createdAt, parent_comment_id: parent,
});

describe('buildTree', () => {
  const flatAsc = [
    c(1, '2026-07-01T10:00:00+00:00'),
    c(2, '2026-07-02T10:00:00+00:00', 1),
    c(3, '2026-07-03T10:00:00+00:00'),
  ];

  it('newest: root 최신순, 답글은 root 아래 유지', () => {
    const { roots, childrenByRoot } = buildTree(flatAsc, 'newest');
    expect(roots.map((r) => r.comment_id)).toEqual([3, 1]);
    expect(childrenByRoot[1].map((r) => r.comment_id)).toEqual([2]);
  });

  it('oldest: root 오래된순', () => {
    const { roots } = buildTree(flatAsc, 'oldest');
    expect(roots.map((r) => r.comment_id)).toEqual([1, 3]);
  });

  it('desc API 배열 입력에서도 답글은 항상 시간순 ASC', () => {
    const flatDesc = [
      c(5, '2026-07-03T10:00:00+00:00', 1),
      c(4, '2026-07-02T10:00:00+00:00', 1),
      c(1, '2026-07-01T10:00:00+00:00'),
    ];
    const { roots, childrenByRoot } = buildTree(flatDesc, 'newest');
    expect(roots.map((r) => r.comment_id)).toEqual([1]);
    expect(childrenByRoot[1].map((r) => r.comment_id)).toEqual([4, 5]);
  });

  it('동일 timestamp는 comment_id로 tiebreak (asc/desc 동방향)', () => {
    const ts = '2026-07-01T10:00:00+00:00';
    const same = [c(2, ts), c(1, ts)];
    expect(buildTree(same, 'oldest').roots.map((r) => r.comment_id)).toEqual([1, 2]);
    expect(buildTree(same, 'newest').roots.map((r) => r.comment_id)).toEqual([2, 1]);
  });

  it('root가 목록에 없는 고아 답글은 제외 (기존 동작 유지)', () => {
    const { roots, childrenByRoot } = buildTree(
      [c(9, '2026-07-01T10:00:00+00:00', 999)], 'newest');
    expect(roots).toEqual([]);
    expect(childrenByRoot).toEqual({});
  });

  it('SORT_VALUES 상수', () => {
    expect(SORT_VALUES).toEqual(['newest', 'oldest']);
  });
});
