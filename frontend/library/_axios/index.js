import axios from 'axios';

let isAuthExpiredDispatched = false;

const handleRequestFulfilled = (req) => {
  const token = typeof window !== 'undefined'
    ? sessionStorage.getItem('x_token')
    : null;
  if (token) {
    req.headers.Authorization = `Bearer ${token}`;
  }
  return req;
};

const handleResponseFulfilled = (response) => {
  if (response.data?.message === 'NEED_LOGIN' && !isAuthExpiredDispatched) {
    isAuthExpiredDispatched = true;
    sessionStorage.removeItem('x_token');
    sessionStorage.removeItem('profile');
    window.dispatchEvent(new CustomEvent('auth:expired'));
    setTimeout(() => { isAuthExpiredDispatched = false; }, 3000);
  }
  return response;
};

const handleResponseRejected = (error) => {
  return Promise.reject(error);
};

// API URL 동적 생성: LAN IP 접근 시에도 같은 호스트로 요청
function getBaseURL() {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_API_URL || '';
  const envUrl = process.env.NEXT_PUBLIC_API_URL || '';
  try {
    const parsed = new URL(envUrl);
    // 브라우저의 현재 hostname 사용 (LAN IP 대응)
    return `${parsed.protocol}//${window.location.hostname}:${parsed.port}`;
  } catch {
    return envUrl;
  }
}

const api = axios.create({
  baseURL: getBaseURL(),
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(handleRequestFulfilled);
api.interceptors.response.use(handleResponseFulfilled, handleResponseRejected);

export { api as axios, getBaseURL };
