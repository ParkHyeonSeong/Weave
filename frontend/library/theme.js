import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useUiPrefs } from '@/library/UiPrefsContext';

// 다크모드 테마 결정 로직 단일 소스 — 부트스트랩(_document 인라인)·런타임(ThemeProvider)이 공유.
// SYSTEM_ENABLED가 숨김 롤아웃 스위치: false인 동안 'system'은 해석하지 않고 light로 강제해
// OS 다크 사용자에게 미완성 다크가 누출되지 않는다. S10 공개 슬라이스에서 true로 플립 —
// theme.test.js의 bootstrap parity 테스트가 플립 후 첫 페인트/런타임 불일치를 막는다.
export const THEME_STORAGE_KEY = 'theme';
export const VALID_MODES = ['light', 'dark', 'system'];
export const SYSTEM_ENABLED = false;

const META_COLORS = { light: '#FFFFFF', dark: '#0E0F11' }; // _themes.scss --color-bg와 동기

// 단일 정규화 계약: 저장값 부재/오염 → 'system' (해석은 resolveTheme가 플래그에 따라)
export function normalizeMode(raw) {
  return VALID_MODES.includes(raw) ? raw : 'system';
}

export function resolveTheme(rawMode, osDark, { systemEnabled = SYSTEM_ENABLED } = {}) {
  const mode = normalizeMode(rawMode);
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemEnabled && osDark ? 'dark' : 'light';
}

// 스펙 §3 전이표. 서버 권위는 "인증된 GET 성공(loadStatus==='success')"에만 —
// GET 실패·미인증 스킵·로그아웃은 전부 미러 유지다.
export function mergeServerTheme({ loadStatus, serverTheme, localMode }, { systemEnabled = SYSTEM_ENABLED } = {}) {
  const local = normalizeMode(localMode);
  if (loadStatus !== 'success') return { mode: local, mirrorWrite: null };
  if (!systemEnabled) return { mode: local, mirrorWrite: null }; // 숨김 기간: 미러 단독 권위
  if (VALID_MODES.includes(serverTheme)) {
    if (serverTheme === local) return { mode: local, mirrorWrite: null };
    return { mode: serverTheme, mirrorWrite: serverTheme };
  }
  // 서버 부재/오염 → 기본값 system + 미러 덮어쓰기 (공유 브라우저 이전 계정 테마 차단)
  return { mode: 'system', mirrorWrite: local === 'system' ? null : 'system' };
}

export function getStoredMode() {
  try { return localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
}

export function storeMode(mode) {
  try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch {}
}

export function applyResolvedTheme(resolved, doc = document) {
  doc.documentElement.setAttribute('data-theme', resolved);
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = META_COLORS[resolved]; // attr 불변이어도 항상 동기 (멱등)
}

// public/theme-boot.js의 생성원(자족 IIFE). ⚠️ 인라인 <script nonce>로 넣으면 안 된다 —
// custom _document.getInitialProps는 정적 최적화(ASO)를 끄지 않아(page 컴포넌트 기준 판정)
// prod 정적 HTML의 nonce가 빈 값이 되고, middleware는 요청마다 새 nonce를 CSP에 넣으므로
// 인라인은 차단된다. 외부 파일은 script-src 'self'로 통과. theme.test.js parity 테스트가
// resolveTheme과의 동치를, Task 9 파일 parity가 파일과 이 함수의 동기화를 강제한다.
export function buildBootstrapScript({ systemEnabled = SYSTEM_ENABLED } = {}) {
  // ⚠️ storage 읽기만 try — 정규화·해석은 항상 실행. getItem 예외를 해석까지 묶으면
  // 런타임(getStoredMode→null→'system')과 결과가 갈려 GA에서 light→dark FOUC가 난다.
  const readStored = `var t=null;try{t=localStorage.getItem('${THEME_STORAGE_KEY}');}catch(e){}`;
  const normalize = `var v=(t==='light'||t==='dark'||t==='system')?t:'system';`;
  const resolveGa = `var r=v==='dark'?'dark':v==='light'?'light':(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');`;
  const resolvePreview = `var r=v==='dark'?'dark':'light';`;
  return `(function(){${readStored}${normalize}${systemEnabled ? resolveGa : resolvePreview}document.documentElement.setAttribute('data-theme',r);try{var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=r==='dark'?'${META_COLORS.dark}':'${META_COLORS.light}';}catch(e){}})();`;
}

// 토글 순간 transition:all 205곳의 스태거드 색 전환 억제 (globals.scss .theme-switching 규칙과 짝)
export function withTransitionsSuppressed(doc, fn) {
  doc.documentElement.classList.add('theme-switching');
  fn();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    doc.documentElement.classList.remove('theme-switching');
  }));
}

