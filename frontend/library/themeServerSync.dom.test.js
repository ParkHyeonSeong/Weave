// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({
  axios: { get: vi.fn(), patch: vi.fn(() => Promise.resolve({ data: { status: true } })) },
}));
import { axios } from '@/library/_axios';
import { ThemeProvider, ThemeServerSync, useTheme, THEME_STORAGE_KEY } from './theme';
import { UiPrefsProvider } from './UiPrefsContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { mode, resolved } = useTheme();
  return <span id="probe">{`${mode}:${resolved}`}</span>;
}

let activeRoot;

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
  });
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="">';
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => { if (activeRoot) { act(() => activeRoot.unmount()); activeRoot = null; } });

// systemEnabled=true(GA 경로)로 마운트 — S10 플립 후 계약을 지금 고정
async function mount(fetchEnabled) {
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(
      <ThemeProvider systemEnabled={true}>
        <UiPrefsProvider fetchEnabled={fetchEnabled}>
          <ThemeServerSync />
          <Probe />
        </UiPrefsProvider>
      </ThemeProvider>,
    );
  });
}

describe('ThemeProvider×UiPrefsProvider×ThemeServerSync 통합 (GA)', () => {
  it('success: 서버 dark 채택 → mode·미러·DOM 전부 변경', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    axios.get.mockResolvedValueOnce({ data: { status: true, ui_prefs: { theme: 'dark' } } });
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('dark:dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
  it('error: 서버 권위 미적용 — 미러 유지', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    axios.get.mockRejectedValueOnce(new Error('network'));
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('light:light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
  it('skipped(미인증): 미러 유지 + GET 미발생', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await mount(false);
    expect(document.getElementById('probe').textContent).toBe('dark:dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(axios.get).not.toHaveBeenCalled();
  });
  it('success & 서버 theme 부재: system 기본값 + 미러 덮어쓰기 (계정 전환 차단)', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    axios.get.mockResolvedValueOnce({ data: { status: true, ui_prefs: {} } });
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('system:light'); // osDark=false
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
});
