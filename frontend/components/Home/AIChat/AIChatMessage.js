import ReactMarkdown from 'react-markdown';
import { Bookmark } from 'lucide-react';

export default function AIChatMessage({ message, onTogglePin, isStreaming }) {
  const isUser = message.role === 'user';
  const isPinned = message.is_pinned;

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`AIChatMessage AIChatMessage--${message.role}`}>
      <div className="AIChatMessage__Bubble">
        {isUser ? (
          message.content
        ) : (
          <div className="AIChatMessage__Markdown">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {isStreaming && <span className="AIChatMessage__Cursor" />}
      </div>
      <div className="AIChatMessage__Meta">
        {!isUser && message.message_id && (
          <div className={`AIChatMessage__Actions ${isPinned ? 'AIChatMessage__Actions--visible' : ''}`}>
            <button
              className={`AIChatMessage__PinBtn ${isPinned ? 'AIChatMessage__PinBtn--pinned' : ''}`}
              onClick={() => onTogglePin?.(message.message_id)}
              type="button"
            >
              <Bookmark size={13} fill={isPinned ? 'currentColor' : 'none'} />
            </button>
          </div>
        )}
        <span className="AIChatMessage__Time">{formatTime(message.created_at)}</span>
      </div>
    </div>
  );
}
