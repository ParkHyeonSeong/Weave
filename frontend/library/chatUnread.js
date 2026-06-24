/**
 * /chat 응답의 rooms 배열에서 전체 미읽음 합계를 구한다.
 * rooms가 없거나 unread_count가 없는 항목은 0으로 처리한다.
 */
export function sumChatUnread(rooms) {
  return (rooms || []).reduce((sum, r) => sum + (r.unread_count || 0), 0);
}
