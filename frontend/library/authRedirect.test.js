import { describe, expect, it } from 'vitest';
import {
  buildChangePasswordPath,
  buildLoginPath,
  getReturnToFromQuery,
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
});
