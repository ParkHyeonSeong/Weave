import { describe, it, expect } from 'vitest';
import { getErrorCode, getError } from './errorCode.js';

describe('getErrorCode', () => {
  it('마이그레이션된 응답: code를 우선 반환', () => {
    expect(getErrorCode({ status: false, message: 'NOT_BRANCH_MEMBER', code: 'NOT_BRANCH_MEMBER' }))
      .toBe('NOT_BRANCH_MEMBER');
  });
  it('구형/deferred 응답: code가 없으면 message로 폴백', () => {
    expect(getErrorCode({ status: false, message: 'NOT_A_MEMBER' })).toBe('NOT_A_MEMBER');
  });
  it('성공 응답/코드 없음 → null', () => {
    expect(getErrorCode({ status: true, tasks: [] })).toBe(null);
  });
  it('null/undefined/비객체 → null', () => {
    expect(getErrorCode(null)).toBe(null);
    expect(getErrorCode(undefined)).toBe(null);
    expect(getErrorCode('NOT_BRANCH_MEMBER')).toBe(null); // 문자열은 응답 본문이 아님
  });
});

describe('getError', () => {
  it('마이그레이션된 응답: code/category/retryable 노출', () => {
    expect(getError({ status: false, message: 'RATE_LIMIT_EXCEEDED', code: 'RATE_LIMIT_EXCEEDED', category: 'rate_limited', retryable: true }))
      .toEqual({ code: 'RATE_LIMIT_EXCEEDED', category: 'rate_limited', retryable: true, message: 'RATE_LIMIT_EXCEEDED' });
  });
  it('구형 응답: category null, retryable false', () => {
    expect(getError({ status: false, message: 'NOT_A_MEMBER' }))
      .toEqual({ code: 'NOT_A_MEMBER', category: null, retryable: false, message: 'NOT_A_MEMBER' });
  });
  it('null → 전부 빈 값', () => {
    expect(getError(null)).toEqual({ code: null, category: null, retryable: false, message: null });
  });
});
