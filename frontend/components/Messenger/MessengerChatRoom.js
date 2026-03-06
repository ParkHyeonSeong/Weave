import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, Pencil, Check, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { formatMessageTime } from '@/library/formatTime';
import TaskSearchPopup from './TaskSearchPopup';
import TaskRefCard from './TaskRefCard';

export default function MessengerChatRoom({ roomId, wsRef, onBack, hideback, headerLeft }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [roomName, setRoomName] = useState('Chat');
  const [roomType, setRoomType] = useState('dm');
  const [members, setMembers] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [attachedTask, setAttachedTask] = useState(null);
  const [slashCommand, setSlashCommand] = useState(null); // { mode: 'my'|'all', keyword: '' }
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuIdx, setSlashMenuIdx] = useState(0);
  const messagesEndRef = useRef(null);
  const editInputRef = useRef(null);
  const textareaRef = useRef(null);

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
          // 최신순 -> 시간순으로 뒤집기
          setMessages(res.data.messages.reverse());
          setRoomType(res.data.room_type || 'dm');
          // 멤버 목록 저장 (읽음 처리용)
          if (res.data.members) setMembers(res.data.members);
          // DM: 상대방 이름, Group: room_name
          if (res.data.room_type === 'dm' && res.data.members?.length) {
            setRoomName(res.data.members[0].username);
          } else if (res.data.room_name) {
            setRoomName(res.data.room_name);
          }
        }
      } catch {}
    };
    fetchMessages();

    // 읽음 처리
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'mark_read', room_id: roomId }));
    }
  }, [roomId]);

  // WebSocket 메시지 수신
  useEffect(() => {
    const handleWsMessage = (e) => {
      const data = e.detail;
      if (data.type === 'new_message' && data.room_id === roomId) {
        setMessages((prev) => {
          // 중복 메시지 방지
          if (prev.some((m) => m.message_id === data.message.message_id)) return prev;
          return [...prev, data.message];
        });
        // 읽음 처리
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: 'mark_read', room_id: roomId }));
        }
      }
      // 상대방이 읽음 처리했을 때 해당 멤버의 last_read_at 갱신
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

  // 스크롤 하단 유지
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

  // 코드블록 모드 판별 (```가 홀수번 열린 상태 = 닫히지 않음)
  const isCodeMode = (input.match(/```/g) || []).length % 2 === 1;

  const handleSend = () => {
    if (isCodeMode) return; // 코드블록이 닫히지 않으면 전송 차단
    const content = input.trim();
    if (!content && !attachedTask) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const payload = { action: 'send_message', room_id: roomId, content };
      if (attachedTask) payload.task_id = attachedTask.task_id;
      wsRef.current.send(JSON.stringify(payload));
    }
    setInput('');
    setAttachedTask(null);
    setSlashCommand(null);
  };

  const SLASH_COMMANDS = ['/t', '/ta'];

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    // 슬래시 메뉴 키보드 네비게이션
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenuIdx((prev) => Math.min(prev + 1, SLASH_COMMANDS.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenuIdx((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSlashMenuSelect(SLASH_COMMANDS[slashMenuIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        return;
      }
    }
    // 슬래시 커맨드 팝업 활성화 시 키보드 이벤트 위임 (TaskSearchPopup에서 처리)
    if (slashCommand && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    if (slashCommand && e.key === 'Enter' && !e.shiftKey) return;
    if (e.key === 'Enter') {
      if (isCodeMode || slashCommand) {
        // 코드모드 또는 검색중: Enter는 줄바꿈 또는 무시
      } else {
        // 일반모드: Enter로 전송, Shift+Enter로 줄바꿈
        if (!e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      }
    }
  };

  // 슬래시 커맨드 감지
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);

    // '/'만 입력하면 커맨드 목록 표시
    if (val === '/') {
      setShowSlashMenu(true);
      setSlashMenuIdx(0);
      setSlashCommand(null);
      return;
    }

    // /ta 또는 /t 로 시작하는지 감지 (/ta를 먼저 체크)
    if (val.match(/^\/ta\s/)) {
      setSlashCommand({ mode: 'all', keyword: val.slice(4) });
      setShowSlashMenu(false);
    } else if (val.match(/^\/t\s/)) {
      setSlashCommand({ mode: 'my', keyword: val.slice(3) });
      setShowSlashMenu(false);
    } else if (val.match(/^\/t$/) || val.match(/^\/ta?$/)) {
      // /t 또는 /ta 타이핑 중 (아직 스페이스 안 침)
      setShowSlashMenu(true);
      if (slashCommand) setSlashCommand(null);
    } else {
      if (slashCommand) setSlashCommand(null);
      if (showSlashMenu) setShowSlashMenu(false);
    }
  };

  // 슬래시 메뉴에서 커맨드 선택
  const handleSlashMenuSelect = (cmd) => {
    setInput(cmd + ' ');
    setShowSlashMenu(false);
    if (cmd === '/t') {
      setSlashCommand({ mode: 'my', keyword: '' });
    } else if (cmd === '/ta') {
      setSlashCommand({ mode: 'all', keyword: '' });
    }
    textareaRef.current?.focus();
  };

  // 태스크 선택 시
  const handleTaskSelect = (task) => {
    setAttachedTask({
      task_id: task.task_id,
      branch_id: task.branch_id,
      display_id: task.display_id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignees: task.assignees || [],
    });
    setInput('');
    setSlashCommand(null);
    textareaRef.current?.focus();
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
        // 채팅 목록 갱신
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

  // 메시지 내용 렌더링 (코드블록, 인라인코드, 볼드)
  const renderContent = (text) => {
    // 코드블록 분리: ```...```
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3).replace(/^\n/, '');
        return <pre key={i} className="MessengerChatRoom__CodeBlock"><code>{code}</code></pre>;
      }
      // 인라인 파싱: `code`, **bold**
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

  // 같은 발신자 + 같은 분(HH:MM)이면 마지막 메시지에만 시간 표시
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

  // 해당 메시지를 안 읽은 멤버 수
  const getUnreadCount = (msg) => {
    const msgTime = new Date(msg.created_at);
    return members.filter((m) => {
      if (!m.last_read_at) return true;
      return msgTime > new Date(m.last_read_at);
    }).length;
  };

  return (
    <div className="MessengerChatRoom">
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
      </div>

      <div className="MessengerChatRoom__Messages">
        {messages.map((msg, idx) => {
          const showTime = shouldShowTime(idx);
          return (
            <div
              key={msg.message_id}
              className={`MessengerChatRoom__Msg ${
                msg.sender_id === myUserId ? 'MessengerChatRoom__Msg--mine' : ''
              }`}
            >
              {msg.sender_id !== myUserId && (
                <span className="MessengerChatRoom__MsgSender">{msg.sender_name}</span>
              )}
              {msg.task_ref && (
                <div className="MessengerChatRoom__MsgTaskRef">
                  <TaskRefCard taskRef={msg.task_ref} />
                </div>
              )}
              <div className="MessengerChatRoom__MsgRow">
                {msg.sender_id === myUserId && showTime && (
                  <div className="MessengerChatRoom__MsgMeta">
                    {(() => {
                      const unread = getUnreadCount(msg);
                      return unread > 0 ? (
                        <span className="MessengerChatRoom__MsgUnread">{unread}</span>
                      ) : null;
                    })()}
                    <span className="MessengerChatRoom__MsgTime">
                      {formatMessageTime(msg.created_at)}
                    </span>
                  </div>
                )}
                {msg.content ? (
                  <div className="MessengerChatRoom__MsgBubble">
                    {renderContent(msg.content)}
                  </div>
                ) : null}
                {msg.sender_id !== myUserId && showTime && (
                  <span className="MessengerChatRoom__MsgTime">
                    {formatMessageTime(msg.created_at)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="MessengerChatRoom__Input">
        {showSlashMenu && (
          <div className="SlashMenu">
            <div className="SlashMenu__Header">Commands</div>
            <ul className="SlashMenu__List">
              <li
                className={`SlashMenu__Item ${slashMenuIdx === 0 ? 'SlashMenu__Item--active' : ''}`}
                onClick={() => handleSlashMenuSelect('/t')}
                onMouseEnter={() => setSlashMenuIdx(0)}
              >
                <span className="SlashMenu__Cmd">/t</span>
                <span className="SlashMenu__Desc">Search my tasks</span>
              </li>
              <li
                className={`SlashMenu__Item ${slashMenuIdx === 1 ? 'SlashMenu__Item--active' : ''}`}
                onClick={() => handleSlashMenuSelect('/ta')}
                onMouseEnter={() => setSlashMenuIdx(1)}
              >
                <span className="SlashMenu__Cmd">/ta</span>
                <span className="SlashMenu__Desc">Search all tasks</span>
              </li>
            </ul>
          </div>
        )}
        {slashCommand && (
          <TaskSearchPopup
            keyword={slashCommand.keyword}
            mode={slashCommand.mode}
            onSelect={handleTaskSelect}
            onClose={() => setSlashCommand(null)}
          />
        )}
        {attachedTask && (
          <div className="MessengerChatRoom__AttachedTask">
            <TaskRefCard
              taskRef={attachedTask}
              removable
              onRemove={() => setAttachedTask(null)}
            />
          </div>
        )}
        <div className={`MessengerChatRoom__InputWrap ${isCodeMode ? 'MessengerChatRoom__InputWrap--code' : ''}`}>
          {isCodeMode && (
            <div className="MessengerChatRoom__CodeLabel">Code</div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={isCodeMode ? 'Enter code... (close with ``` to send)' : 'Type a message... (/ for commands)'}
            className={`MessengerChatRoom__InputField ${isCodeMode ? 'MessengerChatRoom__InputField--code' : ''}`}
            rows={1}
          />
        </div>
        <button
          className={`MessengerChatRoom__SendBtn ${isCodeMode || slashCommand ? 'MessengerChatRoom__SendBtn--disabled' : ''}`}
          onClick={handleSend}
          disabled={isCodeMode || !!slashCommand}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
