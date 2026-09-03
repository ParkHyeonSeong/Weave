// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';
import { ThemeProvider, ThemeServerSync, THEME_STORAGE_KEY } from '@/library/theme';
import { UiPrefsProvider } from '@/library/UiPrefsContext';
import AppearanceSection from '@/components/Profile/AppearanceSection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot;

// ─── 공통 jsdom 하네스 (themePreference.dom.test.js와 같은 블록) ─────────────────
let server;                                     // 가짜 서버 ui_prefs
beforeEach(() => {
  vi.clearAllMocks();
  server = {};
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
  });
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1 }));
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="">';
  axios.get.mockImplementation(async () => ({ data: { status: true, ui_prefs: { ...server } } }));
  axios.patch.mockImplementation(async (url, body) => {
    Object.assign(server, body); return { data: { status: true } };
  });
});
afterEach(() => { if (activeRoot) { act(() => activeRoot.unmount()); activeRoot = null; } });
// ────────────────────────────────────────────────────────────────────────────────

async function mount(providerProps = { systemEnabled: true }) {
  // 미러를 심어 둔 테스트는 서버도 같은 값으로 맞춘다 — ThemeServerSync가 붙어 있으므로
  // 서버에 theme이 없으면 전이표대로 system이 되어 심어 둔 값이 사라진다.
  const mirror = localStorage.getItem(THEME_STORAGE_KEY);
  if (mirror) server = { theme: mirror };
  document.body.innerHTML = '<div id="root"></div>';
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(
      <ThemeProvider {...providerProps}>
        <UiPrefsProvider fetchEnabled={true}><ThemeServerSync /><AppearanceSection /></UiPrefsProvider>
      </ThemeProvider>,
    );
  });
}

const group = () => document.querySelector('[role="radiogroup"]');
const radios = () => [...document.querySelectorAll('[role="radio"]')];
const radioFor = (v) => radios().find((r) => r.dataset.value === v);
const key = async (el, k) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
};
const click = async (el) => { await act(async () => { el.click(); }); };

describe('AppearanceSection — 플래그 게이트', () => {
  it('공개 플래그가 꺼져 있으면 DOM을 만들지 않는다', async () => {
    await mount({ systemEnabled: false });
    expect(group()).toBeNull();
    expect(document.getElementById('root').textContent).toBe('');
  });
  it('킬스위치가 켜져 있으면 공개 플래그와 무관하게 사라진다', async () => {
    await mount({ systemEnabled: true, killSwitch: true });
    expect(group()).toBeNull();
  });
  // "플래그가 켜져 있으면 렌더된다"는 이 파일의 나머지 테스트 전부가 이미 단정한다.
});

describe('AppearanceSection — 접근성 계약', () => {
  it('radiogroup과 radio 3개가 각각 접근성 이름을 갖는다', async () => {
    await mount();
    const labelledby = group().getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(document.getElementById(labelledby).textContent.trim()).toBeTruthy();
    expect(radios()).toHaveLength(3);
    for (const r of radios()) {
      expect(r.getAttribute('aria-label') || r.textContent.trim()).toBeTruthy();
    }
  });
  it('현재 모드만 aria-checked=true다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await mount();
    const checked = radios().filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0].dataset.value).toBe('dark');
  });
  it('roving tabindex — 탭 정지는 정확히 1개다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    await mount();
    expect(radios().filter((r) => r.tabIndex === 0).map((r) => r.dataset.value)).toEqual(['system']);
    expect(radios().filter((r) => r.tabIndex === -1)).toHaveLength(2);
  });
});

describe('AppearanceSection — 선택 동작', () => {
  it('클릭하면 그 모드가 적용되고 PATCH가 나간다', async () => {
    await mount();
    await click(radioFor('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(axios.patch).toHaveBeenCalledWith('/profile/ui-prefs', { theme: 'dark' }, { _skipAuthRetry: true });
  });
  it('ArrowRight/ArrowDown은 다음 항목을 즉시 선택한다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await mount();
    await key(radioFor('light'), 'ArrowRight');
    expect(radioFor('dark').getAttribute('aria-checked')).toBe('true');
    await key(radioFor('dark'), 'ArrowDown');
    expect(radioFor('system').getAttribute('aria-checked')).toBe('true');
  });
  it('ArrowLeft/ArrowUp은 이전 항목을 선택하고 처음에서 끝으로 감싼다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await mount();
    await key(radioFor('light'), 'ArrowLeft');
    expect(radioFor('system').getAttribute('aria-checked')).toBe('true');
    await key(radioFor('system'), 'ArrowUp');
    expect(radioFor('dark').getAttribute('aria-checked')).toBe('true');
  });
  it('Home/End는 처음·끝으로, Space/Enter는 포커스된 항목을 선택한다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await mount();
    await key(radioFor('dark'), 'Home');
    expect(radioFor('light').getAttribute('aria-checked')).toBe('true');
    await key(radioFor('light'), 'End');
    expect(radioFor('system').getAttribute('aria-checked')).toBe('true');
    await key(radioFor('light'), ' ');
    expect(radioFor('light').getAttribute('aria-checked')).toBe('true');
    await key(radioFor('dark'), 'Enter');
    expect(radioFor('dark').getAttribute('aria-checked')).toBe('true');
  });
  it('이동하면 포커스도 따라간다 (roving tabindex의 짝)', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await mount();
    radioFor('light').focus();
    await key(radioFor('light'), 'ArrowRight');
    expect(document.activeElement.dataset.value).toBe('dark');
  });
});

describe('AppearanceSection — pending / error', () => {
  it('저장 중에는 aria-disabled로 표시하고 DOM disabled는 쓰지 않는다 (포커스 유지)', async () => {
    // 포커스된 요소에 disabled가 걸리면 브라우저가 즉시 blur해 activeElement가 body로 간다.
    // roving tabindex가 저장마다 깨지므로 표시는 aria-disabled로, 차단은 핸들러 가드로 한다.
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await mount();
    let release;
    axios.patch.mockReturnValueOnce(new Promise((r) => { release = r; }));
    radioFor('light').focus();
    await key(radioFor('light'), 'ArrowRight');                  // dark 선택 → 저장 중
    expect(radios().every((r) => r.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(radios().some((r) => r.disabled)).toBe(false);
    expect(document.activeElement.dataset.value).toBe('dark');
    await click(radioFor('system'));                             // 저장 중 조작은 무시된다
    expect(axios.patch).toHaveBeenCalledTimes(1);
    expect(radioFor('dark').getAttribute('aria-checked')).toBe('true');
    await act(async () => { release({ data: { status: true } }); });
    expect(radios().some((r) => r.hasAttribute('aria-disabled'))).toBe(false);
    expect(document.activeElement.dataset.value).toBe('dark');
  });
  it('저장 실패는 role=alert로 알리고 선택이 되돌아간다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await mount();
    axios.patch.mockRejectedValueOnce(new Error('boom'));
    await click(radioFor('dark'));
    expect(document.querySelector('[role="alert"]').textContent.trim()).toBeTruthy();
    expect(radioFor('light').getAttribute('aria-checked')).toBe('true');
  });
  it('오류가 없으면 alert도 없다', async () => {
    await mount();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
