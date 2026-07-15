// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({
  axios: { get: vi.fn(), patch: vi.fn(() => Promise.resolve({ data: { status: true } })) },
}));
import { axios } from '@/library/_axios';
import { UiPrefsProvider, useUiPrefs } from './UiPrefsContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const { loadStatus, prefs } = useUiPrefs();
  return <span id="probe">{`${loadStatus}:${prefs.theme || '-'}`}</span>;
}

let activeRoot; // 테스트 간 Provider 누수 방지 — theme.dom.test.js와 동일 계약

async function mount(fetchEnabled) {
  document.body.innerHTML = '<div id="root"></div>';
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(<UiPrefsProvider fetchEnabled={fetchEnabled}><Probe /></UiPrefsProvider>);
  });
  return activeRoot;
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { if (activeRoot) { act(() => activeRoot.unmount()); activeRoot = null; } });

describe('UiPrefsProvider loadStatus', () => {
  it('fetchEnabled=false → skipped, GET 미발생', async () => {
    await mount(false);
    expect(document.getElementById('probe').textContent).toBe('skipped:-');
    expect(axios.get).not.toHaveBeenCalled();
  });
  it('GET 성공 → success + 서버 theme 노출', async () => {
    axios.get.mockResolvedValueOnce({ data: { status: true, ui_prefs: { theme: 'dark' } } });
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('success:dark');
  });
  it('GET 실패 → error (서버 권위 미적용 신호)', async () => {
    axios.get.mockRejectedValueOnce(new Error('network'));
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('error:-');
  });
  it("200이지만 {status:false} 실패 엔벨로프 → error (서버 권위 미적용)", async () => {
    axios.get.mockResolvedValueOnce({ data: { status: false } });
    await mount(true);
    expect(document.getElementById('probe').textContent).toBe('error:-');
  });
});
