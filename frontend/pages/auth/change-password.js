import Head from 'next/head';
import ForceChangePassword from '@/components/Auth/ForceChangePassword';

export default function ChangePasswordPage() {
  return (
    <>
      <Head>
        <title>Weave - Change Password</title>
        <meta name="description" content="Change your password" />
      </Head>
      <ForceChangePassword />
    </>
  );
}
