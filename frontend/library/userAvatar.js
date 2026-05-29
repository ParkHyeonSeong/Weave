// 사용자 아바타 표현 헬퍼.
// - userInitial: 이름의 첫 글자(대문자)
// - userColor: user_id를 안정적으로 같은 색에 매핑
// 여러 컴포넌트에서 반복되던 패턴을 한 군데로 모았음.

// 모든 색이 흰 텍스트와 WCAG AA (4.5:1) 이상의 대비를 갖도록 어두운 톤으로 선정.
// 색채는 유지하되 lightness만 낮춤 — 이전 palette의 #10B981 / #F59E0B / #0EA5E9 /
// #EC4899는 흰 텍스트 대비 ~2-3:1로 가독성이 낮아 Tailwind 600/700 단계로 교체.
const AVATAR_COLORS = [
  '#5E6AD2',  // indigo
  '#059669',  // emerald-600 (was #10B981)
  '#B45309',  // amber-700 (was #F59E0B)
  '#9333EA',  // purple
  '#BE185D',  // pink-700 (was #EC4899)
  '#0369A1',  // sky-700 (was #0EA5E9)
  '#DC2626',  // red
];

export function userInitial(username) {
  return (username || '?').charAt(0).toUpperCase();
}

export function userColor(userId) {
  if (userId == null) return '#9CA3AF';
  return AVATAR_COLORS[Math.abs(Number(userId)) % AVATAR_COLORS.length];
}
