import { describe, it, expect } from 'vitest';
import { avatarInitials, userColor, AVATAR_COLORS, avatarMarkup } from './userAvatar.js';

describe('avatarInitials', () => {
  const cases = [
    // 영문 단일 토큰 -> 앞 2글자
    ['henry', 'HE'],
    ['hanna', 'HA'],
    ['scrumu1', 'SC'],
    ['j', 'J'],
    // 영문 공백/구분자 -> 첫+끝 토큰
    ['Henry Kim', 'HK'],
    ['henry.kim', 'HK'],
    ['min_su', 'MS'],
    ['ada-lovelace', 'AL'],
    // 이메일 -> @앞부분
    ['henry@x.com', 'HE'],
    // 기호/숫자 시작
    ['123kim', 'KI'],
    ['🚀rocket', 'RO'],
    ['123', '12'],
    // 한글 -> 성 제외 이름(최대 2자)
    ['김철수', '철수'],
    ['김영희', '영희'],
    ['박현성', '현성'],
    ['이건우', '건우'],
    ['남궁민수', '민수'],
    ['김 철수', '철수'],
    ['이건', '이건'],
    // 빈 값
    ['', ''],
    ['   ', ''],
    [null, ''],
    [undefined, ''],
  ];
  it.each(cases)('avatarInitials(%j) === %j', (input, expected) => {
    expect(avatarInitials(input)).toBe(expected);
  });
});

describe('userColor', () => {
  it('12색 팔레트', () => {
    expect(AVATAR_COLORS).toHaveLength(12);
  });
  it('user_id를 안정적으로 같은 색에 매핑', () => {
    expect(userColor(3)).toBe(userColor(3));
  });
  it('서로 다른 id는 더 넓은 팔레트로 분산(1과 8이 더이상 동일 색 아님)', () => {
    expect(userColor(1)).not.toBe(userColor(8));
  });
  it('null id -> 중립 회색', () => {
    expect(userColor(null)).toBe('#9CA3AF');
  });
  it('유효한 override는 그대로 사용', () => {
    expect(userColor(3, '#DC2626')).toBe('#DC2626');
  });
  it('팔레트에 없는 override는 무시', () => {
    expect(userColor(3, '#000000')).toBe(userColor(3));
  });
});

describe('avatarMarkup', () => {
  it('사진 있으면 src에 baseUrl 접두', () => {
    const m = avatarMarkup({ username: '김철수', user_id: 3, avatar_url: '/api/uploads/avatars/a.png' }, 'http://h');
    expect(m.src).toBe('http://h/api/uploads/avatars/a.png');
    expect(m.initials).toBe('철수');
  });
  it('사진 없으면 src=null, 색/이니셜 계산', () => {
    const m = avatarMarkup({ username: 'henry', user_id: 1 });
    expect(m.src).toBeNull();
    expect(m.initials).toBe('HE');
    expect(typeof m.color).toBe('string');
  });
  it('다양한 필드명 수용(name/color/author_id)', () => {
    const m = avatarMarkup({ name: 'Ada Lovelace', author_id: 9, color: '#DC2626' });
    expect(m.initials).toBe('AL');
    expect(m.color).toBe('#DC2626');
    expect(m.title).toBe('Ada Lovelace');
  });
});
