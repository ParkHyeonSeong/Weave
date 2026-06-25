import { describe, it, expect } from 'vitest';
import { errorText } from './errorText.js';

describe('errorText', () => {
  it('매핑된 코드 → 한국어 문구', () => {
    expect(errorText('KEY_ALREADY_EXISTS')).toBe('이미 사용 중인 키예요.');
    expect(errorText('SELF_LINK')).toBe('자기 자신과 연결할 수 없어요.');
    expect(errorText('LAST_ADMIN')).toContain('마지막 관리자');
    expect(errorText('INVALID_CREDENTIALS')).toBe('이메일 또는 비밀번호가 올바르지 않아요.');
  });
  it('매핑 없는 코드 + category → category 폴백', () => {
    expect(errorText('SOME_NEW_FORBIDDEN_CODE', 'forbidden')).toBe('권한이 없어요.');
    expect(errorText('SOME_VALIDATION', 'validation')).toBe('입력값을 확인해 주세요.');
  });
  it('코드 매핑이 우선(둘 다 있으면 코드 문구)', () => {
    expect(errorText('NOT_BRANCH_MEMBER', 'forbidden')).toBe('이 브랜치의 멤버가 아니에요.');
  });
  it('매핑도 category도 없으면 null(호출부 폴백)', () => {
    expect(errorText('TOTALLY_UNKNOWN')).toBe(null);
    expect(errorText(null)).toBe(null);
    expect(errorText('TOTALLY_UNKNOWN', 'no_such_category')).toBe(null);
  });
});
