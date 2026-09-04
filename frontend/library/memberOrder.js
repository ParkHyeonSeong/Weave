// frontend/library/memberOrder.js
// Main 담당자 피커 전용 멤버 순서(WEAVE-44): 본인 → 나머지 username 오름차순(ko locale).
// 순수 함수 — React/브라우저 의존 없음, 입력 배열은 변경하지 않는다.
// "Unassigned" 옵션은 각 피커가 앞에 직접 붙인다. 백엔드 members는 joined_at 순이며
// 필터 아바타 스트립·Sub 다중 선택기 등은 그 순서를 그대로 쓰므로 fetch 결과를 바꾸지 말고
// Main 피커 렌더 시점에만 이 함수를 적용한다.
const byUsernameKo = (a, b) =>
  String(a.username ?? '').localeCompare(String(b.username ?? ''), 'ko');

export function orderMembersForPicker(members, myUserId) {
  const list = Array.isArray(members) ? members : [];
  const isMe = (m) => myUserId != null && m.user_id === myUserId;
  const me = list.filter(isMe);
  const others = list.filter((m) => !isMe(m)).sort(byUsernameKo);
  return [...me, ...others];
}
