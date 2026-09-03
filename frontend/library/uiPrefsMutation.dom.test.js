// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';
import { UiPrefsProvider, useUiPrefs } from './UiPrefsContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let api;          // Probe가 노출하는 context 값 — 테스트가 직접 mutation을 호출한다
let activeRoot;
let server;       // 가짜 서버의 ui_prefs. 드레인 GET이 이 값을 돌려주므로
                  // "클라 최종값 == 서버 최종값"을 테스트가 직접 볼 수 있다.
let gets;         // GET 호출 횟수 (드레인 재조회가 정확히 1회인지 센다)

// 발신 계약: PATCH는 3번째 인자로 _skipAuthRetry를 실어야 한다. 계정이 바뀐 뒤 도착한
// 늦은 401이 _axios/index.js의 refresh 재시도로 다음 계정 쿠키로 재발신되는 것을 막는다.
const PATCH_CFG = { _skipAuthRetry: true };

function Probe() {
  api = useUiPrefs();
  return <span id="probe">{JSON.stringify(api.prefs)}</span>;
}
const seen = () => JSON.parse(document.getElementById('probe').textContent);

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(<UiPrefsProvider fetchEnabled={true}><Probe /></UiPrefsProvider>);
  });
}

// 해소 시점을 테스트가 쥐는 PATCH 스텁. ok()는 가짜 서버에도 반영한다.
function deferredPatch() {
  const calls = [];
  axios.patch.mockImplementation((url, body) => new Promise((resolve, reject) => {
    calls.push({
      url, body,
      ok: () => { Object.assign(server, body); resolve({ data: { status: true } }); },
      fail: (e) => reject(e || new Error('boom')),
    });
  }));
  return calls;
}

const login = (id) => sessionStorage.setItem('profile', JSON.stringify({ user_id: id }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear();
  api = undefined; server = {}; gets = 0;
  login(1);
  axios.get.mockImplementation(async () => {
    gets += 1; return { data: { status: true, ui_prefs: { ...server } } };
  });
  axios.patch.mockImplementation(async (url, body) => {
    Object.assign(server, body); return { data: { status: true } };
  });
});
afterEach(() => { if (activeRoot) { act(() => activeRoot.unmount()); activeRoot = null; } });

describe('setNamespaceChecked — 실패를 돌려준다', () => {
  it('성공하면 값이 남고 PATCH는 그 키만 보낸다', async () => {
    server = { theme: 'light' };
    await mount();
    await act(async () => { await api.setNamespaceChecked('theme', 'dark'); });
    expect(axios.patch).toHaveBeenCalledWith('/profile/ui-prefs', { theme: 'dark' }, PATCH_CFG);
    expect(seen().theme).toBe('dark');
    expect(server.theme).toBe('dark');
  });
  it('네트워크 실패면 그 키만 마지막 서버 확인값으로 되돌리고 reject 한다', async () => {
    server = { theme: 'light' };
    await mount();
    axios.patch.mockRejectedValue(new Error('network down'));
    let caught;
    await act(async () => { await api.setNamespaceChecked('theme', 'dark').catch((e) => { caught = e; }); });
    expect(seen().theme).toBe('light');
    expect(caught).toBeInstanceOf(Error);
  });
  it('200이지만 status:false인 위장 엔벨로프도 실패로 판정한다', async () => {
    // 실제 검증 실패 경로는 Pydantic 422지만, 이 레포에는 컨트롤러가 200 + {status:false}로
    // 위장해 내리는 선례가 있다. HTTP 상태만 보면 침묵 실패가 되므로 둘 다 막는다.
    server = { theme: 'light' };
    await mount();
    axios.patch.mockResolvedValue({ data: { status: false, message: 'invalid' } });
    let caught;
    await act(async () => { await api.setNamespaceChecked('theme', 'dark').catch((e) => { caught = e; }); });
    expect(seen().theme).toBe('light');
    expect(caught).toBeInstanceOf(Error);
  });
  it('없던 키가 실패하면 키 자체가 사라진다(undefined 잔존 금지)', async () => {
    await mount();
    axios.patch.mockRejectedValue(new Error('nope'));
    await act(async () => { await api.setNamespaceChecked('theme', 'dark').catch(() => {}); });
    expect('theme' in seen()).toBe(false);
  });
  it('연속 2회 변경 + 둘 다 실패 → 유령값이 아니라 최초 서버 값으로 돌아간다', async () => {
    // light → dark → system, PATCH 2회 모두 실패. 롤백 권위를 "직전 낙관값"으로 두면
    // rev2의 before가 rev1의 낙관값 'dark'라 서버에 없던 값이 화면에 남는다(§2.2b).
    // 네트워크가 죽은 상황이므로 드레인 재조회도 실패시켜 롤백 권위만 남긴다.
    server = { theme: 'light' };
    await mount();
    axios.patch.mockRejectedValue(new Error('blocked'));
    axios.get.mockRejectedValue(new Error('blocked'));
    await act(async () => {
      const a = api.setNamespaceChecked('theme', 'dark').catch(() => {});
      const b = api.setNamespaceChecked('theme', 'system').catch(() => {});
      await a; await b;
    });
    expect(seen().theme).toBe('light');     // ← 'dark'면 롤백 권위가 틀린 것이다
    expect(server.theme).toBe('light');
  });
});

