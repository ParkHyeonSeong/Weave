import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';

// 초기 GET 완료 신호. mutation은 이 게이트를 통과한 뒤에만 PATCH를 보낸다 —
// GET이 끝나기 전에 보내면 서버 병합 결과와 클라 상태가 갈린다.
function makeGate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

// 계정 식별자. 로그인(components/Auth/Login.js)이 sessionStorage 'profile'에 심는다.
function readAcct() {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}').user_id ?? null; }
  catch { return null; }
}

const UiPrefsContext = createContext(null);

// 키 집합과 값 정체성이 같으면 true — 드레인 GET이 낙관값과 같은 스냅샷을 돌려줬을 때
// 소비자 전체 재렌더를 건너뛰기 위한 얕은 비교.
function sameShallow(a, b) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length
    && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]));
}

// localStorage 1회 이주용 키 (네임스페이스 → 옛 localStorage 키)
const LEGACY = { launchpad_order: 'home_launchpad_order', widget_layout: 'home_widget_layout' };

export function UiPrefsProvider({ children, fetchEnabled = true }) {
  const [prefs, setPrefs] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [loadStatus, setLoadStatus] = useState('loading'); // 'loading'|'success'|'error'|'skipped'
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const revisionsRef = useRef({});            // key → 단조증가 revision (CAS 롤백 판정용)
  const confirmedRef = useRef({});            // key → 마지막 '서버 확인값' (롤백 권위)
  const dirtyRef = useRef(new Set());         // 초기 GET 전에 사용자가 바꾼 키
  const chainRef = useRef(Promise.resolve()); // 단일 mutation sequencer
  const pendingRef = useRef(0);               // 체인에 남은 mutation 수 (0 = 드레인)
  const acctRef = useRef(undefined);          // 현재 계정 (첫 렌더에 1회만 읽는다)
  if (acctRef.current === undefined) acctRef.current = readAcct();
  const genRef = useRef(0);                   // 계정 세대 — 바뀔 때마다 +1
  const gateRef = useRef(null);
  const getSeqRef = useRef(0);                // 드레인 GET 순번 — 자기 탭의 옛 응답 폐기용
  const localWritesRef = useRef({});          // key → { inflight, seq } setNamespace 낙관값 (드레인 GET 보호용)
  const writeClockRef = useRef(0);            // setNamespace 호출 순번 — GET 발신 시점과 선후 비교
  if (!gateRef.current) gateRef.current = makeGate();

  // 계정이 바뀌었으면 세대를 올리고, 이전 계정의 확인값·dirty를 버린다.
  // 버리지 않으면 A의 확인값이 B의 롤백 목적지가 된다.
  const syncAccount = useCallback(() => {
    const cur = readAcct();
    if (cur !== acctRef.current) {
      acctRef.current = cur;
      genRef.current += 1;
      confirmedRef.current = {};
      dirtyRef.current.clear();
    }
    return genRef.current;
  }, []);

  // 체인이 빈 뒤 서버 최종값을 받아온다. PATCH 응답이 {'status': True}뿐이라
  // (backend/routers/profile.py update_ui_prefs) 이것이 최종값을 아는 유일한 경로다.
  // 채택은 PATCH를 유발하지 않으므로(ThemeServerSync 계약) 되쓰기 루프는 없다.
  const refetchServer = useCallback(async () => {
    const myGen = genRef.current;
    const mySeq = ++getSeqRef.current;          // 이 재조회의 순번
    const myClock = writeClockRef.current;      // 이 GET 발신 시점까지의 setNamespace 순번
    // 발신 순간 진행 중인 키. 응답 전에 PATCH가 끝나면 inflight=0·seq<=myClock이라 응답 시점
    // 판정만으로는 빠지지만, 서버는 이 GET이 스냅샷한 뒤에 바뀌었으므로 스냅샷의 그 키는 옛 값이다.
    const inflightAtSend = new Set(
      Object.keys(localWritesRef.current).filter((k) => localWritesRef.current[k].inflight > 0),
    );
    try {
      const res = await axios.get('/profile/ui-prefs');
      if (genRef.current !== myGen) return;      // 계정이 바뀌었다
      if (getSeqRef.current !== mySeq) return;   // 더 새 GET이 이미 나갔다 — 옛 응답은 버린다
      if (pendingRef.current > 0) return;        // 더 새 mutation이 들어왔다 — 덮어쓰지 않는다
      if (!res?.data?.status) return;
      const snapshot = res.data.ui_prefs || {};
      confirmedRef.current = { ...snapshot };
      dirtyRef.current.clear();
      // 시퀀서 밖 setNamespace(19곳)가 (a) 이 GET 발신 당시 진행 중이었거나 (b) 응답 시점에도
      // 진행 중이거나 (c) 이 GET이 나간 뒤에 호출됐으면, 스냅샷의 그 키는 옛 값이다. 통째
      // 교체하면 방금 바꾼 순서가 화면에서 되돌아가고 DB엔 남아 다음 새로고침에 부활한다.
      // 그 키만 낙관값을 지킨다.
      const merged = { ...snapshot };
      for (const [k, w] of Object.entries(localWritesRef.current)) {
        if ((inflightAtSend.has(k) || w.inflight > 0 || w.seq > myClock)
            && Object.prototype.hasOwnProperty.call(prefsRef.current, k)) {
          merged[k] = prefsRef.current[k];
        }
      }
      if (sameShallow(merged, prefsRef.current)) return;   // 같은 값이면 소비자 재렌더를 만들지 않는다
      prefsRef.current = merged;
      setPrefs(merged);
    } catch { /* 재조회 실패는 조용히 — 다음 변경이나 새로고침이 정정한다 */ }
  }, []);

  // 한 네임스페이스 교체(낙관적 업데이트 + 서버 저장).
  // 부수효과는 updater 밖에서 — StrictMode/동시성에서 updater 중복 호출돼도 PATCH 1회.
  const setNamespace = useCallback((key, value) => {
    const next = { ...prefsRef.current, [key]: value };
    prefsRef.current = next;
    setPrefs(next);
    const w = localWritesRef.current[key] || (localWritesRef.current[key] = { inflight: 0, seq: 0 });
    w.inflight += 1;
    w.seq = ++writeClockRef.current;
    const settle = () => { w.inflight -= 1; };
    axios.patch('/profile/ui-prefs', { [key]: value }).then(settle, settle);   // 실패는 여전히 삼킨다
  }, []);

  // 실패를 호출부에 돌려주는 변종. setNamespace는 19개 파일이 쓰는 UI 배치용이라
  // 실패를 삼키는 게 맞지만, 테마처럼 사용자가 결과를 기대하는 설정은 실패를 알아야 한다.
  //
  //  (1) 시퀀서: 한 탭의 PATCH를 promise chain 하나에 직렬화.
  //  (2) 계정 세대 가드 + _skipAuthRetry: (1)이 "호출→발신" 사이에 지연을 만드는 순간, 그
  //      창이 로그아웃보다 길면 A가 고른 값이 B 쿠키로 나간다 — 발신 직전에 계정을 다시 읽어
  //      세대가 다르면 버린다. 발신 '후'의 창은 가드가 못 본다: _axios/index.js의 401 refresh
  //      재시도가 늦은 401을 B 쿠키로 재발신한다. 그 재발신은 요청 config의 플래그가 닫는다.
  //  (3) 키별 revision CAS + 마지막 '서버 확인값' 롤백: 직전 낙관값으로 되돌리면 서버가
  //      가진 적 없는 값이 화면에 남는다(연속 실패 시). 되돌릴 때도 그 키만.
  //  (4) 초기 GET loading gate: GET이 끝나기 전에 보낸 PATCH는 GET 응답 병합과 경합한다.
  //  (5) 드레인 재조회(체인 밖 + getSeq): PATCH 응답에 최종값이 없다. 자기 탭이 서버 값을
  //      채택하고 옛 GET 응답은 버린다. 탭 간 순서 역전은 이것으로 닫히지 않는다(수용된 정책).
  //
  // 응답 판정: 이 레포는 컨트롤러 검증 실패를 200 + {status:false}로 위장해 내리는 선례가
  // 있어 HTTP 상태만으로는 침묵 실패가 된다(theme의 실제 실패 경로는 Pydantic 422다).
  const setNamespaceChecked = useCallback((key, value) => {
    const myGen = syncAccount();                 // enqueue 시점 계정 세대
    const rev = (revisionsRef.current[key] = (revisionsRef.current[key] || 0) + 1);
    dirtyRef.current.add(key);

    const next = { ...prefsRef.current, [key]: value };
    prefsRef.current = next;
    setPrefs(next);

    const run = async () => {
      await gateRef.current.promise;
      syncAccount();                             // 발신 직전에 계정을 다시 읽는다
      if (genRef.current !== myGen) return;      // 계정이 바뀌었다 — 조용히 버린다(롤백 안 함)
      try {
        const res = await axios.patch('/profile/ui-prefs', { [key]: value }, { _skipAuthRetry: true });
        if (res?.data?.status === false) {
          // code/category를 실어 보낸다 — 소비자가 errorText 규약으로 문구를 풀 수 있게
          throw Object.assign(new Error(res.data.message || 'ui-prefs 저장이 거부됐습니다'), getError(res.data));
        }
        confirmedRef.current[key] = value;       // 여기서만 '확인값'이 갱신된다
      } catch (e) {
        if (revisionsRef.current[key] === rev) { // CAS: 내가 마지막 변경일 때만 되돌린다
          const cur = { ...prefsRef.current };
          if (Object.prototype.hasOwnProperty.call(confirmedRef.current, key)) {
            cur[key] = confirmedRef.current[key];
          } else {
            delete cur[key];
          }
          prefsRef.current = cur;
          setPrefs(cur);
        }
        throw e;
      }
    };

    pendingRef.current += 1;
    const result = chainRef.current.then(run, run);   // 앞 요청의 성패와 무관하게 이어 붙인다
    chainRef.current = result.catch(() => {});        // 체인은 PATCH만 직렬화한다(드레인 GET은 체인 밖)
    const drained = chainRef.current.then(() => {
      pendingRef.current -= 1;
      if (pendingRef.current === 0) return refetchServer();   // 체인이 비었다
    });
    // 계약: 드레인까지 끝난 뒤 resolve. 실패는 드레인 뒤에 그대로 던진다(result는 이미 settled).
    return drained.then(() => result);
  }, [syncAccount, refetchServer]);

  // 최초 1회 로드 + localStorage 이주. 공개 경로는 fetch 스킵(미인증 401/interceptor 방지) —
  // loadStatus로 성공/실패/스킵을 구분해야 테마 서버 권위가 "성공 조회"에만 적용된다(스펙 §3).
  useEffect(() => {
    // fetchEnabled 전환 시 게이트를 새로 무장한다. 새 게이트를 먼저 설치한 뒤 옛 게이트를
    // 열어야 옛 게이트에 걸린 대기자가 영구 대기에 빠지지 않는다.
    const prevGate = gateRef.current;
    const gate = makeGate();
    gateRef.current = gate;
    getSeqRef.current += 1;      // 인플라이트 드레인 GET 응답을 무효화한다(이 effect의 GET이 권위)
    prevGate.open();
    if (!fetchEnabled) { setLoadStatus('skipped'); setLoaded(true); gate.open(); return; }
    let alive = true;
    axios.get('/profile/ui-prefs')
      .then((res) => {
        if (!alive) return;
        if (!res.data.status) {
          // 200이지만 실패 엔벨로프 — 서버 스냅샷 없음으로 취급(테마 서버 권위 미적용)
          setLoadStatus('error');
          setLoaded(true);
          return;
        }
        const server = res.data.ui_prefs || {};
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
        // 초기 GET 전에 사용자가 바꾼 키는 낙관값을 유지한다. 통째 교체하면 방금 고른 값이
        // 화면에서 사라지는데 PATCH는 뒤이어 나가므로 DB엔 남고, 다음 새로고침에 부활한다
        // (= 사용자가 보는 플리커). 손대지 않은 서버 값은 그대로 채택한다.
        const optimistic = {};
        for (const k of dirtyRef.current) {
          if (Object.prototype.hasOwnProperty.call(prefsRef.current, k)) {
            optimistic[k] = prefsRef.current[k];
          }
        }
        const merged = { ...migrated, ...optimistic };
        // 롤백 권위 시드. optimistic은 아직 아무도 확인하지 않았으니 넣지 않는다 —
        // 확인값은 PATCH 성공 때만 갱신된다.
        confirmedRef.current = { ...migrated };
        prefsRef.current = merged;
        setPrefs(merged);
        setLoadStatus('success');
        setLoaded(true);
      })
      .catch(() => { if (alive) { setLoadStatus('error'); setLoaded(true); } })
      .finally(() => gate.open());   // 성공·실패·위장 엔벨로프 어느 경로든 게이트는 열린다(영구 대기 금지)
    return () => { alive = false; gate.open(); };
  }, [fetchEnabled]);

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

  // 저장된 뷰 핀 per-user 저장 (scopeKey = String(branchId) 또는 'global')
  const setPinnedViews = useCallback((scopeKey, viewIds) => {
    const cur = prefsRef.current.saved_view_pins || {};
    setNamespace('saved_view_pins', { ...cur, [scopeKey]: viewIds });
  }, [setNamespace]);

  // 콜백은 전부 안정적이므로 prefs/loaded/loadStatus가 바뀔 때만 소비자(20곳)가 재렌더된다.
  const value = useMemo(
    () => ({ prefs, loaded, loadStatus, setNamespace, setNamespaceChecked, hide, unhide, isHidden, setHomeCtl, setPinnedViews }),
    [prefs, loaded, loadStatus, setNamespace, setNamespaceChecked, hide, unhide, isHidden, setHomeCtl, setPinnedViews],
  );
  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}

// Provider 밖(로그인 페이지 등)에서도 안전하게 동작하는 기본값
const EMPTY = {
  prefs: {}, loaded: false, loadStatus: 'skipped',
  setNamespace: () => {}, hide: () => {}, unhide: () => {}, isHidden: () => false,
  setNamespaceChecked: async () => {},   // ⚠️ resolve 하는 async 함수여야 한다 — () => {}면 .catch가 터진다
  setHomeCtl: () => {}, setPinnedViews: () => {},
};
export function useUiPrefs() {
  return useContext(UiPrefsContext) || EMPTY;
}
