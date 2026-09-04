// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useTheme, THEME_STORAGE_KEY } from './theme';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { mode, resolved } = useTheme();
  return <span id="probe">{`${mode}:${resolved}`}</span>;
}

let mq;          // 현재 matchMedia 스텁 (리스너 배열 포함)
let activeRoot;  // afterEach 일괄 unmount용

beforeEach(() => {
  mq = {
    matches: false,
    listeners: [],
    addEventListener: (_ev, fn) => mq.listeners.push(fn),
    removeEventListener: (_ev, fn) => { mq.listeners = mq.listeners.filter((f) => f !== fn); },
  };
  window.matchMedia = vi.fn().mockReturnValue(mq);
  // withTransitionsSuppressed의 rAF — jsdom 기본엔 없을 수 있어 동기 스텁
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('theme-switching');
  document.head.innerHTML = '<meta name="theme-color" content="">';
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  if (activeRoot) { act(() => activeRoot.unmount()); activeRoot = null; }
  vi.restoreAllMocks();
});

function mount(props = {}) {
  activeRoot = createRoot(document.getElementById('root'));
  act(() => {
    activeRoot.render(<ThemeProvider {...props}><Probe /></ThemeProvider>);
  });
  return activeRoot;
}

describe('ThemeProvider (실마운트)', () => {
  it('미러 dark 채택 → 소비자·DOM·meta 동기', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    mount();
    expect(document.getElementById('probe').textContent).toBe('dark:dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]').content).toBe('#0E0F11');
  });

  it('미러 없음 + OS 라이트 → system이어도 light', () => {
    mount();
    expect(document.getElementById('probe').textContent).toBe('system:light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('storage 이벤트 채택 → React 소비자까지 재렌더 (DOM만 아님)', () => {
    mount();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    });
    expect(document.getElementById('probe').textContent).toBe('dark:dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]').content).toBe('#0E0F11');
  });

  it('무관한 storage 키는 무시', () => {
    mount();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'sidebar_width', newValue: '300' }));
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('matchMedia 전이 반영 (systemEnabled 주입 = 플래그 값과 무관하게 GA 경로 고정)', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    mount({ systemEnabled: true });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    act(() => { mq.listeners.forEach((fn) => fn({ matches: true })); }); // OS 라이트→다크
    expect(document.getElementById('probe').textContent).toBe('system:dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('unmount cleanup — storage/matchMedia 콜백 동일성으로 해제 검증', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const root = mount();
    expect(mq.listeners.length).toBe(1);
    const addedStorage = addSpy.mock.calls.filter(([ev]) => ev === 'storage').map(([, fn]) => fn);
    expect(addedStorage.length).toBe(1);
    act(() => { root.unmount(); });
    activeRoot = null;
    expect(mq.listeners.length).toBe(0); // matchMedia: add된 콜백이 remove로 제거됨(동일성은 스텁 filter가 보증)
    const removedStorage = removeSpy.mock.calls.filter(([ev]) => ev === 'storage').map(([, fn]) => fn);
    expect(removedStorage).toContain(addedStorage[0]); // storage: add/remove 콜백 동일성
  });
});
