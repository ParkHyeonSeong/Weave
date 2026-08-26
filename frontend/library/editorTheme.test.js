import { describe, it, expect } from 'vitest';
import { themeExtensionFor, createThemeBinding } from './editorTheme.js';

// @codemirror/* 를 로드하지 않는다 — 이 모듈은 모듈 객체를 주입받는 순수 모듈이라
// vitest environment: 'node' 에서 그대로 돈다.
const MOD = { oneDark: ['ONE_DARK'], oneDarkTheme: ['ONE_DARK_THEME'] };

class FakeCompartment {
  of(ext) { return { kind: 'of', ext }; }
  reconfigure(ext) { return { kind: 'reconfigure', ext }; }
}

const deferred = () => { let r; const p = new Promise((res) => { r = res; }); return { p, r }; };

describe('themeExtensionFor — resolved → CodeMirror 확장', () => {
  it("dark + variant 'full' 은 oneDark(테마 + 구문 하이라이트)", () => {
    expect(themeExtensionFor('dark', MOD, 'full')).toEqual([MOD.oneDark]);
  });

  it("dark + variant 'chrome' 은 oneDarkTheme만 (구문 하이라이트 제외)", () => {
    expect(themeExtensionFor('dark', MOD, 'chrome')).toEqual([MOD.oneDarkTheme]);
  });

  it('light 는 빈 배열 — CM 기본이 라이트다', () => {
    expect(themeExtensionFor('light', MOD, 'full')).toEqual([]);
    expect(themeExtensionFor('light', MOD, 'chrome')).toEqual([]);
  });

  it("알 수 없는 값은 light로 폴백한다 ('dark' 정확 일치만 다크)", () => {
    for (const v of [undefined, null, 'system', 'DARK', 'Dark', 42, {}]) {
      expect(themeExtensionFor(v, MOD, 'full'), String(v)).toEqual([]);
    }
  });

  it('모듈이 아직 로드 안 됐으면(falsy) dark여도 빈 배열이다', () => {
    expect(themeExtensionFor('dark', null, 'full')).toEqual([]);
    expect(themeExtensionFor('dark', undefined, 'chrome')).toEqual([]);
    expect(themeExtensionFor('dark', {}, 'full')).toEqual([]);       // export 누락 방어
  });
});

describe('createThemeBinding — 재생성 없이 재구성 + 최신값 읽기', () => {
  const mk = (opts) => createThemeBinding({
    Compartment: FakeCompartment, getOneDark: () => MOD, variant: 'full', ...opts,
  });

  it('initial()은 compartment.of를, reconfigure()는 compartment.reconfigure를 쓴다', () => {
    const b = mk({ getResolved: () => 'dark' });
    expect(b.compartment).toBeInstanceOf(FakeCompartment);
    expect(b.initial()).toEqual({ kind: 'of', ext: [MOD.oneDark] });
    expect(b.reconfigure()).toEqual({ kind: 'reconfigure', ext: [MOD.oneDark] });
  });

  // 회귀 1: loadCmModules() await 창. 이 테스트가 RED가 되는 구현 = "값을 클로저로 캡처"하는 구현.
  it('await loadCmModules() 창에서 테마가 바뀌면 에디터 생성 시점의 최신 값이 적용된다', async () => {
    let resolved = 'light';
    const b = mk({ getResolved: () => resolved });
    const created = (async () => { await Promise.resolve(); return b.initial(); })();   // 동적 import 대기 창
    resolved = 'dark';              // 그 창에서 사용자가 테마를 바꿨다
    expect(await created).toEqual({ kind: 'of', ext: [MOD.oneDark] });
  });

  // 회귀 2: provider.once('sync') 무한 대기 창
  it("provider.once('sync') 대기 창에서 바뀌어도 마찬가지다", async () => {
    let resolved = 'light';
    const synced = deferred();
    const b = mk({ getResolved: () => resolved });
    const created = (async () => { await synced.p; return b.initial(); })();
    resolved = 'dark';              // sync 도착 전에 테마 변경
    synced.r();                     // WebSocket sync 도착
    expect(await created).toEqual({ kind: 'of', ext: [MOD.oneDark] });
  });

  it('생성 이후의 테마 변경도 reconfigure()가 최신값을 읽는다', () => {
    let resolved = 'dark';
    const b = mk({ getResolved: () => resolved, variant: 'chrome' });
    expect(b.initial()).toEqual({ kind: 'of', ext: [MOD.oneDarkTheme] });
    resolved = 'light';
    expect(b.reconfigure()).toEqual({ kind: 'reconfigure', ext: [] });
  });

  it('모듈 로드가 늦어도 binding 생성이 깨지지 않는다', () => {
    let mod = null;
    const b = mk({ getResolved: () => 'dark', getOneDark: () => mod });
    expect(b.initial()).toEqual({ kind: 'of', ext: [] });
    mod = MOD;
    expect(b.reconfigure()).toEqual({ kind: 'reconfigure', ext: [MOD.oneDark] });
  });
});