describe('단일 mutation sequencer — 한 탭 안에서 발신 순서 = 호출 순서', () => {
  it('같은 키 두 소비자(Header→Profile) 연속 호출: 두 번째는 첫 번째가 끝난 뒤에 나간다', async () => {
    server = { theme: 'system' };
    await mount();
    const calls = deferredPatch();
    let p1, p2;
    await act(async () => {
      p1 = api.setNamespaceChecked('theme', 'dark');    // Header 토글
      p2 = api.setNamespaceChecked('theme', 'light');   // Profile 라디오
    });
    expect(calls).toHaveLength(1);                      // 두 번째는 아직 발신 전
    expect(calls[0].body).toEqual({ theme: 'dark' });
    await act(async () => { calls[0].ok(); await p1; });
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ theme: 'light' });
    await act(async () => { calls[1].ok(); await p2; });
    expect(seen().theme).toBe('light');
    expect(server.theme).toBe('light');                 // 클라와 서버가 같은 값에서 끝난다
  });
});

describe('키별 revision CAS — 오래된 실패가 최신 성공을 뒤집지 않는다', () => {
  it('rev1 실패 + rev2 성공 → 최종값은 rev2', async () => {
    server = { theme: 'light' };
    await mount();
    const calls = deferredPatch();
    let p1, p2;
    await act(async () => {
      p1 = api.setNamespaceChecked('theme', 'dark').catch(() => 'failed');
      p2 = api.setNamespaceChecked('theme', 'system');
    });
    await act(async () => { calls[0].fail(); await p1; });
    expect(seen().theme).toBe('system');      // rev가 이미 2 → 1의 실패는 롤백하지 않는다
    await act(async () => { calls[1].ok(); await p2; });
    expect(seen().theme).toBe('system');
    expect(server.theme).toBe('system');
  });
  it('다른 키의 실패가 이웃 키를 삼키지 않는다 (전체 prefs 롤백 폐기)', async () => {
    server = { theme: 'light' };
    await mount();
    const calls = deferredPatch();
    let pA, pB;
    await act(async () => {
      pA = api.setNamespaceChecked('theme', 'dark').catch(() => 'failed');
      pB = api.setNamespaceChecked('hidden', { branches: [1] });
    });
    await act(async () => { calls[0].fail(); await pA; });
    await act(async () => { calls[1].ok(); await pB; });
    expect(seen().theme).toBe('light');                    // 실패한 키만 되돌아감
    expect(seen().hidden).toEqual({ branches: [1] });      // 이웃 키는 생존
  });
});

describe('초기 GET loading gate', () => {
  it('GET 응답 전 mutation은 PATCH를 미루고, GET 응답이 낙관값을 지우지 않는다', async () => {
    server = { theme: 'light', comment_sort: 'oldest' };
    let openGet;
    axios.get.mockImplementationOnce(() => new Promise((r) => {
      openGet = () => { gets += 1; r({ data: { status: true, ui_prefs: { ...server } } }); };
    }));
    await mount();                                   // GET 미해결 상태
    let p;
    await act(async () => { p = api.setNamespaceChecked('theme', 'dark'); });
    expect(seen().theme).toBe('dark');               // 낙관값은 즉시 보인다
    expect(axios.patch).not.toHaveBeenCalled();      // 게이트가 PATCH를 막고 있다
    await act(async () => { openGet(); await p; });
    expect(axios.patch).toHaveBeenCalledWith('/profile/ui-prefs', { theme: 'dark' }, PATCH_CFG);
    expect(seen().theme).toBe('dark');               // GET 병합이 낙관값을 안 지운다
    expect(seen().comment_sort).toBe('oldest');      // 손대지 않은 서버 값은 그대로 채택
  });
  it('GET 실패로도 게이트는 열린다(영구 대기 금지)', async () => {
    axios.get.mockImplementationOnce(() => Promise.reject(new Error('network')));
    await mount();
    await act(async () => { await api.setNamespaceChecked('theme', 'dark'); });
    expect(axios.patch).toHaveBeenCalledWith('/profile/ui-prefs', { theme: 'dark' }, PATCH_CFG);
  });
});

