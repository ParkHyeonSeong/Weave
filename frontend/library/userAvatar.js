// 사용자 아바타 표현 헬퍼.
// - userInitial: 이름의 첫 글자(대문자)
// - userColor: user_id를 안정적으로 같은 색에 매핑
// 여러 컴포넌트에서 반복되던 패턴을 한 군데로 모았음.

const AVATAR_COLORS = [
  '#5E6AD2',
  '#10B981',
  '#F59E0B',
  '#9333EA',
  '#EC4899',
  '#0EA5E9',
  '#DC2626',
];

export function userInitial(username) {
  return (username || '?').charAt(0).toUpperCase();
}

export function userColor(userId) {
  if (userId == null) return '#9CA3AF';
  return AVATAR_COLORS[Math.abs(Number(userId)) % AVATAR_COLORS.length];
}
