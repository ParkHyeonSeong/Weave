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

describe('공개 경로 계정 전환 격리 (쓰기 경로 도입 후)', () => {
  it('서버 값이 오염돼도 system으로 되돌리고 미러를 덮어쓴다', async () => {
    // 공유 브라우저: 이전 사용자가 dark를 남긴 상태에서 다른 계정으로 로그인
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    axios.get.mockResolvedValueOnce({ data: { status: true, ui_prefs: { theme: 'neon' } } });
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('system:light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });
  it('새 계정이 light를 저장해 뒀으면 그 값을 채택한다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    axios.get.mockResolvedValueOnce({ data: { status: true, ui_prefs: { theme: 'light' } } });
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('light:light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
  it('200 + {status:false} 실패 엔벨로프는 서버 권위를 주지 않는다 (미러 유지)', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    axios.get.mockResolvedValueOnce({ data: { status: false } });
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('dark:dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
  it('서버 채택이 미러를 덮어써도 PATCH를 유발하지 않는다 (채택 ≠ 사용자 선택)', async () => {
    // ThemeServerSync는 setMode만 부른다. 여기서 PATCH가 나가면 로그인마다 쓰기가 발생하고,
    // Task 2의 드레인 GET과 맞물려 두 탭이 서로의 값을 되쓰는 루프가 된다. 이 단정이 그 루프를 막는다.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    axios.get.mockResolvedValueOnce({ data: { status: true, ui_prefs: { theme: 'light' } } });
    await mount(true);
    expect(axios.patch).not.toHaveBeenCalled();
  });
});