describe('계정 세대 가드 — 지연된 PATCH가 다음 계정 쿠키로 나가지 않는다', () => {
  it('게이트 대기 중 계정이 바뀌면 PATCH를 아예 보내지 않는다', async () => {
    server = { theme: 'light' };
    let openGet;
    axios.get.mockImplementationOnce(() => new Promise((r) => {
      openGet = () => { gets += 1; r({ data: { status: true, ui_prefs: { ...server } } }); };
    }));
    await mount();
    let p;
    await act(async () => { p = api.setNamespaceChecked('theme', 'dark'); });   // A가 고름
    login(2);                                        // 로그아웃 → B 로그인 (같은 탭)
    await act(async () => { openGet(); await p; });
    expect(axios.patch).not.toHaveBeenCalled();      // A의 선택이 B 쿠키로 나가지 않는다
    expect(server.theme).toBe('light');              // B의 ui_prefs에 A 값이 없다
  });
  // 과잉 차단(계정이 그대로인데도 버림)은 이 파일의 다른 모든 테스트가 이미 잡는다 —
  // 세대가 안 맞으면 PATCH가 하나도 안 나가 전부 RED가 된다.
});

// 요청 시점 서버 값을 스냅샷하고 해소는 테스트가 쥐는 GET 스텁.
function deferredGet() {
  const calls = [];
  axios.get.mockImplementation(() => new Promise((resolve) => {
    gets += 1;
    const snapshot = { ...server };
    calls.push({ ok: () => resolve({ data: { status: true, ui_prefs: snapshot } }) });
  }));
  return calls;
}

