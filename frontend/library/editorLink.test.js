import { describe, it, expect } from 'vitest';
import { normalizeLinkHref, isSafeLinkHref } from './editorLink.js';

describe('normalizeLinkHref', () => {
  it('bare domain에 https를 붙인다', () => {
    expect(normalizeLinkHref('example.com')).toBe('https://example.com');
    expect(normalizeLinkHref('sub.example.com/p?q=1')).toBe('https://sub.example.com/p?q=1');
  });

  it('http/https는 그대로 둔다', () => {
    expect(normalizeLinkHref('https://x.com')).toBe('https://x.com');
    expect(normalizeLinkHref('http://x.com')).toBe('http://x.com');
  });

  it('다른 스킴(mailto/tel/ftp/sms/callto)을 보존한다', () => {
    expect(normalizeLinkHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(normalizeLinkHref('tel:123')).toBe('tel:123');
    expect(normalizeLinkHref('ftp://h/f')).toBe('ftp://h/f');
    expect(normalizeLinkHref('sms:123')).toBe('sms:123');
    expect(normalizeLinkHref('callto:x')).toBe('callto:x');
  });

  it('내부/상대 경로·앵커·쿼리·프로토콜상대를 보존한다', () => {
    expect(normalizeLinkHref('/branch/123')).toBe('/branch/123');
    expect(normalizeLinkHref('./x')).toBe('./x');
    expect(normalizeLinkHref('../x')).toBe('../x');
    expect(normalizeLinkHref('#anchor')).toBe('#anchor');
    expect(normalizeLinkHref('?q=1')).toBe('?q=1');
    expect(normalizeLinkHref('//cdn.example.com/a.js')).toBe('//cdn.example.com/a.js');
  });

  it('이메일은 mailto:를 붙인다', () => {
    expect(normalizeLinkHref('a@b.com')).toBe('mailto:a@b.com');
  });

  it('userinfo@host:port 형태는 이메일이 아니라 URL로 본다', () => {
    expect(normalizeLinkHref('user@example.com:8080')).toBe('https://user@example.com:8080');
  });

  it('앞뒤 공백을 제거한다', () => {
    expect(normalizeLinkHref('  example.com  ')).toBe('https://example.com');
  });

  it('빈 값/공백/null/undefined는 빈 문자열', () => {
    expect(normalizeLinkHref('')).toBe('');
    expect(normalizeLinkHref('   ')).toBe('');
    expect(normalizeLinkHref(null)).toBe('');
    expect(normalizeLinkHref(undefined)).toBe('');
  });

  it('정규화만 한다 — javascript:는 판단 없이 그대로 반환', () => {
    expect(normalizeLinkHref('javascript:alert(1)')).toBe('javascript:alert(1)');
  });
});

describe('isSafeLinkHref', () => {
  it('위험 스킴은 false', () => {
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkHref('data:text/html,<script>')).toBe(false);
  });

  it('빈 값/null/undefined는 false', () => {
    expect(isSafeLinkHref('')).toBe(false);
    expect(isSafeLinkHref(null)).toBe(false);
    expect(isSafeLinkHref(undefined)).toBe(false);
  });

  it('정상 href는 true', () => {
    expect(isSafeLinkHref('https://x.com')).toBe(true);
    expect(isSafeLinkHref('/branch/1')).toBe(true);
    expect(isSafeLinkHref('mailto:a@b.com')).toBe(true);
    expect(isSafeLinkHref('ftp://h')).toBe(true);
  });
});
