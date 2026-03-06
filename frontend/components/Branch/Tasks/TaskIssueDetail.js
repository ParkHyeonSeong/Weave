import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, CircleDot, MoreHorizontal, Pencil, Trash2, Check, X, XCircle, CheckCircle2 } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function TaskIssueDetail() {
  const router = useRouter();
  const { id: branchId, taskId, issueId } = router.query;

  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 제목/본문 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [editingBody, setEditingBody] = useState(false);
  const [bodyValue, setBodyValue] = useState('');

  // 댓글 편집
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editCommentValue, setEditCommentValue] = useState('');

  // 메뉴
  const [openMenuId, setOpenMenuId] = useState(null);

  const myProfile = typeof window !== 'undefined'
    ? JSON.parse(sessionStorage.getItem('profile') || '{}')
    : {};

  const fetchIssue = async () => {
    if (!branchId || !taskId || !issueId) return;
    setLoading(true);
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`);
      if (res.data.status) {
        setIssue(res.data.issue);
        setComments(res.data.comments || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchIssue();
  }, [branchId, taskId, issueId]);

  // 상태 토글
  const toggleStatus = async () => {
    const newStatus = issue.status === 'open' ? 'closed' : 'open';
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`, {
        status: newStatus,
      });
      if (res.data.status) {
        setIssue((prev) => ({ ...prev, status: newStatus }));
        window.dispatchEvent(new Event('issue:updated'));
      }
    } catch {}
  };

  // 제목 저장
  const saveTitle = async () => {
    if (!titleValue.trim() || titleValue.trim() === issue.title) {
      setEditingTitle(false);
      return;
    }
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`, {
        title: titleValue.trim(),
      });
      if (res.data.status) {
        setIssue((prev) => ({ ...prev, title: titleValue.trim() }));
        window.dispatchEvent(new Event('issue:updated'));
      }
    } catch {}
    setEditingTitle(false);
  };

  // 본문 저장
  const saveBody = async () => {
    const val = bodyValue.trim() || null;
    if (val === (issue.body || null)) {
      setEditingBody(false);
      return;
    }
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`, {
        body: val,
      });
      if (res.data.status) {
        setIssue((prev) => ({ ...prev, body: val, updated_at: new Date().toISOString() }));
      }
    } catch {}
    setEditingBody(false);
  };

  // 댓글 추가
  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await axios.post(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}/comments`, {
        content: newComment.trim(),
      });
      if (res.data.status) {
        setNewComment('');
        fetchIssue();
      }
    } catch {}
    setSubmitting(false);
  };

  // 댓글 수정
  const saveComment = async (commentId) => {
    if (!editCommentValue.trim()) return;
    try {
      const res = await axios.patch(
        `/branches/${branchId}/tasks/${taskId}/issues/${issueId}/comments/${commentId}`,
        { content: editCommentValue.trim() }
      );
      if (res.data.status) {
        setComments((prev) =>
          prev.map((c) => c.comment_id === commentId
            ? { ...c, content: editCommentValue.trim(), updated_at: new Date().toISOString() }
            : c
          )
        );
      }
    } catch {}
    setEditingCommentId(null);
  };

  // 댓글 삭제
  const deleteComment = async (commentId) => {
    try {
      const res = await axios.delete(
        `/branches/${branchId}/tasks/${taskId}/issues/${issueId}/comments/${commentId}`
      );
      if (res.data.status) {
        setComments((prev) => prev.filter((c) => c.comment_id !== commentId));
      }
    } catch {}
  };

  // 이슈 삭제
  const deleteIssue = async () => {
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${taskId}/issues/${issueId}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('issue:deleted'));
        router.push(`/branch/${branchId}/task/${taskId}`);
      }
    } catch {}
  };

  if (loading || !issue) {
    return <div className="IssueDetail"><div className="IssueDetail__Loading">Loading...</div></div>;
  }

  const isAuthor = myProfile.user_id === issue.created_by;

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isEdited = (item) => item.updated_at && item.updated_at !== item.created_at;
  const getInitial = (name) => (name || '?')[0].toUpperCase();

  return (
    <div className="IssueDetail">
      {/* 헤더 */}
      <div className="IssueDetail__Header">
        <button
          className="IssueDetail__BackBtn"
          onClick={() => router.push(`/branch/${branchId}/task/${taskId}`)}
        >
          <ArrowLeft size={16} />
          Back to task
        </button>
      </div>

      {/* 제목 + 이슈 번호 */}
      <div className="IssueDetail__TitleArea">
        {editingTitle ? (
          <div className="IssueDetail__TitleEdit">
            <input
              className="IssueDetail__TitleInput"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              autoFocus
            />
            <div className="IssueDetail__TitleEditActions">
              <button className="IssueDetail__TitleSaveBtn" onClick={saveTitle}>Save</button>
              <button className="IssueDetail__TitleCancelBtn" onClick={() => setEditingTitle(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="IssueDetail__TitleRow">
            <h1 className="IssueDetail__Title">
              {issue.title}
              <span className="IssueDetail__IssueNumber">#{issue.issue_id}</span>
            </h1>
            {isAuthor && (
              <button
                className="IssueDetail__TitleEditBtn"
                onClick={() => { setTitleValue(issue.title); setEditingTitle(true); }}
              >
                Edit
              </button>
            )}
          </div>
        )}

        {/* 상태 뱃지 + 메타 */}
        <div className="IssueDetail__Meta">
          <span className={`IssueDetail__StatusBadge IssueDetail__StatusBadge--${issue.status}`}>
            {issue.status === 'open' ? <CircleDot size={14} /> : <CheckCircle2 size={14} />}
            {issue.status === 'open' ? 'Open' : 'Closed'}
          </span>
          <span className="IssueDetail__MetaText">
            <strong>{issue.author_name}</strong> opened this issue {formatDate(issue.created_at)}
            {' '}&middot; {comments.length} comment{comments.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="IssueDetail__Divider" />

      {/* 타임라인: 본문 + 댓글 */}
      <div className="IssueDetail__Timeline">
        {/* 본문 카드 (OP) */}
        <div className="IssueDetail__TimelineItem">
          <div className="IssueDetail__Avatar" title={issue.author_name}>
            {getInitial(issue.author_name)}
          </div>
          <div className={`IssueDetail__Card IssueDetail__Card--op`}>
            <div className="IssueDetail__CardHeader">
              <span className="IssueDetail__CardAuthor">{issue.author_name}</span>
              <span className="IssueDetail__CardTime">
                {formatDate(issue.created_at)}
                {isEdited(issue) && <span className="IssueDetail__Edited"> &middot; edited</span>}
              </span>
              <span className="IssueDetail__OpBadge">Author</span>
              {isAuthor && (
                <DropdownMenu
                  id="issue-body"
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  onEdit={() => { setBodyValue(issue.body || ''); setEditingBody(true); }}
                  onDelete={deleteIssue}
                  deleteLabel="Delete issue"
                />
              )}
            </div>
            {editingBody ? (
              <div className="IssueDetail__CardEditBody">
                <textarea
                  className="IssueDetail__CardTextarea"
                  value={bodyValue}
                  onChange={(e) => setBodyValue(e.target.value)}
                  rows={6}
                  autoFocus
                />
                <div className="IssueDetail__CardEditActions">
                  <button className="IssueDetail__SaveBtn" onClick={saveBody}>Update comment</button>
                  <button className="IssueDetail__CancelBtn" onClick={() => setEditingBody(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className={`IssueDetail__CardBody ${!issue.body ? 'IssueDetail__CardBody--empty' : ''}`}>
                {issue.body || (isAuthor ? 'No description provided yet.' : 'No description provided.')}
              </div>
            )}
          </div>
        </div>

        {/* 댓글 */}
        {comments.map((comment) => {
          const isCommentAuthor = myProfile.user_id === comment.author_id;
          const isEditingThis = editingCommentId === comment.comment_id;
          const isIssueAuthor = comment.author_id === issue.created_by;

          return (
            <div key={comment.comment_id} className="IssueDetail__TimelineItem">
              <div className="IssueDetail__Avatar" title={comment.author_name}>
                {getInitial(comment.author_name)}
              </div>
              <div className="IssueDetail__Card">
                <div className="IssueDetail__CardHeader">
                  <span className="IssueDetail__CardAuthor">{comment.author_name}</span>
                  <span className="IssueDetail__CardTime">
                    {formatDate(comment.created_at)}
                    {isEdited(comment) && <span className="IssueDetail__Edited"> &middot; edited</span>}
                  </span>
                  {isIssueAuthor && <span className="IssueDetail__OpBadge">Author</span>}
                  {isCommentAuthor && !isEditingThis && (
                    <DropdownMenu
                      id={`comment-${comment.comment_id}`}
                      openMenuId={openMenuId}
                      setOpenMenuId={setOpenMenuId}
                      onEdit={() => { setEditingCommentId(comment.comment_id); setEditCommentValue(comment.content); }}
                      onDelete={() => deleteComment(comment.comment_id)}
                      deleteLabel="Delete"
                    />
                  )}
                </div>
                {isEditingThis ? (
                  <div className="IssueDetail__CardEditBody">
                    <textarea
                      className="IssueDetail__CardTextarea"
                      value={editCommentValue}
                      onChange={(e) => setEditCommentValue(e.target.value)}
                      rows={4}
                      autoFocus
                    />
                    <div className="IssueDetail__CardEditActions">
                      <button className="IssueDetail__SaveBtn" onClick={() => saveComment(comment.comment_id)}>Update comment</button>
                      <button className="IssueDetail__CancelBtn" onClick={() => setEditingCommentId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="IssueDetail__CardBody">{comment.content}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 상태 토글 + 댓글 입력 */}
      <div className="IssueDetail__ReplyArea">
        <div className="IssueDetail__Avatar IssueDetail__Avatar--sm" title={myProfile.username}>
          {getInitial(myProfile.username)}
        </div>
        <form className="IssueDetail__ReplyForm" onSubmit={handleAddComment}>
          <textarea
            className="IssueDetail__ReplyInput"
            placeholder="Leave a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={4}
          />
          <div className="IssueDetail__ReplyActions">
            <button
              type="button"
              className={`IssueDetail__StatusToggle IssueDetail__StatusToggle--${issue.status === 'open' ? 'close' : 'reopen'}`}
              onClick={toggleStatus}
            >
              {issue.status === 'open' ? <XCircle size={14} /> : <CircleDot size={14} />}
              {issue.status === 'open' ? 'Close issue' : 'Reopen issue'}
            </button>
            <button
              type="submit"
              className="IssueDetail__ReplySubmit"
              disabled={!newComment.trim() || submitting}
            >
              {submitting ? 'Commenting...' : 'Comment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- 드롭다운 메뉴 ---
function DropdownMenu({ id, openMenuId, setOpenMenuId, onEdit, onDelete, deleteLabel }) {
  const ref = useRef(null);
  const isOpen = openMenuId === id;

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  return (
    <div className="IssueDetail__MenuWrap" ref={ref}>
      <button
        className="IssueDetail__MenuBtn"
        onClick={() => setOpenMenuId(isOpen ? null : id)}
      >
        <MoreHorizontal size={14} />
      </button>
      {isOpen && (
        <div className="IssueDetail__MenuDropdown">
          <button
            className="IssueDetail__MenuItem"
            onClick={() => { setOpenMenuId(null); onEdit(); }}
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            className="IssueDetail__MenuItem IssueDetail__MenuItem--danger"
            onClick={() => { setOpenMenuId(null); onDelete(); }}
          >
            <Trash2 size={12} />
            {deleteLabel}
          </button>
        </div>
      )}
    </div>
  );
}