describe('드레인 GET — 서버 값을 채택하되 자기 탭의 옛 응답은 버린다', () => {
  it('마지막 mutation이 끝나면 1회 재조회하고 서버 최종값을 채택한다', async () => {
    server = { theme: 'light' };
    await mount();
    const afterMount = gets;                         // 초기 GET까지의 횟수
    axios.patch.mockImplementation(async () => { server.theme = 'system'; return { data: { status: true } }; });
    await act(async () => { await api.setNamespaceChecked('theme', 'dark'); });
    expect(gets).toBe(afterMount + 1);               // 드레인 시 정확히 1회
    expect(seen().theme).toBe('system');             // 낙관값이 아니라 서버 최종값
  });
  it('반환 Promise는 드레인 GET이 끝난 뒤 resolve 한다', async () => {
    server = { theme: 'light' };
    await mount();
    const afterMount = gets;
    axios.patch.mockImplementation(async () => { server.theme = 'system'; return { data: { status: true } }; });
    await act(async () => {
      await api.setNamespaceChecked('theme', 'dark');
      expect(gets).toBe(afterMount + 1);             // await가 풀린 시점에 이미 재조회가 끝났다
    });
    expect(seen().theme).toBe('system');
  });
  it('늦게 온 옛 드레인 GET 응답은 버린다(자기 탭 stale 차단)', async () => {
    server = { theme: 'light' };
    await mount();
    const g = deferredGet();
    let p1; await act(async () => { p1 = api.setNamespaceChecked('theme', 'dark'); });    // GET#0 보류
    server.theme = 'system';                                                              // 다른 탭이 덮었다
    let p2; await act(async () => { p2 = api.setNamespaceChecked('theme', 'system'); });   // GET#1
    await act(async () => { g[1].ok(); await p2; });
    expect(seen().theme).toBe('system');
    await act(async () => { g[0].ok(); await p1; });
    expect(seen().theme).toBe('system');             // 가드가 없으면 'dark'로 되돌아간다
  });
  it('드레인 GET이 늦어도 다음 mutation의 PATCH를 막지 않는다', async () => {
    await mount();
    const g = deferredGet();
    let p1; await act(async () => { p1 = api.setNamespaceChecked('theme', 'dark'); });
    let p2; await act(async () => { p2 = api.setNamespaceChecked('theme', 'system'); });
    expect(axios.patch).toHaveBeenCalledTimes(2);    // 드레인이 체인 밖이라 막히지 않는다
    await act(async () => { g[0].ok(); g[1].ok(); await Promise.all([p1, p2]); });
  });
  it('연속 3회 변경에서도 재조회는 체인이 빈 뒤 1회뿐이다', async () => {
    await mount();
    const afterMount = gets;
    const calls = deferredPatch();
    let ps;
    await act(async () => {
      ps = [
        api.setNamespaceChecked('theme', 'dark'),
        api.setNamespaceChecked('theme', 'light'),
        api.setNamespaceChecked('theme', 'system'),
      ];
    });
    await act(async () => { calls[0].ok(); await ps[0]; });
    expect(gets).toBe(afterMount);                   // 체인이 아직 비지 않았다 — 재조회 없음
    await act(async () => { calls[1].ok(); await ps[1]; });
    await act(async () => { calls[2].ok(); await ps[2]; });
    expect(gets).toBe(afterMount + 1);
    expect(seen().theme).toBe('system');
    expect(server.theme).toBe('system');
  });
  it('탭 간 순서 역전 — P13 = C로 수용된 동작을 고정한다(§14.7)', async () => {
    // Provider 2개 = 탭 2개, 가짜 서버는 하나. chainRef/getSeqRef는 Provider마다 독립이라
    // 탭A의 옛 드레인 GET은 탭A 기준으로는 '가장 새 GET'이고, 탭B의 최신 PATCH 뒤에 도착해도
    // 버려지지 않는다. 이 테스트는 P13 = C(명시적 수용)라는 승인된 정책을 고정한다 —
    // 동시 쓰기는 last-arrival 승리, 새로고침 전 탭 불일치를 수용한다(§14.7).
    // ⚠️ 지우지 마라. 후속-P13(서버 revision/CAS)이 코드에 들어오면 마지막 줄이 RED가 되는데,
    // 그 RED가 "정책이 바뀌어 코드에 도달했다"는 신호다. 그때 이 단정을 바꾼다.
    // 반대로 코드는 그대로인데 단정만 고쳐 쓰면 즉시 RED가 되어 근거 없는 주장을 막는다.
    server = { theme: 'light' };
    const apis = [];
    function TabProbe({ i }) {
      apis[i] = useUiPrefs();
      return <span id={`tab${i}`}>{JSON.stringify(apis[i].prefs)}</span>;
    }
    const tab = (i) => JSON.parse(document.getElementById(`tab${i}`).textContent);
    document.body.innerHTML = '<div id="root"></div>';
    activeRoot = createRoot(document.getElementById('root'));
    await act(async () => {
      activeRoot.render(
        <>
          <UiPrefsProvider fetchEnabled={true}><TabProbe i={0} /></UiPrefsProvider>
          <UiPrefsProvider fetchEnabled={true}><TabProbe i={1} /></UiPrefsProvider>
        </>,
      );
    });
    const g = deferredGet();
    let pA; await act(async () => { pA = apis[0].setNamespaceChecked('theme', 'dark'); });    // 탭A GET#0 보류
    let pB; await act(async () => { pB = apis[1].setNamespaceChecked('theme', 'system'); });  // 탭B가 더 새 값
    await act(async () => { g[1].ok(); await pB; });
    expect(server.theme).toBe('system');
    await act(async () => { g[0].ok(); await pA; });
    expect(tab(1).theme).toBe('system');
    expect(tab(0).theme).toBe('dark');               // ← 서버는 'system'인데 탭A는 'dark'다(P13 = C로 수용된 동작)
  });
});

describe('기존 setNamespace 회귀 방지', () => {
  it('여전히 실패를 삼킨다 — throw 하지 않고 재조회도 하지 않는다', async () => {
    await mount();
    const afterMount = gets;
    axios.patch.mockRejectedValue(new Error('nope'));
    await act(async () => { api.setNamespace('hidden', { branches: [1] }); });
    expect(seen().hidden).toEqual({ branches: [1] });   // 낙관값 유지, 롤백 없음
    expect(gets).toBe(afterMount);                      // 시퀀서 밖 경로라 드레인 GET도 없다
  });
});

