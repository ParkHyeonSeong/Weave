import { useState } from 'react';
import { MessageSquare, Users } from 'lucide-react';
import MessengerChatList from './MessengerChatList';
import MessengerUserList from './MessengerUserList';
import MessengerChatRoom from './MessengerChatRoom';

export default function Messenger({ wsRef }) {
  const [activeTab, setActiveTab] = useState('chats');
  const [activeRoomId, setActiveRoomId] = useState(null);

  // 채팅방 진입
  const handleOpenRoom = (roomId) => {
    setActiveRoomId(roomId);
  };

  // 채팅방에서 목록으로 복귀
  const handleBack = () => {
    setActiveRoomId(null);
  };

  // 새 채팅 시작 -> Users 탭으로 전환
  const handleNewChat = () => {
    setActiveTab('users');
  };

  return (
    <div className="Messenger">
      {activeRoomId ? (
        <MessengerChatRoom
          roomId={activeRoomId}
          wsRef={wsRef}
          onBack={handleBack}
        />
      ) : (
        <>
          <div className="Messenger__Tabs">
            <button
              className={`Messenger__Tab ${activeTab === 'chats' ? 'Messenger__Tab--active' : ''}`}
              onClick={() => setActiveTab('chats')}
            >
              <MessageSquare size={14} />
              Chats
            </button>
            <button
              className={`Messenger__Tab ${activeTab === 'users' ? 'Messenger__Tab--active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              <Users size={14} />
              Users
            </button>
          </div>
          <div className="Messenger__Content">
            {activeTab === 'chats' ? (
              <MessengerChatList onOpenRoom={handleOpenRoom} onNewChat={handleNewChat} />
            ) : (
              <MessengerUserList onOpenRoom={handleOpenRoom} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
