import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { ArrowLeft, Send, Pencil, Check, X, Paperclip, File as FileIcon, Download } from 'lucide-react';
import { axios } from '@/library/_axios';
import { formatMessageTime } from '@/library/formatTime';
import Avatar from '@/components/common/Avatar';
import TaskSearchPopup from './TaskSearchPopup';
import TaskRefCard from './TaskRefCard';
import DocSearchPopup from './DocSearchPopup';
import DocRefCard from './DocRefCard';
import IssueSearchPopup from './IssueSearchPopup';
import IssueRefCard from './IssueRefCard';
import MentionSearchPopup from './MentionSearchPopup';
import SlashCommandMenu from '@/components/Canvas/extensions/SlashCommandMenu';
import { filterSlashCommands } from '@/components/Canvas/extensions/slashCommands';
import { useLightbox } from '@/components/common/LightboxProvider';
import { showToast } from '@/components/Layout/Toast';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const FILE_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip'];
const ALLOWED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...FILE_EXTENSIONS];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILES = 10;

// 백엔드 업로드 실패 코드 → 사용자 안내 메시지 (채팅은 이미지+문서 첨부)
function uploadErrorMessage(code) {
  switch (code) {
    case 'FILE_TOO_LARGE':
      return `파일이 ${MAX_FILE_SIZE_MB}MB를 초과해 첨부할 수 없습니다.`;
    case 'INVALID_FILE_TYPE':
    case 'INVALID_FILE_CONTENT':
      return '지원하지 않는 파일 형식입니다.';
    case 'NOT_A_MEMBER':
      return '파일을 업로드할 권한이 없습니다.';
    case 'NO_FILE':
      return '첨부할 파일을 찾을 수 없습니다.';
    default:
      return '파일 업로드에 실패했습니다.';
  }
}

const isImageType = (fileType) => fileType?.startsWith('image/');

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileExtension = (filename) => {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
};

