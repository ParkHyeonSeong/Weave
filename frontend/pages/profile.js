import Head from 'next/head';
import Profile from '@/components/Profile/Profile';

export default function ProfilePage() {
  return (
    <>
      <Head>
        <title>Profile - Weave</title>
      </Head>
      <Profile />
    </>
  );
}
