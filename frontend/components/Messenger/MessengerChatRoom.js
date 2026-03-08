import { useState, useEffect, useRef, Fragment } from 'react';
import { ArrowLeft, Send, Pencil, Check, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { formatMessageTime } from '@/library/formatTime';
import TaskSearchPopup from './TaskSearchPopup';
import TaskRefCard from './TaskRefCard';
import DocSearchPopup from './DocSearchPopup';
import DocRefCard from './DocRefCard';
import IssueSearchPopup from './IssueSearchPopup';
import IssueRefCard from './IssueRefCard';
import MentionSearchPopup from './MentionSearchPopup';

export default function MessengerChatRoom({ roomId, wsRef, onBack, hideback, headerLeft, headerRight }) {
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
  const [slashCommand, setSlashCommand] = useState(null); // { type: 'task'|'doc'|'issue', ... }
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuIdx, setSlashMenuIdx] = useState(0);
  const [mentionCommand, setMentionCommand] = useState(null); // { keyword: '' }
  const [mentionedUserIds, setMentionedUserIds] = useState([]);
  const [myLastReadAt, setMyLastReadAt] = useState(null);
  const [showUnreadDivider, setShowUnreadDivider] = useState(true);
  const messagesEndRef = useRef(null);
  const unreadDividerRef = useRef(null);
  const editInputRef = useRef(null);
  const textareaRef = useRef(null);
  const justSelectedRef = useRef(false);
  const isInitialLoadRef = useRef(true);

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
          const msgs = res.data.messages.reverse();
          setMessages(msgs);
          setRoomType(res.data.room_type || 'dm');
          setMyLastReadAt(res.data.my_last_read_at || null);
          setShowUnreadDivider(true);
          isInitialLoadRef.current = true;
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
      window.dispatchEvent(new CustomEvent('chat:unread_changed'));
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
          window.dispatchEvent(new CustomEvent('chat:unread_changed'));
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

  // 스크롤: 초기 로드 시 unread 구분선으로, 이후 새 메시지는 최하단으로
  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      if (unreadDividerRef.current) {
        unreadDividerRef.current.scrollIntoView({ behavior: 'instant', block: 'center' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }
      // 초기 스크롤 후 divider 제거 (읽음 처리 완료)
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

  // 코드블록 모드 판별 (```가 홀수번 열린 상태 = 닫히지 않음)
  const isCodeMode = (input.match(/```/g) || []).length % 2 === 1;

  const handleSend = () => {
    if (isCodeMode) return; // 코드블록이 닫히지 않으면 전송 차단
    const content = input.trim();
    if (!content && !attachedTask && !attachedDoc && !attachedIssue) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const payload = { action: 'send_message', room_id: roomId, content };
      if (attachedTask) payload.task_id = attachedTask.task_id;
      if (attachedDoc) payload.canvas_page_id = attachedDoc.page_id;
      if (attachedIssue) payload.issue_id = attachedIssue.issue_id;
      if (mentionedUserIds.length > 0) payload.mentioned_user_ids = mentionedUserIds;
      wsRef.current.send(JSON.stringify(payload));
    }
    setInput('');
    setAttachedTask(null);
    setAttachedDoc(null);
    setAttachedIssue(null);
    setSlashCommand(null);
    setMentionedUserIds([]);
  };

  const SLASH_COMMANDS = [
    { cmd: '/t', desc: 'Search my tasks' },
    { cmd: '/ta', desc: 'Search all tasks' },
    { cmd: '/d', desc: 'Search documents' },
    { cmd: '/i', desc: 'Search issues' },
  ];

  // 입력값에 따라 슬래시 메뉴 필터링
  const filteredSlashCommands = SLASH_COMMANDS.filter(
    (c) => c.cmd.startsWith(input) || input === '/'
  );

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    // 슬래시 메뉴 키보드 네비게이션
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
    // 팝업에서 선택 직후 Enter 중복 방지 (한글 IME 이중 keydown)
    if (justSelectedRef.current && e.key === 'Enter') {
      e.preventDefault();
      justSelectedRef.current = false;
      return;
    }
    // @멘션 팝업 활성화 시 키보드 이벤트 위임
    if (mentionCommand && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    if (mentionCommand && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
    // 슬래시 커맨드 팝업 활성화 시 키보드 이벤트 위임 (TaskSearchPopup에서 처리)
    if (slashCommand && ['ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    if (slashCommand && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return;
    }
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

    // 슬래시 커맨드 감지 (/ta를 /t보다 먼저 체크)
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
      // 커맨드 타이핑 중 (아직 스페이스 안 침)
      setShowSlashMenu(true);
      setSlashMenuIdx(0);
      if (slashCommand) setSlashCommand(null);
    } else {
      if (slashCommand) setSlashCommand(null);
      if (showSlashMenu) setShowSlashMenu(false);
    }

    // @멘션 감지: 커서 위치 기준으로 @ 뒤의 키워드 추출
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

  // 슬래시 메뉴에서 커맨드 선택
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

  // IME 조합을 강제 종료하고 input을 비우는 헬퍼
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

  // 태스크 선택 시
  const handleTaskSelect = (task) => {
    justSelectedRef.current = true;
    setAttachedTask({
      task_id: task.task_id,
      branch_id: task.branch_id,
      display_id: task.display_id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignees: task.assignees || [],
      status_label: task.status_label,
      status_color: task.status_color,
      status_category: task.status_category,
    });
    clearInputWithIME();
  };

  // 문서 선택 시
  const handleDocSelect = (doc) => {
    justSelectedRef.current = true;
    setAttachedDoc({
      page_id: doc.page_id,
      canvas_id: doc.canvas_id,
      title: doc.title,
      canvas_name: doc.canvas_name,
    });
    clearInputWithIME();
  };

  // 이슈 선택 시
  const handleIssueSelect = (issue) => {
    justSelectedRef.current = true;
    setAttachedIssue({
      issue_id: issue.issue_id,
      task_id: issue.task_id,
      branch_id: issue.branch_id,
      display_id: issue.display_id,
      title: issue.title,
      status: issue.status,
    });
    clearInputWithIME();
  };

  // @멘션 사용자 선택 시
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
        {headerRight && <div className="MessengerChatRoom__HeaderRight">{headerRight}</div>}
      </div>

      <div className="MessengerChatRoom__Messages">
        {(() => {
          // 첫 번째 미읽 메시지 인덱스 계산
          let firstUnreadIdx = -1;
          if (myLastReadAt) {
            let effectiveReadTime = new Date(myLastReadAt);
            // 사용자가 보낸 메시지 = 방에 있었다는 증거 → 그 시점까지 다 읽음
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
            // last_read_at이 null이면 모두 미읽
            firstUnreadIdx = messages.findIndex((m) => m.sender_id !== myUserId);
          }
          return messages.map((msg, idx) => {
            const showTime = shouldShowTime(idx);
            return (
              <Fragment key={msg.message_id}>
                {showUnreadDivider && idx === firstUnreadIdx && (
                  <div className="MessengerChatRoom__UnreadDivider" ref={unreadDividerRef}>
                    <span>New messages</span>
                  </div>
                )}
                <div
                  className={`MessengerChatRoom__Msg ${
                    msg.sender_id === myUserId ? 'MessengerChatRoom__Msg--mine' : ''
                  }`}
                >
              {msg.sender_id !== myUserId && (idx === 0 || messages[idx - 1].sender_id !== msg.sender_id) && (
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
              <div className="MessengerChatRoom__MsgRow">
                {msg.sender_id === myUserId && (() => {
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
                {msg.sender_id !== myUserId && showTime && (
                  <span className="MessengerChatRoom__MsgTime">
                    {formatMessageTime(msg.created_at)}
                  </span>
                )}
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
          <div className="SlashMenu">
            <div className="SlashMenu__Header">Commands</div>
            <ul className="SlashMenu__List">
              {filteredSlashCommands.map((c, idx) => (
                <li
                  key={c.cmd}
                  className={`SlashMenu__Item ${slashMenuIdx === idx ? 'SlashMenu__Item--active' : ''}`}
                  onClick={() => handleSlashMenuSelect(c.cmd)}
                  onMouseEnter={() => setSlashMenuIdx(idx)}
                >
                  <span className="SlashMenu__Cmd">{c.cmd}</span>
                  <span className="SlashMenu__Desc">{c.desc}</span>
                </li>
              ))}
            </ul>
          </div>
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
            <TaskRefCard
              taskRef={attachedTask}
              removable
              onRemove={() => setAttachedTask(null)}
            />
          </div>
        )}
        {attachedDoc && (
          <div className="MessengerChatRoom__AttachedTask">
            <DocRefCard
              docRef={attachedDoc}
              removable
              onRemove={() => setAttachedDoc(null)}
            />
          </div>
        )}
        {attachedIssue && (
          <div className="MessengerChatRoom__AttachedTask">
            <IssueRefCard
              issueRef={attachedIssue}
              removable
              onRemove={() => setAttachedIssue(null)}
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
