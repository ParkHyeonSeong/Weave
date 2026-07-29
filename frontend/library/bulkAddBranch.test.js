import { describe, it, expect } from 'vitest';
import { toBranchId, resolveBranchChange } from './bulkAddBranch';

describe('toBranchId — CustomSelect 값 정규화', () => {
  it('숫자·숫자문자열을 같은 수로 정규화한다', () => {
    expect(toBranchId(13)).toBe(13);
    expect(toBranchId('13')).toBe(13);
  });
  it('null/undefined/빈문자열은 null', () => {
    expect(toBranchId(null)).toBeNull();
    expect(toBranchId(undefined)).toBeNull();
    expect(toBranchId('')).toBeNull();
  });
  it('숫자가 아닌 값은 null(NaN 유출 금지 — NaN !== NaN이라 changed가 항상 true가 된다)', () => {
    expect(toBranchId('abc')).toBeNull();
  });
});

describe('resolveBranchChange — 같은 branch 재선택은 no-op (Epic/Sprint 드롭다운 영구 공란 회귀)', () => {
  // 회귀 시나리오: branch가 1개인 워크스페이스에서 Add by Epic을 열고 Branch 셀렉트를 눌러
  // 이미 선택된 그 branch를 다시 고르면, 호출부가 epics를 비우는데 재조회 effect는
  // branchId 변화에만 반응해 다시 돌지 않는다 → Epic 목록이 영영 비어 BulkAdd를 쓸 수 없다.
  // changed=false를 돌려 호출부가 초기화 자체를 건너뛰게 하는 것이 이 함수의 계약이다.
  it('같은 값 재선택 → changed=false (초기화 금지)', () => {
    expect(resolveBranchChange(13, 13)).toEqual({ changed: false, branchId: 13 });
  });
  it('문자열/숫자 표현만 다른 같은 값도 changed=false', () => {
    expect(resolveBranchChange(13, '13')).toEqual({ changed: false, branchId: 13 });
    expect(resolveBranchChange('13', 13)).toEqual({ changed: false, branchId: 13 });
  });
  it('실제로 다른 branch → changed=true + 새 id', () => {
    expect(resolveBranchChange(13, 14)).toEqual({ changed: true, branchId: 14 });
  });
  it('미선택(null)에서 최초 선택 → changed=true', () => {
    expect(resolveBranchChange(null, 13)).toEqual({ changed: true, branchId: 13 });
  });
  it('선택 해제(null) → changed=true + null', () => {
    expect(resolveBranchChange(13, null)).toEqual({ changed: true, branchId: null });
  });
  it('null → null 은 changed=false', () => {
    expect(resolveBranchChange(null, null)).toEqual({ changed: false, branchId: null });
  });
});
