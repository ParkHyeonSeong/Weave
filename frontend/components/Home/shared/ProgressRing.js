// 진행률(0~100)을 SVG 링으로. 시안 canvas-track.html의 ring SVG와 동일 형태.
// trackColor/textColor 기본값은 디자인 토큰($color-surface-hover 계열, $color-text)과 정렬.
export default function ProgressRing({
  value = 0,
  color = '#5E6AD2',
  size = 48,
  stroke = 5,
  trackColor = '#EEF0F4',
  textColor = '#1C1C1C',
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - v / 100);
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none' }} aria-label={`진행률 ${v}%`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`} />
      <text x={cx} y={cx + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={textColor}>{v}%</text>
    </svg>
  );
}
