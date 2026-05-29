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
 * just now / Nm ago / Nh ago / Nd ago / 날짜
 */
export function formatRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
