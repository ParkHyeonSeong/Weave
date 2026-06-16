// 카드 셸: 상단 액센트캡 + 바디 + (옵션) 푸터 구분선. children으로 내용 주입.
// href를 주면 실제 <a>(NavLink)로 렌더해 가운데/ctrl/cmd/우클릭 '새 탭'을 네이티브로 지원한다.
import AvatarStack from '@/components/common/AvatarStack';
import NavLink from '@/components/common/NavLink';

export function AvatarSet({ members = [], max = 4 }) {
  return <AvatarStack users={members} max={max} className="HCard__Avatars" />;
}

export default function AppCard({ accent = '#5E6AD2', href, onClick, onContextMenu, children }) {
  const inner = (
    <>
      <span className="HCard__Accent" style={{ background: accent }} />
      <div className="HCard__Body">{children}</div>
    </>
  );

  if (href) {
    return (
      <NavLink className="HCard" href={href} onClick={onClick} onContextMenu={onContextMenu}>
        {inner}
      </NavLink>
    );
  }

  return (
    <button type="button" className="HCard" onClick={onClick} onContextMenu={onContextMenu}>
      {inner}
    </button>
  );
}
