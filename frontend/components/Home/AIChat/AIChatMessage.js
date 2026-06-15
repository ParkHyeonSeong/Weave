import ReactMarkdown from 'react-markdown';
import { Bookmark } from 'lucide-react';
import { useLightbox } from '@/components/common/LightboxProvider';
import { deriveFilename } from '@/library/lightboxImages';

export default function AIChatMessage({ message, onTogglePin, isStreaming }) {
  const { open: openLightbox } = useLightbox();
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
            <ReactMarkdown
              components={{
                img: ({ node, ...props }) => (
                  <img
                    {...props}
                    style={{ cursor: 'zoom-in', maxWidth: '100%' }}
                    onClick={() =>
                      openLightbox([{ src: props.src, alt: props.alt || '', filename: deriveFilename(props.src, props.alt) }], 0)
                    }
                  />
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
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
