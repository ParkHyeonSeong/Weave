import { describe, expect, it } from 'vitest';
import {
  appShellFlags,
  buildChangePasswordPath,
  buildLoginPath,
  getReturnToFromQuery,
  needsLayoutPath,
  normalizeReturnTo,
} from './authRedirect.js';

describe('auth redirect helpers', () => {
  it('preserves same-origin relative paths with query and hash', () => {
    expect(normalizeReturnTo('/branch/1?task=2#comments')).toBe('/branch/1?task=2#comments');
    expect(normalizeReturnTo('/canvas/3/4')).toBe('/canvas/3/4');
  });

  it('falls back for external, protocol-relative, empty, and public auth/setup paths', () => {
    const invalidValues = [
      '',
      '   ',
      'https://example.com/branch/1',
      'http://example.com/branch/1',
      '//example.com/branch/1',
      'branch/1',
      '/auth/login',
      '/auth/login?returnTo=/branch/1',
      '/auth/change-password',
      '/auth/reset',
      '/setup',
    ];

    for (const value of invalidValues) {
      expect(normalizeReturnTo(value)).toBe('/');
    }
  });

  it('builds login and change-password paths with encoded returnTo', () => {
    const returnTo = '/branch/1?task=2#comments';

    expect(buildLoginPath(returnTo)).toBe('/auth/login?returnTo=%2Fbranch%2F1%3Ftask%3D2%23comments');
    expect(buildChangePasswordPath(returnTo)).toBe(
      '/auth/change-password?returnTo=%2Fbranch%2F1%3Ftask%3D2%23comments'
    );
  });

  it('omits returnTo query when the target falls back home', () => {
    expect(buildLoginPath('/auth/login')).toBe('/auth/login');
    expect(buildChangePasswordPath('https://example.com')).toBe('/auth/change-password');
  });

  it('reads returnTo from Next router query safely', () => {
    expect(getReturnToFromQuery({ returnTo: '/my-tasks' })).toBe('/my-tasks');
    expect(getReturnToFromQuery({ returnTo: ['/my-tasks'] })).toBe('/');
    expect(getReturnToFromQuery({ returnTo: '' })).toBe('/');
    expect(getReturnToFromQuery({})).toBe('/');
  });

  it('falls back for backslash and ASCII control-char payloads that the URL parser later re-normalizes', () => {
    // 브라우저/Next URL 파서는 백슬래시를 '/'로 바꾸고 탭/LF/CR을 제거한다. 원본 문자열만 보는
    // prefix 검사를 통과시킨 뒤 '//evil.com'(외부 탈출)이나 blocked prefix로 붕괴할 수 있는 값들.
    const redirectBypass = [
      '/\t/evil.com', // 탭 -> //evil.com
      '/\n/evil.com', // LF
      '/\r/evil.com', // CR
      '/\\evil.com',
      '/\\/evil.com',
      '\\evil.com',
      '/au\tth/login', // 제어문자가 사라지며 blocked prefix로 붕괴
      '/auth/log\tin',
      '/set\nup',
    ];

    for (const value of redirectBypass) {
      expect(normalizeReturnTo(value)).toBe('/');
    }
    // 비출력 제어문자(DEL 0x7F, C0 0x01)도 동일하게 차단 — escape 표기 대신 fromCharCode로 명시
    expect(normalizeReturnTo('/x' + String.fromCharCode(0x7f))).toBe('/');
    expect(normalizeReturnTo('/y' + String.fromCharCode(0x01))).toBe('/');
    // 쿼리 경로(getReturnToFromQuery)도 같은 가드를 거친다
    expect(getReturnToFromQuery({ returnTo: '/\t/evil.com' })).toBe('/');
  });

  it('blocks nested auth/setup paths but preserves lookalikes (no over-blocking)', () => {
    expect(normalizeReturnTo('/auth/login/callback')).toBe('/');
    expect(normalizeReturnTo('/auth/change-password/step2')).toBe('/');
    expect(normalizeReturnTo('/setup/wizard')).toBe('/');
    // 접두만 같은 정상 경로는 통과해야 한다
    expect(normalizeReturnTo('/setups')).toBe('/setups');
    expect(normalizeReturnTo('/auth/loginx')).toBe('/auth/loginx');
    expect(normalizeReturnTo('/branch/1/sub/2?x=1#h')).toBe('/branch/1/sub/2?x=1#h');
  });
});

describe('needsLayoutPath — public exact / admin segment 경계', () => {
  it.each([
    ['/auth/login', false], ['/auth/change-password', false], ['/auth/reset', false], ['/setup', false],
    ['/admin', false], ['/admin/integrations', false],
    ['/', true], ['/branch/1', true],
    ['/setup-guide', true],   // startsWith였다면 오분류되던 경로
    ['/administer', true],    // 〃
    ['/auth/login-help', true], // PUBLIC exact 매칭 확인
  ])('%s → needsLayout %s', (path, want) => {
    expect(needsLayoutPath(path)).toBe(want);
  });
});

describe('appShellFlags — prefs 조회는 인증 상태 단독 (스펙 §3)', () => {
  it('미인증 public→private transient: 경로가 private여도 세션 없으면 fetch 금지', () => {
    expect(appShellFlags('/branch/1', false).prefsFetchEnabled).toBe(false);
  });
  it('정상 로그인 경유 change-password: PUBLIC_PATHS여도 세션 있으면 fetch', () => {
    expect(appShellFlags('/auth/change-password', true).prefsFetchEnabled).toBe(true);
  });
  it('cookie-only 새 탭 change-password(세션 없음): fetch 금지 — 수용된 한계', () => {
    expect(appShellFlags('/auth/change-password', false).prefsFetchEnabled).toBe(false);
  });
});
