import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function MessengerChatRoom({ roomId, wsRef, onBack }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

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
        setMessages((prev) => [...prev, data.message]);
        // 읽음 처리
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: 'mark_read', room_id: roomId }));
        }
      }
    };
    window.addEventListener('chat:ws_message', handleWsMessage);
    return () => window.removeEventListener('chat:ws_message', handleWsMessage);
  }, [roomId]);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="MessengerChatRoom">
      <div className="MessengerChatRoom__Header">
        <button className="MessengerChatRoom__BackBtn" onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <span className="MessengerChatRoom__Title">Chat</span>
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
            <div className="MessengerChatRoom__MsgBubble">
              {msg.content}
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
