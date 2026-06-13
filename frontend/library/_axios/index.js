import axios from 'axios';

let isAuthExpiredDispatched = false;

function dispatchAuthExpired() {
  if (isAuthExpiredDispatched) return;
  isAuthExpiredDispatched = true;
  sessionStorage.removeItem('profile');
  sessionStorage.removeItem('avatar_url');
  window.dispatchEvent(new CustomEvent('auth:expired'));
  setTimeout(() => { isAuthExpiredDispatched = false; }, 3000);
}

const handleResponseFulfilled = (response) => {
  if (response.data?.message === 'NEED_LOGIN') dispatchAuthExpired();
  return response;
};

// 단기 access 토큰(SEC-29) 만료로 401이 오면 refresh 쿠키로 1회 갱신 후 원요청을 재시도한다.
// 동시 다발 401은 단일 in-flight refresh로 합쳐 refresh 폭주를 막는다.
let refreshPromise = null;
let lastRefreshedAt = 0;

function refreshAccessToken() {
  // 갱신 직후(5s 쿨다운)의 추가 401은 새 refresh를 또 발생시키지 않고 기존 쿠키로 재시도시킨다
  // (회전 토큰을 중복 소비해 불필요한 강제 로그아웃이 나는 레이스 방지).
  if (!refreshPromise && Date.now() - lastRefreshedAt > 5000) {
    refreshPromise = api
      .post('/auth/refresh', null, { _skipAuthRetry: true })
      .then((r) => { lastRefreshedAt = Date.now(); return r; })
      .finally(() => { refreshPromise = null; });
  } else if (!refreshPromise) {
    return Promise.resolve();  // 쿨다운 내 — 이미 갱신됨
  }
  return refreshPromise;
}

const handleResponseRejected = async (error) => {
  const original = error.config;
  const status = error.response?.status;
  const url = original?.url || '';
  // refresh/login 자체 실패나 이미 재시도한 요청은 갱신 대상 아님(무한루프 방지)
  const retryable = status === 401 && original && !original._retried
    && !original._skipAuthRetry
    && !url.includes('/auth/refresh') && !url.includes('/auth/login');

  if (retryable) {
    original._retried = true;
    try {
      await refreshAccessToken();
      return api(original);  // 새 access 쿠키로 원요청 재시도
    } catch (_) {
      dispatchAuthExpired();
      return Promise.reject(error);
    }
  }
  if (status === 401) dispatchAuthExpired();
  return Promise.reject(error);
};

// API URL 동적 생성: LAN IP 접근 시에도 같은 호스트로 요청
function getBaseURL() {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_API_URL || '';
  const envUrl = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const parsed = new URL(envUrl);
    // 프로덕션 (포트 명시 없음): URL 그대로 사용
    if (!parsed.port) return envUrl;
    // 개발 (포트 명시): 브라우저의 현재 hostname 사용 (LAN IP 대응)
    return `${parsed.protocol}//${window.location.hostname}:${parsed.port}`;
  } catch {
    return envUrl;
  }
}

// WebSocket base URL 생성 (HTTP URL -> WS URL 변환)
function getWsBaseURL() {
  const base = getBaseURL();
  if (!base) {
    // 프로덕션: same-origin, 프로토콜만 변환
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProtocol}://${window.location.host}`;
  }
  return base.replace(/^http/, 'ws');
}

const api = axios.create({
  baseURL: `${getBaseURL()}/api`,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.response.use(handleResponseFulfilled, handleResponseRejected);

// WebSocket 재연결 등 axios 밖에서도 access 토큰을 선제 갱신할 수 있게 노출(쿨다운 공유).
export { api as axios, getBaseURL, getWsBaseURL, refreshAccessToken };
