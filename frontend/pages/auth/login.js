import Head from 'next/head';
import Login from '@/components/Auth/Login';

export default function LoginPage() {
  return (
    <>
      <Head>
        <title>Weave - Sign In</title>
        <meta name="description" content="Sign in to Weave" />
      </Head>
      <Login />
    </>
  );
}
