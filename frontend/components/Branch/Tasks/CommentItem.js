import { useState, useMemo, useRef, memo } from 'react';
import { Reply, Pencil, Copy, Trash2 } from 'lucide-react';
import { sanitizeHtml } from '@/library/sanitize';
import { useRefHydration } from '@/library/refHydration';
import { useMathHydration } from '@/library/mathRender';
import { formatRelative } from '@/library/formatTime';
import Avatar from '@/components/common/Avatar';
import { buildMentionHtml } from '@/components/Canvas/extensions/MentionExtension';
import ConfirmModal from '@/components/modal/ConfirmModal';
import CommentEditor from './CommentEditor';
import { buildCommentEditorExtensions } from './commentEditorExtensions';
import { showToast } from '@/components/Layout/Toast';
import { htmlToMarkdown } from '@/library/markdownCodec';
import { ensureRenderableHtml } from '@/library/ensureHtml';

/**
 * 단일 댓글 컴포넌트. 본인/타인 공용.
 *
 * Props:
 *   - comment: { comment_id, parent_comment_id, content, is_edited, is_deleted,
 *                created_at, updated_at, author: {user_id, username, avatar_url},
 *                mentioned_user_ids }
 *   - replies: [comment...] — 이 댓글의 자식들 (depth 1; 더 깊은 nesting 없음)
 *   - currentUserId
 *   - branchId
 *   - members: [{user_id, username, avatar_url}]
 *   - onUpdate(commentId, content) — 본인 수정
 *   - onDelete(commentId) — 본인 삭제 (soft)
 *   - onReply(content, parentRootId) — 답글. parentRootId는 항상 root의 id; 백엔드가 normalize 처리.
 *   - rootForReplies: { comment_id } — 답글이 부착될 root (depth 1에서 답글 클릭 시 root로 redirect)
 *   - depth: 0 (root) | 1 (reply)
 *   - highlightCommentId: number | null
 *   - highlightActive: bool
 */

function logError(label, e) {
  console.error(`${label} failed`, e);
}

function CommentItem({
  comment,
  replies = [],
  currentUserId,
  branchId,
  members,
  onUpdate,
  onDelete,
  onReply,
  rootForReplies,
  depth = 0,
  highlightCommentId = null,
  highlightActive = false,
}) {
  const [editing, setEditing] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isMine = !comment.is_deleted && comment.author?.user_id === currentUserId;
  const isHighlighted = highlightActive && highlightCommentId === comment.comment_id;

  const displayName = comment.author?.username ?? 'unknown';

  // 답글 prefill: Reply 클릭 시 대상 댓글 작성자를 자동 멘션 (본인 댓글엔 안 넣음)
  const replyPrefill = useMemo(() => {
    if (!comment.author || comment.author.user_id === currentUserId) return '<p></p>';
    return `<p>${buildMentionHtml(comment.author)}&nbsp;</p>`;
  }, [comment.author, currentUserId]);

  const sanitizedContent = useMemo(
    () => sanitizeHtml(comment.content || ''),
    [comment.content],
  );

  // readonly 본문의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  const contentRef = useRef(null);
  useRefHydration(contentRef, [comment.content, editing], !editing);
  useMathHydration(contentRef, [comment.content, editing], !editing);

  const handleSubmitEdit = async (html) => {
    try {
      await onUpdate(comment.comment_id, html);
      setEditing(false);
    } catch (e) { logError('Update comment', e); }
  };

  const handleSubmitReply = async (html) => {
    try {
      await onReply(html, rootForReplies?.comment_id ?? comment.comment_id);
      setReplyOpen(false);
    } catch (e) { logError('Reply', e); }
  };

  const handleConfirmDelete = async () => {
    setConfirmDelete(false);
    try {
      await onDelete(comment.comment_id);
    } catch (e) { logError('Delete comment', e); }
  };

  const handleCopyMarkdown = async () => {
    try {
      const md = htmlToMarkdown(ensureRenderableHtml(comment.content) || '', buildCommentEditorExtensions());
      await navigator.clipboard.writeText(md);
      showToast('Markdown이 복사되었습니다');
    } catch {
      showToast('Markdown 복사에 실패했습니다', 'error');
    }
  };

  return (
    <div
      id={`comment-${comment.comment_id}`}
      className={`CommentItem CommentItem--depth-${depth}${isHighlighted ? ' CommentItem--highlight' : ''}`}
    >
      <div className="CommentItem__AvatarCol">
        <Avatar user={comment.author} size="sm" />
      </div>
      <div className="CommentItem__Body">
        <div className="CommentItem__Header">
          <span className="CommentItem__Author">{displayName}</span>
          <span className="CommentItem__Time">{formatRelative(comment.created_at)}</span>
          {comment.is_edited && !comment.is_deleted && (
            <span className="CommentItem__Edited">(edited)</span>
          )}
          {!comment.is_deleted && (
            <div className="CommentItem__Actions">
              <button
                type="button"
                className="CommentItem__ActionBtn"
                onClick={() => setReplyOpen((v) => !v)}
                title="Reply"
              >
                <Reply size={12} />
              </button>
              <button
                type="button"
                className="CommentItem__ActionBtn"
                onClick={handleCopyMarkdown}
                title="Copy as Markdown"
              >
                <Copy size={12} />
              </button>
              {isMine && (
                <>
                  <button
                    type="button"
                    className="CommentItem__ActionBtn"
                    onClick={() => setEditing(true)}
                    title="Edit"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="CommentItem__ActionBtn"
                    onClick={() => setConfirmDelete(true)}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {comment.is_deleted ? (
          <div className="CommentItem__Tombstone">이 댓글은 삭제되었습니다</div>
        ) : editing ? (
          <CommentEditor
            initialContent={comment.content}
            branchId={branchId}
            autoFocus
            onSubmit={handleSubmitEdit}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div
            ref={contentRef}
            className="CommentItem__Content"
            dangerouslySetInnerHTML={{ __html: sanitizedContent }}
          />
        )}

        {replyOpen && !comment.is_deleted && (
          <div className="CommentItem__ReplyComposer">
            <CommentEditor
              initialContent={replyPrefill}
              placeholder="Reply..."
              branchId={branchId}
              autoFocus
              onSubmit={handleSubmitReply}
              onCancel={() => setReplyOpen(false)}
            />
          </div>
        )}

        {replies.length > 0 && (
          <div className="CommentItem__Replies">
            {replies.map((r) => (
              <CommentItem
                key={r.comment_id}
                comment={r}
                replies={[]}
                currentUserId={currentUserId}
                branchId={branchId}
                members={members}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onReply={onReply}
                rootForReplies={rootForReplies ?? comment}
                depth={1}
                highlightCommentId={highlightCommentId}
                highlightActive={highlightActive}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Comment"
        message="이 댓글을 삭제하시겠습니까? 답글이 있으면 빈 자리(tombstone)로 남습니다."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}

export default memo(CommentItem);
