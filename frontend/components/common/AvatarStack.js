import Avatar from './Avatar';

// 멤버 스택 + (옵션) 클릭 가능한 +N 오버플로.
export default function AvatarStack({
  users = [], max = 4, size = 'sm', overlapping = true,
  onOverflowClick, className = '',
}) {
  const shown = users.slice(0, max);
  const remaining = users.length - max;
  return (
    <div className={`AvatarStack ${overlapping ? 'AvatarStack--overlap' : ''} ${className}`}>
      {shown.map((u, i) => (
        <span
          key={u.user_id ?? u.id ?? `idx-${i}`}
          className="AvatarStack__Item"
          style={{ zIndex: users.length - i }}
        >
          <Avatar user={u} size={size} />
        </span>
      ))}
      {remaining > 0 && (
        onOverflowClick ? (
          <button type="button" className="AvatarStack__More AvatarStack__More--btn" onClick={onOverflowClick}>
            +{remaining}
          </button>
        ) : (
          <span className="AvatarStack__More">+{remaining}</span>
        )
      )}
    </div>
  );
}
