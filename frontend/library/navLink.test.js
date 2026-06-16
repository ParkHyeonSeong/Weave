import { describe, it, expect } from 'vitest';
import { shouldInterceptNavClick } from './navLink.js';

describe('shouldInterceptNavClick', () => {
  it('평범한 좌클릭은 가로챈다(SPA 라우팅)', () => {
    expect(shouldInterceptNavClick({ button: 0 })).toBe(true);
    // 키보드 Enter 등 button이 없는 합성 클릭은 좌클릭으로 간주
    expect(shouldInterceptNavClick({})).toBe(true);
  });

  it('가운데/우클릭은 브라우저에 위임한다', () => {
    expect(shouldInterceptNavClick({ button: 1 })).toBe(false); // 가운데 → 새 탭
    expect(shouldInterceptNavClick({ button: 2 })).toBe(false); // 우클릭 → 컨텍스트 메뉴
  });

  it('수정자 키 클릭은 위임한다(새 탭/창)', () => {
    expect(shouldInterceptNavClick({ button: 0, metaKey: true })).toBe(false);
    expect(shouldInterceptNavClick({ button: 0, ctrlKey: true })).toBe(false);
    expect(shouldInterceptNavClick({ button: 0, shiftKey: true })).toBe(false);
    expect(shouldInterceptNavClick({ button: 0, altKey: true })).toBe(false);
  });

  it('이미 preventDefault된 이벤트는 가로채지 않는다(좌클릭=패널 등 사이드이펙트 우선)', () => {
    expect(shouldInterceptNavClick({ button: 0, defaultPrevented: true })).toBe(false);
  });

  it('이벤트가 없으면 false', () => {
    expect(shouldInterceptNavClick(null)).toBe(false);
    expect(shouldInterceptNavClick(undefined)).toBe(false);
  });
});
