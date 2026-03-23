import { useState, useRef, useEffect } from 'react';
import { X, Check, RotateCcw, Trash2, MoreHorizontal, MessageSquare } from 'lucide-react';
import { sanitizeHtml } from '@/library/sanitize';
import IssueEditor from '@/components/Branch/Tasks/IssueEditor';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getInitial(name) {
  return (name || '?')[0].toUpperCase();
}


export default function AnnotationSidebar({
  annotations,
  isOpen,
  onClose,
  onResolve,
  onReopen,
  onDelete,
  onCreateReply,
  onUpdateReply,
  onDeleteReply,
  activeAnnotationId,
  onAnnotationSelect,
  // 새 코멘트 작성 모드
  newAnnotationData,
  onSubmitNewAnnotation,
  onCancelNewAnnotation,
}) {
  const [tab, setTab] = useState('open');
  const [replyingTo, setReplyingTo] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const newCommentRef = useRef(null);
  const replyEditorRef = useRef(null);
  const sidebarRef = useRef(null);

  const myProfile = typeof window !== 'undefined'
    ? JSON.parse(sessionStorage.getItem('profile') || '{}')
    : {};

  const filtered = annotations.filter((a) =>
    tab === 'open' ? a.status === 'open' : a.status === 'resolved'
  );

  const openCount = annotations.filter((a) => a.status === 'open').length;
  const resolvedCount = annotations.filter((a) => a.status === 'resolved').length;

  // 새 코멘트 작성 모드 진입 시 탭 전환 + 스크롤
  useEffect(() => {
    if (newAnnotationData) {
      setTab('open');
    }
  }, [newAnnotationData]);

  // activeAnnotationId 변경 시 해당 카드로 스크롤
  useEffect(() => {
    if (activeAnnotationId && sidebarRef.current) {
      const card = sidebarRef.current.querySelector(
        `[data-annotation-id="${activeAnnotationId}"]`
      );
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeAnnotationId]);

  const handleSubmitNew = async () => {
    if (!newCommentRef.current || newCommentRef.current.isEmpty()) return;
    const html = newCommentRef.current.getHTML();
    if (onSubmitNewAnnotation) {
      await onSubmitNewAnnotation(html);
    }
  };

  const handleSubmitReply = async (annotationId) => {
    if (!replyEditorRef.current || replyEditorRef.current.isEmpty()) return;
    const html = replyEditorRef.current.getHTML();
    await onCreateReply(annotationId, html);
    replyEditorRef.current.clearContent();
    setReplyingTo(null);
  };

  if (!isOpen) return null;

  return (
    <div className="AnnotationSidebar">
      <div className="AnnotationSidebar__Header">
        <h3 className="AnnotationSidebar__Title">Comments</h3>
        <button className="AnnotationSidebar__Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="AnnotationSidebar__Tabs">
        <button
          className={`AnnotationSidebar__Tab${tab === 'open' ? ' AnnotationSidebar__Tab--active' : ''}`}
          onClick={() => setTab('open')}
        >
          Open ({openCount})
        </button>
        <button
          className={`AnnotationSidebar__Tab${tab === 'resolved' ? ' AnnotationSidebar__Tab--active' : ''}`}
          onClick={() => setTab('resolved')}
        >
          Resolved ({resolvedCount})
        </button>
      </div>

      <div className="AnnotationSidebar__List" ref={sidebarRef}>
        {/* 새 코멘트 작성 폼 */}
        {newAnnotationData && tab === 'open' && (
          <div className="AnnotationSidebar__Card AnnotationSidebar__Card--new">
            <div className="AnnotationSidebar__Quote">
              "{newAnnotationData.quoted_text.length > 80
                ? newAnnotationData.quoted_text.slice(0, 80) + '...'
                : newAnnotationData.quoted_text}"
            </div>
            <div className="AnnotationSidebar__NewEditor">
              <IssueEditor ref={newCommentRef} placeholder="Write a comment..." minHeight={80} />
              <div className="AnnotationSidebar__NewActions">
                <button
                  className="AnnotationSidebar__Btn AnnotationSidebar__Btn--secondary"
                  onClick={onCancelNewAnnotation}
                >
                  Cancel
                </button>
                <button
                  className="AnnotationSidebar__Btn AnnotationSidebar__Btn--primary"
                  onClick={handleSubmitNew}
                >
                  Comment
                </button>
              </div>
            </div>
          </div>
        )}

        {filtered.length === 0 && !newAnnotationData && (
          <div className="AnnotationSidebar__Empty">
            <MessageSquare size={24} />
            <span>{tab === 'open' ? 'No open comments' : 'No resolved comments'}</span>
          </div>
        )}

        {filtered.map((ann) => (
          <div
            key={ann.annotation_id}
            className={`AnnotationSidebar__Card${
              activeAnnotationId === ann.annotation_id ? ' AnnotationSidebar__Card--active' : ''
            }`}
            data-annotation-id={ann.annotation_id}
            onClick={() => onAnnotationSelect?.(ann.annotation_id)}
          >
            {/* 인용 텍스트 */}
            <div className="AnnotationSidebar__Quote">
              "{ann.quoted_text.length > 80
                ? ann.quoted_text.slice(0, 80) + '...'
                : ann.quoted_text}"
            </div>

            {/* 답글들 */}
            <div className="AnnotationSidebar__Replies">
              {(ann.replies || []).map((reply) => (
                <div key={reply.reply_id} className="AnnotationSidebar__Reply">
                  <div className="AnnotationSidebar__ReplyHeader">
                    <div className="AnnotationSidebar__Avatar">
                      {getInitial(reply.author_name)}
                    </div>
                    <span className="AnnotationSidebar__AuthorName">{reply.author_name}</span>
                    <span className="AnnotationSidebar__Time">{timeAgo(reply.created_at)}</span>

                    {reply.author_id === myProfile.user_id && (
                      <div className="AnnotationSidebar__ReplyMenu">
                        <button
                          className="AnnotationSidebar__MenuBtn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenId(menuOpenId === reply.reply_id ? null : reply.reply_id);
                          }}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {menuOpenId === reply.reply_id && (
                          <div className="AnnotationSidebar__MenuDropdown">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteReply(ann.annotation_id, reply.reply_id);
                                setMenuOpenId(null);
                              }}
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div
                    className="AnnotationSidebar__ReplyContent"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(reply.content) }}
                  />
                </div>
              ))}
            </div>

            {/* 하단 액션 */}
            <div className="AnnotationSidebar__CardActions">
              {replyingTo === ann.annotation_id ? (
                <div className="AnnotationSidebar__ReplyEditor">
                  <IssueEditor ref={replyEditorRef} placeholder="Reply..." minHeight={60} />
                  <div className="AnnotationSidebar__NewActions">
                    <button
                      className="AnnotationSidebar__Btn AnnotationSidebar__Btn--secondary"
                      onClick={(e) => { e.stopPropagation(); setReplyingTo(null); }}
                    >
                      Cancel
                    </button>
                    <button
                      className="AnnotationSidebar__Btn AnnotationSidebar__Btn--primary"
                      onClick={(e) => { e.stopPropagation(); handleSubmitReply(ann.annotation_id); }}
                    >
                      Reply
                    </button>
                  </div>
                </div>
              ) : (
                <div className="AnnotationSidebar__ActionBtns">
                  <button
                    className="AnnotationSidebar__ActionBtn"
                    onClick={(e) => { e.stopPropagation(); setReplyingTo(ann.annotation_id); }}
                  >
                    Reply
                  </button>
                  {ann.status === 'open' ? (
                    <button
                      className="AnnotationSidebar__ActionBtn AnnotationSidebar__ActionBtn--resolve"
                      onClick={(e) => { e.stopPropagation(); onResolve(ann.annotation_id); }}
                      title="Resolve"
                    >
                      <Check size={14} /> Resolve
                    </button>
                  ) : (
                    <button
                      className="AnnotationSidebar__ActionBtn"
                      onClick={(e) => { e.stopPropagation(); onReopen(ann.annotation_id); }}
                      title="Reopen"
                    >
                      <RotateCcw size={14} /> Reopen
                    </button>
                  )}
                  {ann.created_by === myProfile.user_id && (
                    <button
                      className="AnnotationSidebar__ActionBtn AnnotationSidebar__ActionBtn--danger"
                      onClick={(e) => { e.stopPropagation(); onDelete(ann.annotation_id); }}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
