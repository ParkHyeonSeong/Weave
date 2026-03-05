import { useState, useEffect } from 'react';
import { ArrowLeft, Send, X } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function MessengerNewChat({ wsRef, onBack, onOpenRoom }) {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');

  let myUserId = 0;
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    myUserId = profile.user_id || 0;
  } catch {}

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get('/chat/users');
        if (res.data.status) {
          setUsers(res.data.users.filter((u) => u.user_id !== myUserId));
        }
      } catch {}
    };
    fetchUsers();
  }, []);

  const toggleUser = (user) => {
    setSelected((prev) => {
      const exists = prev.find((u) => u.user_id === user.user_id);
      if (exists) return prev.filter((u) => u.user_id !== user.user_id);
      return [...prev, user];
    });
    setSearch('');
  };

  const removeUser = (userId) => {
    setSelected((prev) => prev.filter((u) => u.user_id !== userId));
  };

  const filteredUsers = users.filter((u) => {
    if (selected.find((s) => s.user_id === u.user_id)) return false;
    if (!search) return true;
    return u.username.toLowerCase().includes(search.toLowerCase()) ||
           u.email.toLowerCase().includes(search.toLowerCase());
  });

  const handleSend = async () => {
    const content = input.trim();
    if (!content || selected.length === 0) return;

    try {
      const memberIds = selected.map((u) => u.user_id);
      const isDm = memberIds.length === 1;

      // 채팅방 생성
      const res = await axios.post('/chat', {
        room_type: isDm ? 'dm' : 'group',
        room_name: isDm ? null : selected.map((u) => u.username).join(', '),
        member_ids: memberIds,
      });

      if (res.data.status) {
        const roomId = res.data.room_id;

        // 첫 메시지 전송
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            action: 'send_message',
            room_id: roomId,
            content,
          }));
        }

        onOpenRoom(roomId);
      }
    } catch {}
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="MessengerNewChat">
      <div className="MessengerNewChat__Header">
        <button className="MessengerNewChat__BackBtn" onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <span className="MessengerNewChat__Title">New Chat</span>
      </div>

      <div className="MessengerNewChat__To">
        <span className="MessengerNewChat__ToLabel">To:</span>
        <div className="MessengerNewChat__ToField">
          {selected.map((user) => (
            <span key={user.user_id} className="MessengerNewChat__Chip">
              {user.username}
              <button
                className="MessengerNewChat__ChipRemove"
                onClick={() => removeUser(user.user_id)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={selected.length === 0 ? 'Search users...' : ''}
            className="MessengerNewChat__SearchInput"
          />
        </div>
      </div>

      <div className="MessengerNewChat__UserList">
        {filteredUsers.map((user) => (
          <button
            key={user.user_id}
            className="MessengerNewChat__UserItem"
            onClick={() => toggleUser(user)}
          >
            <div className="MessengerNewChat__Avatar">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="MessengerNewChat__UserInfo">
              <span className="MessengerNewChat__UserName">{user.username}</span>
              <span className="MessengerNewChat__UserEmail">{user.email}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="MessengerNewChat__Input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length > 0 ? 'Type a message...' : 'Select users first'}
          className="MessengerNewChat__InputField"
          disabled={selected.length === 0}
        />
        <button
          className="MessengerNewChat__SendBtn"
          onClick={handleSend}
          disabled={selected.length === 0 || !input.trim()}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
