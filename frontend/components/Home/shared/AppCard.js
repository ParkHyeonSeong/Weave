// 카드 셸: 상단 액센트캡 + 바디 + (옵션) 푸터 구분선. children으로 내용 주입.
export function AvatarSet({ members = [], max = 4 }) {
  const shown = members.slice(0, max);
  return (
    <div className="HCard__Avatars">
      {shown.map((m, i) => (
        <span key={i} className="HCard__Avatar" style={{ background: m.color || '#5E6AD2' }} title={m.name}>
          {(m.name || '?').slice(0, 1)}
        </span>
      ))}
      {members.length > max && <span className="HCard__Avatar HCard__Avatar--more">+{members.length - max}</span>}
    </div>
  );
}

export default function AppCard({ accent = '#5E6AD2', onClick, children }) {
  return (
    <button type="button" className="HCard" onClick={onClick}>
      <span className="HCard__Accent" style={{ background: accent }} />
      <div className="HCard__Body">{children}</div>
    </button>
  );
}
