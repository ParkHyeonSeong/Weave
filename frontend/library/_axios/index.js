import axios from 'axios';

let isAuthExpiredDispatched = false;

const handleResponseFulfilled = (response) => {
  if (response.data?.message === 'NEED_LOGIN' && !isAuthExpiredDispatched) {
    isAuthExpiredDispatched = true;
    sessionStorage.removeItem('profile');
    sessionStorage.removeItem('avatar_url');
    window.dispatchEvent(new CustomEvent('auth:expired'));
    setTimeout(() => { isAuthExpiredDispatched = false; }, 3000);
  }
  return response;
};

const handleResponseRejected = (error) => {
  if (error.response?.status === 401 && !isAuthExpiredDispatched) {
    isAuthExpiredDispatched = true;
    sessionStorage.removeItem('profile');
    sessionStorage.removeItem('avatar_url');
    window.dispatchEvent(new CustomEvent('auth:expired'));
    setTimeout(() => { isAuthExpiredDispatched = false; }, 3000);
  }
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

export { api as axios, getBaseURL, getWsBaseURL };
