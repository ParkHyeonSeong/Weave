import { useState, useEffect } from 'react';
import { MessageSquare, Users } from 'lucide-react';
import MessengerChatList from './MessengerChatList';
import MessengerUserList from './MessengerUserList';
import MessengerChatRoom from './MessengerChatRoom';
import MessengerNewChat from './MessengerNewChat';

export default function Messenger({ wsRef, activeRoomRef }) {
  const [activeTab, setActiveTab] = useState('chats');
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [showNewChat, setShowNewChat] = useState(false);

  // 채팅방 진입
  const handleOpenRoom = (roomId) => {
    setActiveRoomId(roomId);
    setShowNewChat(false);
  };

  // 채팅방에서 목록으로 복귀
  const handleBack = () => {
    setActiveRoomId(null);
    setShowNewChat(false);
  };

  // 현재 열린 방 ID를 Layout에 공유
  useEffect(() => {
    if (activeRoomRef) activeRoomRef.current = activeRoomId;
    return () => { if (activeRoomRef) activeRoomRef.current = null; };
  }, [activeRoomId]);

  // 알림 클릭 -> 해당 채팅방으로 이동
  useEffect(() => {
    const handleOpenFromNoti = (e) => handleOpenRoom(e.detail);
    window.addEventListener('chat:open_room', handleOpenFromNoti);
    return () => window.removeEventListener('chat:open_room', handleOpenFromNoti);
  }, []);

  // 새 채팅 compose 화면 열기
  const handleNewChat = () => {
    setShowNewChat(true);
    setActiveRoomId(null);
  };

  // 현재 표시할 화면 결정
  if (activeRoomId) {
    return (
      <div className="Messenger">
        <MessengerChatRoom
          roomId={activeRoomId}
          wsRef={wsRef}
          onBack={handleBack}
        />
      </div>
    );
  }

  if (showNewChat) {
    return (
      <div className="Messenger">
        <MessengerNewChat
          wsRef={wsRef}
          onBack={handleBack}
          onOpenRoom={handleOpenRoom}
        />
      </div>
    );
  }

  return (
    <div className="Messenger">
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
    </div>
  );
}
