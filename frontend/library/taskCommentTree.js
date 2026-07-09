export const SORT_VALUES = ['newest', 'oldest'];

// created_at은 백엔드가 같은 포맷의 ISO 문자열로 직렬화하므로 사전순 비교로 충분
function byTime(a, b) {
  if (a.created_at === b.created_at) return a.comment_id - b.comment_id;
  return a.created_at < b.created_at ? -1 : 1;
}

/**
 * 평면 댓글 배열 → { roots, childrenByRoot } 렌더 트리.
 * API 배열 순서에 의존하지 않는다: root는 sortOrder('newest'|'oldest') 방향,
 * 답글은 항상 시간순 — 스레드 대화 흐름 보존.
 */
export function buildTree(comments, sortOrder) {
  const roots = [];
  const childrenByRoot = {};
  const rootIds = new Set();
  for (const c of comments) {
    if (c.parent_comment_id == null) {
      roots.push(c);
      childrenByRoot[c.comment_id] = [];
      rootIds.add(c.comment_id);
    }
  }
  for (const c of comments) {
    if (c.parent_comment_id != null && rootIds.has(c.parent_comment_id)) {
      childrenByRoot[c.parent_comment_id].push(c);
    }
  }
  roots.sort(byTime);
  if (sortOrder === 'newest') roots.reverse();
  for (const id of rootIds) childrenByRoot[id].sort(byTime);
  return { roots, childrenByRoot };
}