export default function MessengerChatRoom({ roomId, wsRef, onBack, hideback, headerLeft, headerRight }) {
  const { open: openLightbox } = useLightbox();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [roomName, setRoomName] = useState('Chat');
  const [roomType, setRoomType] = useState('dm');
  const [members, setMembers] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [attachedTask, setAttachedTask] = useState(null);
  const [attachedDoc, setAttachedDoc] = useState(null);
  const [attachedIssue, setAttachedIssue] = useState(null);
  const [slashCommand, setSlashCommand] = useState(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuIdx, setSlashMenuIdx] = useState(0);
  const [mentionCommand, setMentionCommand] = useState(null);
  const [mentionedUserIds, setMentionedUserIds] = useState([]);
  const [myLastReadAt, setMyLastReadAt] = useState(null);
  const [showUnreadDivider, setShowUnreadDivider] = useState(true);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const messagesEndRef = useRef(null);
  const unreadDividerRef = useRef(null);
  const editInputRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const justSelectedRef = useRef(false);
  const isInitialLoadRef = useRef(true);
  const dragCounterRef = useRef(0);

  let myUserId = 0;
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    myUserId = profile.user_id || 0;
  } catch {}

  // 메시지 목록 로드
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await axios.get(`/chat/${roomId}/messages`);
        if (res.data.status) {
          const msgs = res.data.messages.reverse();
          setMessages(msgs);
          setRoomType(res.data.room_type || 'dm');
          setMyLastReadAt(res.data.my_last_read_at || null);
          setShowUnreadDivider(true);
          isInitialLoadRef.current = true;
          if (res.data.members) setMembers(res.data.members);
          if (res.data.room_type === 'dm' && res.data.members?.length) {
            setRoomName(res.data.members[0].username);
          } else if (res.data.room_name) {
            setRoomName(res.data.room_name);
          }
        }
      } catch {}
    };
    fetchMessages();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'mark_read', room_id: roomId }));
      window.dispatchEvent(new CustomEvent('chat:unread_changed'));
    }
  }, [roomId]);

  // WebSocket 메시지 수신
  useEffect(() => {
    const handleWsMessage = (e) => {
      const data = e.detail;
      if (data.type === 'new_message' && data.room_id === roomId) {
        setMessages((prev) => {
          if (prev.some((m) => m.message_id === data.message.message_id)) return prev;
          return [...prev, data.message];
        });
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: 'mark_read', room_id: roomId }));
          window.dispatchEvent(new CustomEvent('chat:unread_changed'));
        }
      }
      if (data.type === 'mark_read' && data.room_id === roomId && data.user_id !== myUserId) {
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === data.user_id ? { ...m, last_read_at: data.last_read_at } : m
          )
        );
      }
    };
    window.addEventListener('chat:ws_message', handleWsMessage);
    return () => window.removeEventListener('chat:ws_message', handleWsMessage);
  }, [roomId, myUserId]);

  // 스크롤
  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      if (unreadDividerRef.current) {
        unreadDividerRef.current.scrollIntoView({ behavior: 'instant', block: 'center' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }
      setTimeout(() => setShowUnreadDivider(false), 1500);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // textarea 높이 자동 조절
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  useEffect(() => {
    autoResize();
  }, [input]);

  const isCodeMode = (input.match(/```/g) || []).length % 2 === 1;

  // -- 파일 업로드 --
  const uploadFile = useCallback(async (file) => {
    const ext = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      showToast(uploadErrorMessage('INVALID_FILE_TYPE'), 'error');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showToast(uploadErrorMessage('FILE_TOO_LARGE'), 'error');
      return;
    }

    const tempId = `${Date.now()}_${Math.random()}`;
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;

    setPendingFiles((prev) => {
      if (prev.length >= MAX_FILES) {
        if (preview) URL.revokeObjectURL(preview);
        return prev;
      }
      return [...prev, {
        id: tempId, file_name: file.name, file_type: file.type,
        file_size: file.size, preview, status: 'uploading', progress: 0,
      }];
    });

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`/chat/upload?room_id=${roomId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setPendingFiles((prev) =>
              prev.map((f) => f.id === tempId ? { ...f, progress: pct } : f)
            );
          }
        },
      });
      if (res.data.status) {
        setPendingFiles((prev) =>
          prev.map((f) => f.id === tempId ? {
            ...f, status: 'done', progress: 100,
            url: res.data.url, file_name: res.data.file_name,
            file_type: res.data.file_type, file_size: res.data.file_size,
          } : f)
        );
      } else {
        showToast(uploadErrorMessage(res.data?.message), 'error');
        setPendingFiles((prev) => prev.filter((f) => f.id !== tempId));
      }
    } catch {
      showToast(uploadErrorMessage(), 'error');
      setPendingFiles((prev) => prev.filter((f) => f.id !== tempId));
    }
  }, [roomId]);

  const handleFilesSelected = useCallback((files) => {
    Array.from(files).forEach((file) => uploadFile(file));
  }, [uploadFile]);

  const removePendingFile = (id) => {
    setPendingFiles((prev) => {
      const item = prev.find((f) => f.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // 클립보드 붙여넣기
  const handlePaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return; // 텍스트 붙여넣기는 기본 동작
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) uploadFile(file);
  }, [uploadFile]);

  // 드래그앤드롭
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes('Files')) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    files.forEach((file) => uploadFile(file));
  }, [uploadFile]);

  // -- 메시지 전송 --
  const handleSend = () => {
    if (isCodeMode) return;
    const isUploading = pendingFiles.some((f) => f.status === 'uploading');
    if (isUploading) return;

    const content = input.trim();
    const doneFiles = pendingFiles.filter((f) => f.status === 'done');
    if (!content && !attachedTask && !attachedDoc && !attachedIssue && doneFiles.length === 0) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const payload = { action: 'send_message', room_id: roomId, content };
      if (attachedTask) payload.task_id = attachedTask.task_id;
      if (attachedDoc) payload.canvas_page_id = attachedDoc.page_id;
      if (attachedIssue) payload.issue_id = attachedIssue.issue_id;
      if (mentionedUserIds.length > 0) payload.mentioned_user_ids = mentionedUserIds;
      if (doneFiles.length > 0) {
        payload.attachments = doneFiles.map((f) => ({
          url: f.url, file_name: f.file_name, file_type: f.file_type, file_size: f.file_size,
        }));
      }
      wsRef.current.send(JSON.stringify(payload));
    }
    setInput('');
    setAttachedTask(null);
    setAttachedDoc(null);
    setAttachedIssue(null);
    setSlashCommand(null);
    setMentionedUserIds([]);
    // preview URL 해제
    pendingFiles.forEach((f) => { if (f.preview) URL.revokeObjectURL(f.preview); });
    setPendingFiles([]);
  };

  const filteredSlashCommands = filterSlashCommands(input);

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (showSlashMenu && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenuIdx((prev) => Math.min(prev + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenuIdx((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSlashMenuSelect(filteredSlashCommands[slashMenuIdx].cmd);
        return;
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        return;
      }
    }
    if (justSelectedRef.current && e.key === 'Enter') {
      e.preventDefault();
      justSelectedRef.current = false;
      return;
    }
    if (mentionCommand && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    if (mentionCommand && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (slashCommand && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    if (slashCommand && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (isCodeMode || slashCommand) {
        // 코드모드 또는 검색중
      } else {
        if (!e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      }
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);

    if (val === '/') {
      setShowSlashMenu(true);
      setSlashMenuIdx(0);
      setSlashCommand(null);
      return;
    }

    if (val.match(/^\/ta\s/)) {
      setSlashCommand({ type: 'task', mode: 'all', keyword: val.slice(4) });
      setShowSlashMenu(false);
    } else if (val.match(/^\/t\s/)) {
      setSlashCommand({ type: 'task', mode: 'my', keyword: val.slice(3) });
      setShowSlashMenu(false);
    } else if (val.match(/^\/d\s/)) {
      setSlashCommand({ type: 'doc', keyword: val.slice(3) });
      setShowSlashMenu(false);
    } else if (val.match(/^\/i\s/)) {
      setSlashCommand({ type: 'issue', keyword: val.slice(3) });
      setShowSlashMenu(false);
    } else if (val.match(/^\/[tdia]?$/) || val.match(/^\/ta?$/)) {
      setShowSlashMenu(true);
      setSlashMenuIdx(0);
      if (slashCommand) setSlashCommand(null);
    } else {
      if (slashCommand) setSlashCommand(null);
      if (showSlashMenu) setShowSlashMenu(false);
    }

    const textarea = textareaRef.current;
    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = val.slice(0, cursorPos);
      const mentionMatch = textBeforeCursor.match(/(^|[\s])@(\S*)$/);
      if (mentionMatch && !slashCommand) {
        setMentionCommand({ keyword: mentionMatch[2] });
      } else {
        if (mentionCommand) setMentionCommand(null);
      }
    }
  };

  const handleSlashMenuSelect = (cmd) => {
    setInput(cmd + ' ');
    setShowSlashMenu(false);
    if (cmd === '/t') {
      setSlashCommand({ type: 'task', mode: 'my', keyword: '' });
    } else if (cmd === '/ta') {
      setSlashCommand({ type: 'task', mode: 'all', keyword: '' });
    } else if (cmd === '/d') {
      setSlashCommand({ type: 'doc', keyword: '' });
    } else if (cmd === '/i') {
      setSlashCommand({ type: 'issue', keyword: '' });
    }
    textareaRef.current?.focus();
  };

  const clearInputWithIME = () => {
    if (textareaRef.current) {
      textareaRef.current.blur();
      textareaRef.current.value = '';
    }
    setInput('');
    setSlashCommand(null);
    setTimeout(() => {
      justSelectedRef.current = false;
      textareaRef.current?.focus();
    }, 50);
  };

  const handleTaskSelect = (task) => {
    justSelectedRef.current = true;
    setAttachedTask({
      task_id: task.task_id, branch_id: task.branch_id,
      display_id: task.display_id, title: task.title,
      status: task.status, priority: task.priority,
      assignees: task.assignees || [],
      status_label: task.status_label, status_color: task.status_color,
      status_category: task.status_category,
    });
    clearInputWithIME();
  };

  const handleDocSelect = (doc) => {
    justSelectedRef.current = true;
    setAttachedDoc({
      page_id: doc.page_id, canvas_id: doc.canvas_id,
      title: doc.title, canvas_name: doc.canvas_name,
    });
    clearInputWithIME();
  };

  const handleIssueSelect = (issue) => {
    justSelectedRef.current = true;
    setAttachedIssue({
      issue_id: issue.issue_id, task_id: issue.task_id,
      branch_id: issue.branch_id, display_id: issue.display_id,
      title: issue.title, status: issue.status,
    });
    clearInputWithIME();
  };

  const handleMentionSelect = (user) => {
    justSelectedRef.current = true;
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart || input.length;
    const textBeforeCursor = input.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/(^|[\s])@(\S*)$/);
    if (mentionMatch) {
      const matchStart = textBeforeCursor.lastIndexOf('@' + mentionMatch[2]);
      const before = input.slice(0, matchStart);
      const after = input.slice(cursorPos);
      const newInput = `${before}@${user.username} ${after}`;
      setInput(newInput);
      setMentionedUserIds((prev) =>
        prev.includes(user.user_id) ? prev : [...prev, user.user_id]
      );
    }
    setMentionCommand(null);
    setTimeout(() => {
      justSelectedRef.current = false;
      textarea?.focus();
    }, 50);
  };

  // 채팅방 이름 변경
  const handleStartEdit = () => {
    setEditName(roomName);
    setIsEditing(true);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === roomName) {
      setIsEditing(false);
      return;
    }
    try {
      const res = await axios.patch(`/chat/${roomId}/name`, { room_name: trimmed });
      if (res.data.status) {
        setRoomName(res.data.room_name);
        window.dispatchEvent(new CustomEvent('chat:new_message'));
      }
    } catch {}
    setIsEditing(false);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // 메시지 내용 렌더링
  const renderContent = (text) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3).replace(/^\n/, '');
        return <pre key={i} className="MessengerChatRoom__CodeBlock"><code>{code}</code></pre>;
      }
      return <span key={i}>{renderInline(part)}</span>;
    });
  };

  const renderInline = (text) => {
    const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return tokens.map((token, i) => {
      if (token.startsWith('`') && token.endsWith('`')) {
        return <code key={i} className="MessengerChatRoom__InlineCode">{token.slice(1, -1)}</code>;
      }
      if (token.startsWith('**') && token.endsWith('**')) {
        return <strong key={i}>{token.slice(2, -2)}</strong>;
      }
      return token;
    });
  };

  // 첨부파일 렌더링 (메시지 내)
  const renderAttachments = (attachments) => {
    if (!attachments?.length) return null;
    const images = attachments.filter((a) => isImageType(a.file_type));
    const files = attachments.filter((a) => !isImageType(a.file_type));
    const gridClass = images.length === 1 ? 'single' : images.length === 2 ? 'duo' : 'multi';

    return (
      <div className="MessengerChatRoom__Attachments">
        {images.length > 0 && (
          <div className={`MessengerChatRoom__ImageGrid MessengerChatRoom__ImageGrid--${gridClass}`}>
            {images.map((att, i) => (
              <a key={i} href={att.file_url} target="_blank" rel="noopener noreferrer"
                 className="MessengerChatRoom__ImageLink"
                 onClick={(e) => {
                   e.preventDefault();
                   openLightbox(
                     images.map((a) => ({ src: a.file_url, alt: a.file_name, filename: a.file_name })),
                     i
                   );
                 }}>
                <img src={att.file_url} alt={att.file_name} loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {files.map((att, i) => (
          <a key={i} className="MessengerChatRoom__FileCard"
             href={att.file_url} download={att.file_name} target="_blank" rel="noopener noreferrer">
            <FileIcon size={16} />
            <span className="MessengerChatRoom__FileCardName">{att.file_name}</span>
            <span className="MessengerChatRoom__FileCardSize">{formatFileSize(att.file_size)}</span>
            <Download size={14} className="MessengerChatRoom__FileCardDl" />
          </a>
        ))}
      </div>
    );
  };

  const getMinuteKey = (dateStr) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
  };

  const shouldShowTime = (index) => {
    const msg = messages[index];
    const next = messages[index + 1];
    if (!next) return true;
    if (next.sender_id !== msg.sender_id) return true;
    return getMinuteKey(msg.created_at) !== getMinuteKey(next.created_at);
  };

  const getUnreadCount = (msg) => {
    const msgTime = new Date(msg.created_at);
    return members.filter((m) => {
      if (!m.last_read_at) return true;
      return msgTime > new Date(m.last_read_at);
    }).length;
  };

  const isUploading = pendingFiles.some((f) => f.status === 'uploading');
  const sendDisabled = isCodeMode || !!slashCommand || isUploading;

  return (
    <div className="MessengerChatRoom"
         onDragEnter={handleDragEnter}
         onDragLeave={handleDragLeave}
         onDragOver={handleDragOver}
         onDrop={handleDrop}>
      {/* 드래그 오버레이 */}
      {isDragOver && (
        <div className="MessengerChatRoom__DragOverlay">
          <span>Drop files to attach</span>
        </div>
      )}

      <div className="MessengerChatRoom__Header">
        {headerLeft}
        {!hideback && (
          <button className="MessengerChatRoom__BackBtn" onClick={onBack}>
            <ArrowLeft size={16} />
          </button>
        )}
        {isEditing ? (
          <div className="MessengerChatRoom__TitleEdit">
            <input
              ref={editInputRef}
              className="MessengerChatRoom__TitleInput"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleEditKeyDown}
              maxLength={200}
            />
            <button className="MessengerChatRoom__TitleBtn" onClick={handleSaveEdit}>
              <Check size={14} />
            </button>
            <button className="MessengerChatRoom__TitleBtn" onClick={handleCancelEdit}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="MessengerChatRoom__TitleArea">
            <span className="MessengerChatRoom__Title">{roomName}</span>
            {roomType !== 'dm' && (
              <button className="MessengerChatRoom__TitleBtn" onClick={handleStartEdit}>
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
        {headerRight && <div className="MessengerChatRoom__HeaderRight">{headerRight}</div>}
      </div>

      <div className="MessengerChatRoom__Messages">
        {(() => {
          let firstUnreadIdx = -1;
          if (myLastReadAt) {
            let effectiveReadTime = new Date(myLastReadAt);
            for (const m of messages) {
              if (m.sender_id === myUserId) {
                const sentTime = new Date(m.created_at);
                if (sentTime > effectiveReadTime) effectiveReadTime = sentTime;
              }
            }
            firstUnreadIdx = messages.findIndex(
              (m) => m.sender_id !== myUserId && new Date(m.created_at) > effectiveReadTime
            );
          } else if (messages.length > 0 && messages.some((m) => m.sender_id !== myUserId)) {
            firstUnreadIdx = messages.findIndex((m) => m.sender_id !== myUserId);
          }
          return messages.map((msg, idx) => {
            const showTime = shouldShowTime(idx);
            const isMine = msg.sender_id === myUserId;
            // 보낸 사람이 바뀌는 첫 메시지에만 아바타/이름 노출 (연속 메시지는 여백 정렬)
            const isFirstOfRun = idx === 0 || messages[idx - 1].sender_id !== msg.sender_id;
            return (
              <Fragment key={msg.message_id}>
                {showUnreadDivider && idx === firstUnreadIdx && (
                  <div className="MessengerChatRoom__UnreadDivider" ref={unreadDividerRef}>
                    <span>New messages</span>
                  </div>
                )}
                <div
                  className={`MessengerChatRoom__Msg ${
                    isMine ? 'MessengerChatRoom__Msg--mine' : ''
                  }`}
                >
              {!isMine && (
                <div className="MessengerChatRoom__MsgAvatar">
                  {isFirstOfRun && (
                    <Avatar
                      user={{
                        name: msg.sender_name,
                        id: msg.sender_id,
                        avatar_url: msg.sender_avatar_url,
                        avatar_color: msg.sender_avatar_color,
                      }}
                      size="sm"
                    />
                  )}
                </div>
              )}
              <div className="MessengerChatRoom__MsgBody">
              {!isMine && isFirstOfRun && (
                <span className="MessengerChatRoom__MsgSender">{msg.sender_name}</span>
              )}
              {msg.task_ref && (
                <div className="MessengerChatRoom__MsgTaskRef">
                  <TaskRefCard taskRef={msg.task_ref} />
                </div>
              )}
              {msg.doc_ref && (
                <div className="MessengerChatRoom__MsgTaskRef">
                  <DocRefCard docRef={msg.doc_ref} />
                </div>
              )}
              {msg.issue_ref && (
                <div className="MessengerChatRoom__MsgTaskRef">
                  <IssueRefCard issueRef={msg.issue_ref} />
                </div>
              )}
              {renderAttachments(msg.attachments)}
              <div className="MessengerChatRoom__MsgRow">
                {isMine && (() => {
                  const unread = getUnreadCount(msg);
                  if (!unread && !showTime) return null;
                  return (
                    <div className="MessengerChatRoom__MsgMeta">
                      {unread > 0 && (
                        <span className="MessengerChatRoom__MsgUnread">{unread}</span>
                      )}
                      {showTime && (
                        <span className="MessengerChatRoom__MsgTime">
                          {formatMessageTime(msg.created_at)}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {msg.content ? (
                  <div className="MessengerChatRoom__MsgBubble">
                    {renderContent(msg.content)}
                  </div>
                ) : null}
                {!isMine && showTime && (
                  <span className="MessengerChatRoom__MsgTime">
                    {formatMessageTime(msg.created_at)}
                  </span>
                )}
              </div>
              </div>
              </div>
            </Fragment>
            );
          });
        })()}
        <div ref={messagesEndRef} />
      </div>

      <div className="MessengerChatRoom__Input">
        {showSlashMenu && filteredSlashCommands.length > 0 && (
          <SlashCommandMenu
            className="SlashCommandMenu--messenger"
            commands={filteredSlashCommands}
            activeIndex={slashMenuIdx}
            onSelect={(c) => handleSlashMenuSelect(c.cmd)}
            onHover={setSlashMenuIdx}
          />
        )}
        {mentionCommand && (
          <MentionSearchPopup
            keyword={mentionCommand.keyword}
            roomId={roomId}
            onSelect={handleMentionSelect}
            onClose={() => setMentionCommand(null)}
          />
        )}
        {slashCommand?.type === 'task' && (
          <TaskSearchPopup
            keyword={slashCommand.keyword}
            mode={slashCommand.mode}
            onSelect={handleTaskSelect}
            onClose={() => setSlashCommand(null)}
          />
        )}
        {slashCommand?.type === 'doc' && (
          <DocSearchPopup
            keyword={slashCommand.keyword}
            onSelect={handleDocSelect}
            onClose={() => setSlashCommand(null)}
          />
        )}
        {slashCommand?.type === 'issue' && (
          <IssueSearchPopup
            keyword={slashCommand.keyword}
            onSelect={handleIssueSelect}
            onClose={() => setSlashCommand(null)}
          />
        )}
        {attachedTask && (
          <div className="MessengerChatRoom__AttachedTask">
            <TaskRefCard taskRef={attachedTask} removable onRemove={() => setAttachedTask(null)} />
          </div>
        )}
        {attachedDoc && (
          <div className="MessengerChatRoom__AttachedTask">
            <DocRefCard docRef={attachedDoc} removable onRemove={() => setAttachedDoc(null)} />
          </div>
        )}
        {attachedIssue && (
          <div className="MessengerChatRoom__AttachedTask">
            <IssueRefCard issueRef={attachedIssue} removable onRemove={() => setAttachedIssue(null)} />
          </div>
        )}
        {/* 파일 프리뷰 영역 */}
        {pendingFiles.length > 0 && (
          <div className="MessengerChatRoom__PendingFiles">
            {pendingFiles.map((pf) => (
              <div key={pf.id} className="MessengerChatRoom__PendingFile">
                {pf.preview ? (
                  <img src={pf.preview} alt={pf.file_name} className="MessengerChatRoom__PendingThumb" />
                ) : (
                  <div className="MessengerChatRoom__PendingFileIcon">
                    <FileIcon size={20} />
                  </div>
                )}
                <div className="MessengerChatRoom__PendingInfo">
                  <span className="MessengerChatRoom__PendingName">{pf.file_name}</span>
                  <span className="MessengerChatRoom__PendingSize">{formatFileSize(pf.file_size)}</span>
                </div>
                {pf.status === 'uploading' && (
                  <div className="MessengerChatRoom__PendingProgress">
                    <div className="MessengerChatRoom__PendingProgressBar"
                         style={{ width: `${pf.progress}%` }} />
                  </div>
                )}
                <button className="MessengerChatRoom__PendingRemove"
                        onClick={() => removePendingFile(pf.id)}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          accept={ALLOWED_EXTENSIONS.join(',')}
          onChange={(e) => {
            if (e.target.files?.length) handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          className="MessengerChatRoom__AttachBtn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
        >
          <Paperclip size={16} />
        </button>
        <div className={`MessengerChatRoom__InputWrap ${isCodeMode ? 'MessengerChatRoom__InputWrap--code' : ''}`}>
          {isCodeMode && (
            <div className="MessengerChatRoom__CodeLabel">Code</div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isCodeMode ? 'Enter code... (close with ``` to send)' : 'Type a message... (/ for commands)'}
            className={`MessengerChatRoom__InputField ${isCodeMode ? 'MessengerChatRoom__InputField--code' : ''}`}
            rows={1}
          />
        </div>
        <button
          className={`MessengerChatRoom__SendBtn ${sendDisabled ? 'MessengerChatRoom__SendBtn--disabled' : ''}`}
          onClick={handleSend}
          disabled={sendDisabled}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
