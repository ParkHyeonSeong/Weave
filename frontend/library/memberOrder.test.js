// frontend/library/memberOrder.test.js
import { describe, it, expect } from 'vitest';
import { orderMembersForPicker } from './memberOrder.js';

const m = (user_id, username) => ({ user_id, username });

describe('orderMembersForPicker', () => {
  it('본인이 맨 앞, 나머지는 username 오름차순', () => {
    const members = [m(3, 'Lee Jin Gyu'), m(1, '박현성'), m(2, 'Wonseok Shin'), m(4, 'Ahn')];
    expect(orderMembersForPicker(members, 2).map((x) => x.user_id)).toEqual([2, 1, 4, 3]);
  });
  it('혼합 언어는 ko locale 계약: 한글이 영문보다 앞(로컬 Node 20.20.2·Docker Node 22.23.2, 둘 다 ICU 78.2 실측)', () => {
    // 어느 환경에서든 이 결과가 다르면 기대값을 바꾸지 말고 locale/runtime 계약 문제로 HOLD.
    const members = [m(1, '박현성'), m(2, 'Ahn'), m(3, '김철수')];
    expect(orderMembersForPicker(members, null).map((x) => x.username)).toEqual(['김철수', '박현성', 'Ahn']);
  });
  it('myUserId가 null/undefined면 전체 이름순', () => {
    const members = [m(2, 'b'), m(1, 'a')];
    expect(orderMembersForPicker(members, null).map((x) => x.user_id)).toEqual([1, 2]);
    expect(orderMembersForPicker(members, undefined).map((x) => x.user_id)).toEqual([1, 2]);
  });
  it('본인이 members에 없으면 가짜 항목 없이 전체 이름순', () => {
    const members = [m(2, 'b'), m(1, 'a')];
    const out = orderMembersForPicker(members, 99);
    expect(out.map((x) => x.user_id)).toEqual([1, 2]);
    expect(out).toHaveLength(2);
  });
  it('username 누락은 빈 문자열로 취급(크래시 없음)', () => {
    const members = [m(1, 'a'), { user_id: 2 }];
    expect(orderMembersForPicker(members, null).map((x) => x.user_id)).toEqual([2, 1]);
  });
  it('입력 배열을 변경하지 않는다', () => {
    const members = [m(2, 'b'), m(1, 'a')];
    const snapshot = members.map((x) => x.user_id);
    orderMembersForPicker(members, 1);
    expect(members.map((x) => x.user_id)).toEqual(snapshot);
  });
  it('유효하지 않은 members 입력은 빈 배열', () => {
    expect(orderMembersForPicker(null, 1)).toEqual([]);
    expect(orderMembersForPicker(undefined, 1)).toEqual([]);
    expect(orderMembersForPicker('nope', 1)).toEqual([]);
    expect(orderMembersForPicker({ user_id: 1 }, 1)).toEqual([]);
  });
});
