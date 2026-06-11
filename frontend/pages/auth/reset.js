import Head from 'next/head';
import { useRouter } from 'next/router';
import ResetPassword from '@/components/Auth/ResetPassword';

export default function ResetPasswordPage() {
  const router = useRouter();

  // router.isReady 이전에는 query가 비어 있으므로 토큰 판정을 보류한다.
  if (!router.isReady) return null;

  const { token } = router.query;
  const tokenValue = Array.isArray(token) ? token[0] : token;

  return (
    <>
      <Head>
        <title>Weave - Reset Password</title>
        <meta name="description" content="Reset your password" />
      </Head>
      <ResetPassword token={tokenValue || ''} />
    </>
  );
}
