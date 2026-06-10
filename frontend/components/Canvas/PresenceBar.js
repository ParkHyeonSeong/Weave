import AvatarStack from '@/components/common/AvatarStack';

export default function PresenceBar({ users = [], currentUserId }) {
  // 현재 사용자를 제외한 다른 접속자만 표시
  const otherUsers = users.filter(u => u.user_id !== currentUserId);

  if (otherUsers.length === 0) return null;

  return (
    <div className="PresenceBar">
      <AvatarStack users={otherUsers} max={4} size="sm" overlapping />
      <span className="PresenceBar__Count">
        {otherUsers.length} editing
      </span>
    </div>
  );
}
