import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { axios } from '@/library/_axios';

const UiPrefsContext = createContext(null);

// localStorage 1회 이주용 키 (네임스페이스 → 옛 localStorage 키)
const LEGACY = { launchpad_order: 'home_launchpad_order', widget_layout: 'home_widget_layout' };

export function UiPrefsProvider({ children }) {
  const [prefs, setPrefs] = useState({});
  const [loaded, setLoaded] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // 한 네임스페이스 교체(낙관적 업데이트 + 서버 저장).
  // 부수효과는 updater 밖에서 — StrictMode/동시성에서 updater 중복 호출돼도 PATCH 1회.
  const setNamespace = useCallback((key, value) => {
    const next = { ...prefsRef.current, [key]: value };
    prefsRef.current = next;
    setPrefs(next);
    axios.patch('/profile/ui-prefs', { [key]: value }).catch(() => {});
  }, []);

  // 최초 1회 로드 + localStorage 이주
  useEffect(() => {
    let alive = true;
    axios.get('/profile/ui-prefs')
      .then((res) => {
        if (!alive) return;
        const server = (res.data.status && res.data.ui_prefs) ? res.data.ui_prefs : {};
        const migrated = { ...server };
        // 서버 값 없고 localStorage에 기존 배치가 있으면 1회 이주
        for (const [ns, lsKey] of Object.entries(LEGACY)) {
          if (migrated[ns] == null) {
            try {
              const raw = localStorage.getItem(lsKey);
              if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                  migrated[ns] = parsed;
                  axios.patch('/profile/ui-prefs', { [ns]: parsed }).catch(() => {});
                }
              }
            } catch {}
          }
        }
        setPrefs(migrated);
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  // 숨김 편의 헬퍼 (app ∈ 'branches'|'canvases'|'tracks'|'scrums')
  const hide = useCallback((app, id) => {
    const cur = prefsRef.current.hidden || {};
    const list = cur[app] || [];
    if (list.includes(id)) return;
    setNamespace('hidden', { ...cur, [app]: [...list, id] });
  }, [setNamespace]);

  const unhide = useCallback((app, id) => {
    const cur = prefsRef.current.hidden || {};
    const list = cur[app] || [];
    setNamespace('hidden', { ...cur, [app]: list.filter((x) => x !== id) });
  }, [setNamespace]);

  const isHidden = useCallback((app, id) => (prefs.hidden?.[app] || []).includes(id), [prefs]);

  // 앱 홈 정렬·뷰 per-user 저장 (appKey ∈ 'branch'|'canvas'|'track'|'scrum')
  const setHomeCtl = useCallback((appKey, patch) => {
    const cur = prefsRef.current.home_controls || {};
    setNamespace('home_controls', { ...cur, [appKey]: { ...(cur[appKey] || {}), ...patch } });
  }, [setNamespace]);

  return (
    <UiPrefsContext.Provider value={{ prefs, loaded, setNamespace, hide, unhide, isHidden, setHomeCtl }}>
      {children}
    </UiPrefsContext.Provider>
  );
}

// Provider 밖(로그인 페이지 등)에서도 안전하게 동작하는 기본값
const EMPTY = {
  prefs: {}, loaded: false,
  setNamespace: () => {}, hide: () => {}, unhide: () => {}, isHidden: () => false,
  setHomeCtl: () => {},
};
export function useUiPrefs() {
  return useContext(UiPrefsContext) || EMPTY;
}
