import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';

export default function MessengerUserList({ onOpenRoom }) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get('/chat/users');
        if (res.data.status) {
          setUsers(res.data.users);
        }
      } catch {}
    };
    fetchUsers();
  }, []);

  // DM 시작
  const handleStartDM = async (targetUserId) => {
    try {
      const res = await axios.post('/chat', {
        room_type: 'dm',
        member_ids: [targetUserId],
      });
      if (res.data.status) {
        onOpenRoom(res.data.room_id);
      }
    } catch {}
  };

  // 현재 로그인 사용자 제외
  let myUserId = 0;
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    myUserId = profile.user_id || 0;
  } catch {}

  return (
    <div className="MessengerUserList">
      <div className="MessengerUserList__Header">
        <span className="MessengerUserList__Title">Users</span>
      </div>
      <div className="MessengerUserList__Items">
        {users
          .filter((u) => u.user_id !== myUserId)
          .map((user) => (
            <button
              key={user.user_id}
              className="MessengerUserList__Item"
              onClick={() => handleStartDM(user.user_id)}
            >
              <div className="MessengerUserList__Avatar">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div className="MessengerUserList__Info">
                <span className="MessengerUserList__Name">{user.username}</span>
                <span className="MessengerUserList__Email">{user.email}</span>
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}
