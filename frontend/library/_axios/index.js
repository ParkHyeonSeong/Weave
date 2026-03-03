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

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.request.use(handleRequestFulfilled);
api.interceptors.response.use(handleResponseFulfilled, handleResponseRejected);

export { api as axios };
