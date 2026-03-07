export default function PresenceBar({ users = [], currentUserId }) {
  // 현재 사용자를 제외한 다른 접속자만 표시
  const otherUsers = users.filter(u => u.userId !== currentUserId);

  if (otherUsers.length === 0) return null;

  return (
    <div className="PresenceBar">
      {otherUsers.map((user) => (
        <div
          key={user.clientId}
          className="PresenceBar__Avatar"
          style={{ borderColor: user.color, backgroundColor: user.color }}
          title={user.name}
        >
          {(user.name || '?').charAt(0).toUpperCase()}
        </div>
      ))}
      {otherUsers.length > 0 && (
        <span className="PresenceBar__Count">
          {otherUsers.length} editing
        </span>
      )}
    </div>
  );
}
