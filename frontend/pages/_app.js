import { useEffect } from 'react';
import { useRouter } from 'next/router';
import "@/styles/globals.scss";
import "@/styles/components/auth/login.scss";
import "@/styles/components/modal/alert.scss";

const publicPaths = ['/auth/login'];

export default function App({ Component, pageProps }) {
  const router = useRouter();

  useEffect(() => {
    const token = sessionStorage.getItem('x_token');
    const isPublic = publicPaths.includes(router.pathname);

    if (!token && !isPublic) {
      router.replace('/auth/login');
    } else if (token && isPublic) {
      router.replace('/');
    }
  }, [router.pathname]);

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

  return <Component {...pageProps} />;
}
