import { useState, useEffect, useMemo } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import useTaskComments from '@/hooks/useTaskComments';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { buildTree, SORT_VALUES } from '@/library/taskCommentTree';
import CommentItem from './CommentItem';
import CommentEditor from './CommentEditor';

// sortOrder('newest'|'oldest') → 서버 order 파라미터('desc'|'asc')
const API_ORDER_BY_SORT = { newest: 'desc', oldest: 'asc' };

// sortOrder → 정렬 토글 버튼 표시(아이콘/라벨/aria-label)
const SORT_BUTTON_META = {
  newest: { Icon: ArrowDown, label: '최신순', ariaLabel: '최신순 — 클릭하면 오래된순' },
  oldest: { Icon: ArrowUp, label: '오래된순', ariaLabel: '오래된순 — 클릭하면 최신순' },
};

/**
 * TaskDetailPanel 내부에 들어가는 댓글 섹션.
 *
 * Props:
 *   - branchId
 *   - taskId
 *   - members: [{user_id, username, avatar_url}]
 *   - currentUserId
 *   - highlightCommentId (optional, Slice 7) — 알림 클릭 시 스크롤/하이라이트 대상
 *
 * 정렬: root 댓글은 사용자 선호(ui_prefs.comment_sort, 기본 최신순),
 * 답글은 항상 스레드 내 시간순. 선호는 prefs에서 파생(복사 금지)하고,
 * 로드 전에는 order=null로 fetch를 미뤄 새로고침 시 잘못된 순서 플래시를 막는다.
 */
export default function TaskCommentSection({
  branchId, taskId, members, currentUserId, highlightCommentId = null,
}) {
  const { prefs, loaded, setNamespace } = useUiPrefs();
  // 토글로 바꾼 값(세션 내 우선) — 초기 prefs 로드가 늦게 resolve해도 사용자 조작을 덮어쓰지 않는다
  const [override, setOverride] = useState(null);
  const persisted = SORT_VALUES.includes(prefs.comment_sort) ? prefs.comment_sort : 'newest';
  const sortOrder = override ?? persisted;

  const toggleSort = () => {
    const next = sortOrder === 'newest' ? 'oldest' : 'newest';
    setOverride(next);
    setNamespace('comment_sort', next);
  };

  // 선호 로드 전에는 null → useTaskComments가 fetch를 미룬다
  const apiOrder = loaded ? API_ORDER_BY_SORT[sortOrder] : null;

  const { comments, loading, createComment, updateComment, deleteComment } =
    useTaskComments(branchId, taskId, apiOrder);

  const { roots, childrenByRoot } = useMemo(
    () => buildTree(comments, sortOrder), [comments, sortOrder],
  );

  // fetch 게이트 중(order=null)에는 loading=false지만 빈 상태 문구를 내면 안 된다
  const pending = loading || apiOrder == null;

  const sortButtonMeta = SORT_BUTTON_META[sortOrder];
  const SortIcon = sortButtonMeta.Icon;

  const [highlightActive, setHighlightActive] = useState(false);

  useEffect(() => {
    if (!highlightCommentId || comments.length === 0) return;
    const el = document.getElementById(`comment-${highlightCommentId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightActive(true);
    const t = setTimeout(() => setHighlightActive(false), 2000);
    return () => clearTimeout(t);
  }, [highlightCommentId, comments]);

  // 최상위 composer는 submit 후 unmount/remount로 비워진다 (답글/edit composer는 cancel로 닫히므로 영향 없음)
  const [composerKey, setComposerKey] = useState(0);

  const handleCreateTop = async (html) => {
    try {
      await createComment(html, null);
      setComposerKey((k) => k + 1);
    } catch (e) {
      console.error('Create comment failed', e);
    }
  };

  const handleReply = async (html, parentRootId) => {
    try {
      await createComment(html, parentRootId);
    } catch (e) {
      console.error('Reply failed', e);
    }
  };

  return (
    <div className="TaskCommentSection">
      <div className="TaskCommentSection__Header">
        <span>Comments</span>
        <button
          type="button"
          className="TaskCommentSection__SortBtn"
          onClick={toggleSort}
          aria-label={sortButtonMeta.ariaLabel}
        >
          <SortIcon size={12} />
          {sortButtonMeta.label}
        </button>
      </div>

      <div className="TaskCommentSection__Composer">
        <CommentEditor
          key={composerKey}
          placeholder="댓글을 작성하세요..."
          branchId={branchId}
          onSubmit={handleCreateTop}
        />
      </div>

      <div className="TaskCommentSection__List">
        {pending && comments.length === 0 && (
          <div className="TaskCommentSection__Empty">Loading...</div>
        )}
        {!pending && comments.length === 0 && (
          <div className="TaskCommentSection__Empty">아직 댓글이 없습니다.</div>
        )}
        {roots.map((root) => (
          <CommentItem
            key={root.comment_id}
            comment={root}
            replies={childrenByRoot[root.comment_id] || []}
            currentUserId={currentUserId}
            branchId={branchId}
            members={members}
            onUpdate={updateComment}
            onDelete={deleteComment}
            onReply={handleReply}
            rootForReplies={root}
            depth={0}
            highlightCommentId={highlightCommentId}
            highlightActive={highlightActive}
          />
        ))}
      </div>
    </div>
  );
}
