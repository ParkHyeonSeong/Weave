import Head from 'next/head';
import HomeView from '@/components/Home/HomeView';

export default function Home() {
  return (
    <>
      <Head>
        <title>Weave</title>
        <meta name="description" content="Weave - Project Management Platform" />
      </Head>
      <HomeView />
    </>
  );
}
