import { useState, useMemo } from 'react';
import useTaskComments from '@/hooks/useTaskComments';
import CommentItem from './CommentItem';
import CommentEditor from './CommentEditor';

/**
 * TaskDetailPanel 내부에 들어가는 댓글 섹션.
 *
 * Props:
 *   - branchId
 *   - taskId
 *   - members: [{user_id, username, avatar_url}]
 *   - currentUserId
 *   - highlightCommentId (optional, Slice 7) — 알림 클릭 시 스크롤/하이라이트 대상
 */
export default function TaskCommentSection({
  branchId, taskId, members, currentUserId, highlightCommentId = null,
}) {
  const { comments, loading, createComment, updateComment, deleteComment } =
    useTaskComments(branchId, taskId);

  const { roots, childrenByRoot } = useMemo(() => buildTree(comments), [comments]);

  // Slice 7에서 useEffect로 토글; 일단 false 유지
  const [highlightActive] = useState(false);

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
      <div className="TaskCommentSection__Header">Comments</div>

      <div className="TaskCommentSection__Composer">
        <CommentEditor
          key={composerKey}
          placeholder="댓글을 작성하세요..."
          branchId={branchId}
          onSubmit={handleCreateTop}
        />
      </div>

      <div className="TaskCommentSection__List">
        {loading && comments.length === 0 && (
          <div className="TaskCommentSection__Empty">Loading...</div>
        )}
        {!loading && comments.length === 0 && (
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

function buildTree(comments) {
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
  // 자식들도 created_at ASC가 보장됨 (백엔드 ORDER BY created_at ASC)
  return { roots, childrenByRoot };
}
