import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { MessageSquare } from 'lucide-react';

export default function UnreadMessages() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChat();
  }, []);

  const fetchChat = async () => {
    try {
      const res = await axios.get('/chat');
      if (res.data.status) {
        const unread = res.data.rooms.filter(r => r.unread_count > 0);
        setRooms(unread);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const openRoom = (roomId) => {
    window.dispatchEvent(new CustomEvent('chat:open_room', { detail: roomId }));
  };

  const totalUnread = rooms.reduce((sum, r) => sum + r.unread_count, 0);

  if (loading) {
    return (
      <div className="Widget">
        <div className="Widget__Header">
          <MessageSquare size={16} />
          <span className="Widget__Title">Messages</span>
        </div>
        <div className="Widget__Body">
          <div className="Widget__Empty">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="Widget">
      <div className="Widget__Header">
        <MessageSquare size={16} />
        <span className="Widget__Title">Messages</span>
      </div>
      <div className="Widget__Body">
        {rooms.length === 0 ? (
          <div className="Widget__Empty">No unread messages</div>
        ) : (
          <>
            <div className="UnreadMessages__Total">{totalUnread}</div>
            <div className="UnreadMessages__Rooms">
              {rooms.map((room) => (
                <div
                  key={room.room_id}
                  className="UnreadMessages__Room"
                  onClick={() => openRoom(room.room_id)}
                >
                  <span className="UnreadMessages__RoomName">{room.room_name}</span>
                  <span className="UnreadMessages__Badge">{room.unread_count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
