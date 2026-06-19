// 마감일(ISO) → D-day 뱃지 분류. 통계 드릴인 팝오버 행에서 사용.
// 경계: 지남(over) / 0~2일 임박(soon) / 3일+ 여유(calm) / 없음(none).
export function ddayBadge(dueIso, today = new Date()) {
  if (!dueIso) return { cls: 'none', text: '—' };
  const base = new Date(today); base.setHours(0, 0, 0, 0);
  const due = new Date(dueIso + 'T00:00:00');
  const days = Math.round((due - base) / 86400000);
  if (days < 0) return { cls: 'over', text: `D+${-days}` };
  if (days <= 2) return { cls: 'soon', text: days === 0 ? 'D-day' : `D-${days}` };
  return { cls: 'calm', text: `D-${days}` };
}

export function fmtDate(iso) {
  if (!iso) return '마감 없음';
  const d = new Date(iso + 'T00:00:00');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${wd})`;
}
