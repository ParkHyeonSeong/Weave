import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { axios } from '@/library/_axios';
import { formatMessageTime } from '@/library/formatTime';

export default function MessengerChatList({ onOpenRoom, onNewChat, activeRoomId }) {
  const [rooms, setRooms] = useState([]);

  const fetchRooms = async () => {
    try {
      const res = await axios.get('/chat');
      if (res.data.status) {
        setRooms(res.data.rooms);
      }
    } catch {}
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  // 새 메시지 수신 시 목록 갱신
  useEffect(() => {
    const handleNewMessage = () => fetchRooms();
    window.addEventListener('chat:new_message', handleNewMessage);
    return () => window.removeEventListener('chat:new_message', handleNewMessage);
  }, []);

  // 미리보기용 마크다운 문법 제거
  const stripMarkdown = (text) => {
    if (!text) return '';
    return text
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\n/g, ' ');
  };

  return (
    <div className="MessengerChatList">
      <div className="MessengerChatList__Header">
        <span className="MessengerChatList__Title">Messages</span>
        <button className="MessengerChatList__NewChatBtn" onClick={onNewChat}>
          <Plus size={14} />
          New Chat
        </button>
      </div>

      <div className="MessengerChatList__Items">
        {rooms.length === 0 ? (
          <div className="MessengerChatList__Empty">
            No conversations yet.
          </div>
        ) : (
          rooms.map((room) => (
            <button
              key={room.room_id}
              className={`MessengerChatList__Item ${activeRoomId === room.room_id ? 'MessengerChatList__Item--active' : ''}`}
              onClick={() => onOpenRoom(room.room_id)}
            >
              <div className="MessengerChatList__ItemInfo">
                <div className="MessengerChatList__ItemTop">
                  <span className="MessengerChatList__ItemName">
                    {room.dm_partner_name || room.room_name || 'Direct Message'}
                  </span>
                  {room.last_message_at && (
                    <span className="MessengerChatList__ItemTime">
                      {formatMessageTime(room.last_message_at)}
                    </span>
                  )}
                </div>
                <div className="MessengerChatList__ItemBottom">
                  {room.last_message && (
                    <span className="MessengerChatList__ItemPreview">
                      {stripMarkdown(room.last_message)}
                    </span>
                  )}
                  {room.unread_count > 0 && (
                    <span className="MessengerChatList__Badge">
                      {room.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
