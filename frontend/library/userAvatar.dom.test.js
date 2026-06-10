// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildAvatarDOM, avatarMarkup } from './userAvatar.js';

describe('buildAvatarDOM', () => {
  it('사진 있으면 baseUrl 접두된 img 렌더', () => {
    const el = buildAvatarDOM(
      { username: '김철수', user_id: 3, avatar_url: '/api/uploads/avatars/a.png' },
      'http://h',
    );
    const img = el.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.src).toBe('http://h/api/uploads/avatars/a.png');
    expect(el.getAttribute('title')).toBe('김철수');
  });

  it('사진 없으면 이니셜+배경색', () => {
    const el = buildAvatarDOM({ username: 'henry', user_id: 1 });
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('HE');
    expect(el.style.background).not.toBe('');
  });

  it('이미지 로드 실패 시 이니셜로 폴백', () => {
    const el = buildAvatarDOM(
      { username: '김철수', user_id: 3, avatar_url: '/api/uploads/avatars/broken.png' },
      'http://h',
    );
    el.querySelector('img').onerror();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('철수');
  });

  it('악성 username도 textContent라 마크업 주입 불가', () => {
    const el = buildAvatarDOM({ username: '<img src=x onerror=alert(1)>', user_id: 1 });
    expect(el.querySelector('img')).toBeNull();
    expect(el.innerHTML).not.toContain('<img');
  });
});

describe('avatarMarkup — avatar_url 신뢰 경계', () => {
  it('외부 절대 URL은 사진으로 취급하지 않음 (트래킹 픽셀 차단)', () => {
    const m = avatarMarkup({ username: 'evil', user_id: 9, avatar_url: 'http://evil.com/p.gif' }, 'http://h');
    expect(m.src).toBeNull();
  });
  it('프로토콜 상대 URL(//)도 거부', () => {
    const m = avatarMarkup({ username: 'evil', user_id: 9, avatar_url: '//evil.com/p.gif' }, 'http://h');
    expect(m.src).toBeNull();
  });
  it('서버 상대 경로는 허용', () => {
    const m = avatarMarkup({ username: 'ok', user_id: 1, avatar_url: '/api/uploads/avatars/a.png' }, 'http://h');
    expect(m.src).toBe('http://h/api/uploads/avatars/a.png');
  });
});
