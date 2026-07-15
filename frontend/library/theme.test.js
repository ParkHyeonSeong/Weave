import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  THEME_STORAGE_KEY, VALID_MODES, SYSTEM_ENABLED,
  normalizeMode, resolveTheme, mergeServerTheme, buildBootstrapScript, applyResolvedTheme,
} from './theme';

describe('normalizeMode — missing/invalid는 system (단일 계약)', () => {
  it.each([[null, 'system'], [undefined, 'system'], ['neon', 'system'],
           ['light', 'light'], ['dark', 'dark'], ['system', 'system']])('%s → %s', (raw, want) => {
    expect(normalizeMode(raw)).toBe(want);
  });
});

describe('resolveTheme', () => {
  it('preview(숨김): 명시적 dark만 dark — system/missing/invalid는 OS 무관 light', () => {
    for (const osDark of [false, true]) {
      expect(resolveTheme('dark', osDark, { systemEnabled: false })).toBe('dark');
      for (const raw of ['light', 'system', null, 'neon']) {
        expect(resolveTheme(raw, osDark, { systemEnabled: false })).toBe('light');
      }
    }
  });
  it('GA(공개): system·missing·invalid는 OS 추종', () => {
    for (const raw of ['system', null, 'neon']) {
      expect(resolveTheme(raw, true, { systemEnabled: true })).toBe('dark');
      expect(resolveTheme(raw, false, { systemEnabled: true })).toBe('light');
    }
    expect(resolveTheme('light', true, { systemEnabled: true })).toBe('light');
    expect(resolveTheme('dark', false, { systemEnabled: true })).toBe('dark');
  });
  it('기본 옵션은 SYSTEM_ENABLED 플래그를 따른다', () => {
    expect(resolveTheme('system', true)).toBe(SYSTEM_ENABLED ? 'dark' : 'light');
  });
});

describe('mergeServerTheme — 스펙 §3 전이표 (서버 권위는 성공 조회에만)', () => {
  it("loadStatus가 success가 아니면(loading/error/skipped) 미러 유지 — GET 실패·공개경로·로그아웃 커버", () => {
    for (const loadStatus of ['loading', 'error', 'skipped']) {
      expect(mergeServerTheme({ loadStatus, serverTheme: 'light', localMode: 'dark' }, { systemEnabled: true }))
        .toEqual({ mode: 'dark', mirrorWrite: null });
    }
  });
  it('숨김 기간: success여도 서버 무시 — devtools 프리뷰 보존', () => {
    expect(mergeServerTheme({ loadStatus: 'success', serverTheme: 'light', localMode: 'dark' }, { systemEnabled: false }))
      .toEqual({ mode: 'dark', mirrorWrite: null });
  });
  it('공개 후: 서버 유효 & 로컬과 다름 → 서버 우선 + 미러 갱신', () => {
    expect(mergeServerTheme({ loadStatus: 'success', serverTheme: 'dark', localMode: 'light' }, { systemEnabled: true }))
      .toEqual({ mode: 'dark', mirrorWrite: 'dark' });
  });
  it('공개 후: 서버 == 로컬 → 무동작', () => {
    expect(mergeServerTheme({ loadStatus: 'success', serverTheme: 'dark', localMode: 'dark' }, { systemEnabled: true }))
      .toEqual({ mode: 'dark', mirrorWrite: null });
  });
  it('공개 후: 서버 부재 → system 기본값 + 미러 덮어쓰기 (계정 전환 노출 차단)', () => {
    expect(mergeServerTheme({ loadStatus: 'success', serverTheme: undefined, localMode: 'dark' }, { systemEnabled: true }))
      .toEqual({ mode: 'system', mirrorWrite: 'system' });
  });
  it('공개 후: 서버 잘못된 값 → system 취급 + 미러 정정', () => {
    expect(mergeServerTheme({ loadStatus: 'success', serverTheme: 'neon', localMode: 'dark' }, { systemEnabled: true }))
      .toEqual({ mode: 'system', mirrorWrite: 'system' });
  });
});

// 부트스트랩 문자열은 resolver와 의미론을 공유해야 한다 — 전수 parity로 고정.
// (S10 플래그 플립 시 bootstrap/runtime 불일치로 첫 페인트가 어긋나는 회귀 차단)
describe('buildBootstrapScript ↔ resolveTheme parity', () => {
  function evalBootstrap(script, { stored, osDark, storageThrows = false }) {
    let attr = null;
    const meta = { content: '' };
    const localStorage = storageThrows
      ? { getItem: () => { throw new Error('denied'); } }
      : { getItem: (k) => (k === THEME_STORAGE_KEY ? stored : null) };
    const document = {
      documentElement: { setAttribute: (k, v) => { if (k === 'data-theme') attr = v; } },
      querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
    };
    const window = { matchMedia: () => ({ matches: osDark }) };
    new Function('localStorage', 'document', 'window', script)(localStorage, document, window);
    return { attr, metaColor: meta.content };
  }

  it('preview/GA × 저장값 × OS 전수 일치', () => {
    for (const systemEnabled of [false, true]) {
      const script = buildBootstrapScript({ systemEnabled });
      for (const stored of [null, 'light', 'dark', 'system', 'neon']) {
        for (const osDark of [false, true]) {
          const want = resolveTheme(stored, osDark, { systemEnabled });
          const got = evalBootstrap(script, { stored, osDark });
          expect(got.attr, `flag=${systemEnabled} stored=${stored} os=${osDark}`).toBe(want);
          expect(got.metaColor).toBe(want === 'dark' ? '#0E0F11' : '#FFFFFF');
        }
      }
    }
  });
  it('localStorage 예외도 런타임과 동치 — getStoredMode()의 null과 같은 경로 (GA에서 OS 추종해야 함)', () => {
    // storage 읽기만 try로 감싸는 계약: 예외 ≡ 저장값 null. preview는 light, GA는 OS 추종.
    for (const systemEnabled of [false, true]) {
      const script = buildBootstrapScript({ systemEnabled });
      for (const osDark of [false, true]) {
        const want = resolveTheme(null, osDark, { systemEnabled });
        const got = evalBootstrap(script, { stored: null, osDark, storageThrows: true });
        expect(got.attr, `flag=${systemEnabled} os=${osDark} throw`).toBe(want);
        expect(got.metaColor).toBe(want === 'dark' ? '#0E0F11' : '#FFFFFF');
      }
    }
  });
});

describe('applyResolvedTheme — attr + meta 멱등 동기', () => {
  function fakeDoc(initialAttr) {
    const attrs = { 'data-theme': initialAttr };
    const meta = { content: '' };
    return {
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] },
      querySelector: (sel) => (sel === 'meta[name="theme-color"]' ? meta : null),
      _attrs: attrs, _meta: meta,
    };
  }
  it('스탬프 + meta 갱신', () => {
    const doc = fakeDoc('light');
    applyResolvedTheme('dark', doc);
    expect(doc._attrs['data-theme']).toBe('dark');
    expect(doc._meta.content).toBe('#0E0F11');
  });
  it('attr가 이미 맞아도 meta는 동기된다 (dark 새로고침에서 meta 흰색 잔존 방지)', () => {
    const doc = fakeDoc('dark');
    applyResolvedTheme('dark', doc);
    expect(doc._meta.content).toBe('#0E0F11');
  });
});

describe('public/theme-boot.js ↔ buildBootstrapScript 동기화', () => {
  it('파일 내용 = 생성원 출력', () => {
    const file = readFileSync(resolve(__dirname, '../public/theme-boot.js'), 'utf8').trim();
    expect(file).toBe(buildBootstrapScript());
  });
});
