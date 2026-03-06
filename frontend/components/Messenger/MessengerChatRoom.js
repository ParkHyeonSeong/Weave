import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, Pencil, Check, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { formatMessageTime } from '@/library/formatTime';

export default function MessengerChatRoom({ roomId, wsRef, onBack, hideback }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [roomName, setRoomName] = useState('Chat');
  const [roomType, setRoomType] = useState('dm');
  const [partnerLastRead, setPartnerLastRead] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const messagesEndRef = useRef(null);
  const editInputRef = useRef(null);

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
          // DM: 상대방 이름, Group: room_name
          if (res.data.partner) {
            setRoomName(res.data.partner.username);
            setPartnerLastRead(res.data.partner.last_read_at);
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
      // 상대방이 읽음 처리했을 때 read receipt 갱신
      if (data.type === 'mark_read' && data.room_id === roomId && data.user_id !== myUserId) {
        setPartnerLastRead(data.last_read_at);
      }
    };
    window.addEventListener('chat:ws_message', handleWsMessage);
    return () => window.removeEventListener('chat:ws_message', handleWsMessage);
  }, [roomId, myUserId]);

  // 스크롤 하단 유지
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const content = input.trim();
    if (!content) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'send_message',
        room_id: roomId,
        content,
      }));
    }
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
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

  // 상대방이 해당 메시지를 아직 안 읽었는지 판별
  const isUnread = (msg) => {
    if (!partnerLastRead) return true;
    return new Date(msg.created_at) > new Date(partnerLastRead);
  };

  return (
    <div className="MessengerChatRoom">
      <div className="MessengerChatRoom__Header">
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
        {messages.map((msg) => (
          <div
            key={msg.message_id}
            className={`MessengerChatRoom__Msg ${
              msg.sender_id === myUserId ? 'MessengerChatRoom__Msg--mine' : ''
            }`}
          >
            {msg.sender_id !== myUserId && (
              <span className="MessengerChatRoom__MsgSender">{msg.sender_name}</span>
            )}
            <div className="MessengerChatRoom__MsgRow">
              {msg.sender_id === myUserId && (
                <div className="MessengerChatRoom__MsgMeta">
                  {isUnread(msg) && (
                    <span className="MessengerChatRoom__MsgUnread">1</span>
                  )}
                  <span className="MessengerChatRoom__MsgTime">
                    {formatMessageTime(msg.created_at)}
                  </span>
                </div>
              )}
              <div className="MessengerChatRoom__MsgBubble">
                {msg.content}
              </div>
              {msg.sender_id !== myUserId && (
                <span className="MessengerChatRoom__MsgTime">
                  {formatMessageTime(msg.created_at)}
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="MessengerChatRoom__Input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className="MessengerChatRoom__InputField"
        />
        <button className="MessengerChatRoom__SendBtn" onClick={handleSend}>
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
