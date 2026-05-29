/**
 * 메시지 시간 포맷
 * 오늘: HH:MM / 그 외: MM/DD HH:MM
 */
export function formatMessageTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) {
    return `${hours}:${minutes}`;
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

/**
 * 상대 시간 포맷
 * just now / Nm ago / Nh ago / yesterday / Nd ago / Nw ago / Nmo ago / 날짜
 *
 * yesterday는 (now와 t의) calendar day diff 기준 — 시간 diff가 23h여도
 * 같은 calendar day면 "Nh ago", 어제면 "yesterday".
 */
export function formatRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  const tMs = t.getTime();
  if (Number.isNaN(tMs)) return '';
  const now = new Date();
  const diff = (now.getTime() - tMs) / 1000;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;

  // calendar-day 기반 yesterday
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (t.getFullYear() === y.getFullYear()
      && t.getMonth() === y.getMonth()
      && t.getDate() === y.getDate()) {
    return 'yesterday';
  }

  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;          // <7d
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;        // <30d
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;     // <1y
  return t.toLocaleDateString();
}
