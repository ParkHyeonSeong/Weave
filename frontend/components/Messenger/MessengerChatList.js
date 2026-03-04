import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function MessengerChatList({ onOpenRoom }) {
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

  return (
    <div className="MessengerChatList">
      <div className="MessengerChatList__Header">
        <span className="MessengerChatList__Title">Messages</span>
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
              className="MessengerChatList__Item"
              onClick={() => onOpenRoom(room.room_id)}
            >
              <div className="MessengerChatList__ItemInfo">
                <span className="MessengerChatList__ItemName">
                  {room.room_name || 'Direct Message'}
                </span>
                {room.last_message && (
                  <span className="MessengerChatList__ItemPreview">
                    {room.last_message}
                  </span>
                )}
              </div>
              {room.unread_count > 0 && (
                <span className="MessengerChatList__Badge">
                  {room.unread_count}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