// ---------------------------------------------------------------------------
// ThemeProvider — _app의 appReady 게이트 "밖"에 마운트해 라우팅/게이트 리셋에도 상주.
// preference를 React 상태로 들어 storage 채택 시 소비자(S10 Profile 라디오)까지 재렌더된다.
// ---------------------------------------------------------------------------
const ThemeContext = createContext(null);

// systemEnabled prop: 기본은 롤아웃 플래그 — 테스트가 GA 경로(OS 추종·서버 권위)를
// 플래그 플립 전에 검증할 수 있도록 주입 가능하게 열어둔다.
export function ThemeProvider({ children, systemEnabled = SYSTEM_ENABLED }) {
  const [mode, setModeState] = useState('system');
  const [osDark, setOsDark] = useState(false);
  const [ready, setReady] = useState(false); // 초기 미러 채택 전 DOM 동기 금지(부트스트랩 결과 보존)

  useEffect(() => {
    setModeState(normalizeMode(getStoredMode()));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setOsDark(mq.matches);
    setReady(true);
    const onChange = (e) => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 탭 간 동기화 — React 상태로 반영 (DOM만 만지면 Profile 라디오가 stale)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === THEME_STORAGE_KEY) setModeState(normalizeMode(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const resolved = resolveTheme(mode, osDark, { systemEnabled });

  // DOM 동기 — attr 변화 시에만 트랜지션 억제, meta는 항상 동기(멱등).
  useEffect(() => {
    if (!ready) return;
    const current = document.documentElement.getAttribute('data-theme');
    if (current !== resolved) {
      withTransitionsSuppressed(document, () => applyResolvedTheme(resolved));
    } else {
      applyResolvedTheme(resolved); // 부트스트랩이 attr만 맞춘 경우에도 meta 동기 (P1: dark 새로고침 meta 잔존)
    }
  }, [ready, resolved]);

  // 사용자 선택(S10 UI)·서버 채택 공용 진입점 — 미러 기록 포함
  const setMode = useCallback((next) => {
    const norm = normalizeMode(next);
    storeMode(norm);
    setModeState(norm);
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, setMode, systemEnabled }),
    [mode, resolved, setMode, systemEnabled],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext)
    || { mode: 'system', resolved: 'light', setMode: () => {}, systemEnabled: SYSTEM_ENABLED };
}

// UiPrefsProvider 안에서 서버 스냅샷을 전이표대로 채택하는 브리지 (UI 없음)
export function ThemeServerSync() {
  const { prefs, loadStatus } = useUiPrefs();
  const { mode, setMode, systemEnabled } = useTheme();
  useEffect(() => {
    const { mode: next } = mergeServerTheme(
      { loadStatus, serverTheme: prefs.theme, localMode: mode },
      { systemEnabled },
    );
    if (next !== mode) setMode(next);
    // mode는 deps에서 의도적 제외 — 서버 스냅샷 변화에만 반응 (로컬 변경에 재머지하면 루프)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStatus, prefs.theme]);
  return null;
}
