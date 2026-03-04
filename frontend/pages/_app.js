import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import "@/styles/globals.scss";
import "@/styles/fonts.css";
import "@/styles/components/auth/login.scss";
import "@/styles/components/modal/alert.scss";
import "@/styles/components/setup/setup.scss";

const publicPaths = ['/auth/login', '/setup'];

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    checkAppState();
  }, [router.pathname]);

  const checkAppState = async () => {
    setAppReady(false);

    try {
      const res = await axios.get('/setup/status');
      const { initialized } = res.data;
      const token = sessionStorage.getItem('x_token');

      if (!initialized) {
        // 미초기화 상태: /setup 외 모든 경로 차단
        if (router.pathname !== '/setup') {
          router.replace('/setup');
          return;
        }
      } else if (router.pathname === '/setup') {
        // 초기화 완료 후 /setup 접근 차단
        router.replace(token ? '/' : '/auth/login');
        return;
      } else if (!token && !publicPaths.includes(router.pathname)) {
        // 미인증 + 비공개 경로
        router.replace('/auth/login');
        return;
      } else if (token && router.pathname === '/auth/login') {
        // 인증 상태에서 로그인 페이지 접근
        router.replace('/');
        return;
      }
    } catch (error) {
      // API 실패 시: 토큰 없으면 로그인으로
      const token = sessionStorage.getItem('x_token');
      if (!token && router.pathname !== '/auth/login') {
        router.replace('/auth/login');
        return;
      }
    }

    setAppReady(true);
  };

  // auth:expired 이벤트 수신 (axios 인터셉터에서 발송)
  useEffect(() => {
    const handleExpired = () => {
      sessionStorage.removeItem('x_token');
      sessionStorage.removeItem('profile');
      router.replace('/auth/login');
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  if (!appReady) return null;

  return <Component {...pageProps} />;
}
