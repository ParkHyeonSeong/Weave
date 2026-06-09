import { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { avatarMarkup } from '@/library/userAvatar';
import { getBaseURL } from '@/library/_axios';

const SIZES = { xs: 18, sm: 24, md: 32, lg: 80 };

// 사진 -> 이니셜+색 -> 중립 아이콘 순으로 폴백하는 단일 아바타.
export default function Avatar({
  user, name, userId, avatarUrl, avatarColor,
  size = 'sm', title, className = '',
}) {
  const [imgError, setImgError] = useState(false);
  const u = user || { username: name, user_id: userId, avatar_url: avatarUrl, avatar_color: avatarColor };
  const m = avatarMarkup(u, getBaseURL());
  const px = typeof size === 'number' ? size : (SIZES[size] || SIZES.sm);
  const showImg = m.src && !imgError;
  const label = title || m.title;

  // 같은 <Avatar> 슬롯이 다른 유저로 재사용될 때 이전 이미지 실패 상태가
  // 남아 새 사진을 안 띄우는 문제 방지 — src가 바뀌면 폴백 상태 초기화.
  useEffect(() => {
    setImgError(false);
  }, [m.src]);

  return (
    <span
      className={`Avatar ${className}`}
      style={{
        width: px,
        height: px,
        fontSize: Math.round(px * 0.42),
        ...(showImg ? {} : { background: m.color }),
      }}
      title={label}
      aria-label={label}
    >
      {showImg ? (
        <img className="Avatar__Img" src={m.src} alt={label} onError={() => setImgError(true)} />
      ) : m.initials ? (
        m.initials
      ) : (
        <User size={Math.round(px * 0.55)} />
      )}
    </span>
  );
}