describe('드레인 GET vs 기존 setNamespace — 서버 스냅샷이 진행 중·더 새 낙관값을 삼키지 않는다', () => {
  it('setNamespace PATCH가 in-flight인 채 theme 드레인 GET이 옛 스냅샷을 주면 그 키는 낙관값을 지킨다', async () => {
    // Sidebar 재정렬(setNamespace, 시퀀서 밖·fire-and-forget)이 아직 서버에 닿기 전에
    // 테마 토글(setNamespaceChecked)이 끝나 드레인 GET이 돌아온다. 스냅샷에는 옛
    // sidebar_order가 들어 있고, 통째 setPrefs(snapshot)면 방금 바꾼 순서가 화면에서 되돌아간다.
    server = { theme: 'light', sidebar_order: [1, 2] };
    await mount();
    const calls = deferredPatch();
    await act(async () => { api.setNamespace('sidebar_order', [2, 1]); });   // PATCH#0 보류
    expect(seen().sidebar_order).toEqual([2, 1]);
    let p; await act(async () => { p = api.setNamespaceChecked('theme', 'dark'); });  // PATCH#1
    expect(calls).toHaveLength(2);
    await act(async () => { calls[1].ok(); await p; });                      // 드레인 GET: 옛 sidebar_order
    expect(seen().theme).toBe('dark');
    expect(seen().sidebar_order).toEqual([2, 1]);                            // ← 되돌아가면 RED
    await act(async () => { calls[0].ok(); });
    expect(seen().sidebar_order).toEqual([2, 1]);
    expect(server.sidebar_order).toEqual([2, 1]);
  });

  it('드레인 GET 발신 뒤에 들어온 setNamespace(이미 완료)도 옛 GET 응답이 덮지 않는다', async () => {
    server = { theme: 'light', sidebar_order: [1, 2] };
    await mount();
    const g = deferredGet();
    let p; await act(async () => { p = api.setNamespaceChecked('theme', 'dark'); });  // GET#0 보류(스냅샷: 옛 순서)
    await act(async () => { api.setNamespace('sidebar_order', [2, 1]); });   // PATCH 즉시 성공 → 서버 갱신
    expect(server.sidebar_order).toEqual([2, 1]);
    await act(async () => { g[0].ok(); await p; });                          // 옛 스냅샷 도착
    expect(seen().theme).toBe('dark');
    expect(seen().sidebar_order).toEqual([2, 1]);                            // ← 더 새 낙관값이 살아야 한다
  });

  it('GET 발신 당시 in-flight였던 setNamespace가 응답 전에 끝나도 옛 스냅샷이 덮지 않는다', async () => {
    // 응답 시점만 보면 inflight=0·seq<=GET 발신 순번이라 보호에서 빠진다. 그러나 GET은
    // 발신 순간의 옛 sidebar_order를 스냅샷했고, 그 뒤 PATCH가 성공해 서버는 [2,1]이다.
    // 옛 응답을 채택하면 UI만 [1,2]로 되돌아가고 서버와 갈린다.
    server = { theme: 'light', sidebar_order: [1, 2] };
    await mount();
    const calls = deferredPatch();
    const g = deferredGet();
    await act(async () => { api.setNamespace('sidebar_order', [2, 1]); });   // 1. PATCH#0 보류
    let p; await act(async () => { p = api.setNamespaceChecked('theme', 'dark'); });  // 2. PATCH#1
    await act(async () => { calls[1].ok(); });                               //    → 드레인 GET#0 발신(옛 순서 스냅샷)
    expect(g).toHaveLength(1);
    await act(async () => { calls[0].ok(); });                               // 4. GET 응답 전에 sidebar PATCH 성공
    expect(server.sidebar_order).toEqual([2, 1]);
    await act(async () => { g[0].ok(); await p; });                          // 5. 옛 GET 응답 도착
    expect(seen().theme).toBe('dark');
    expect(seen().sidebar_order).toEqual([2, 1]);                            // 6. UI == 서버
    expect(server.sidebar_order).toEqual([2, 1]);
  });

  it('보호는 그 키에 한정된다 — 손대지 않은 키는 여전히 서버 최종값을 채택한다', async () => {
    server = { theme: 'light', sidebar_order: [1, 2], comment_sort: 'oldest' };
    await mount();
    const calls = deferredPatch();
    await act(async () => { api.setNamespace('sidebar_order', [2, 1]); });
    let p; await act(async () => { p = api.setNamespaceChecked('theme', 'dark'); });
    server.comment_sort = 'newest';                                          // 다른 탭이 바꿨다
    await act(async () => { calls[1].ok(); await p; });
    expect(seen().comment_sort).toBe('newest');
    expect(seen().sidebar_order).toEqual([2, 1]);
    await act(async () => { calls[0].ok(); });
  });
});
