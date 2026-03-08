import Head from 'next/head';
import Dashboard from '@/components/Home/Dashboard';

export default function Home() {
  return (
    <>
      <Head>
        <title>Weave</title>
        <meta name="description" content="Weave - Project Management Platform" />
      </Head>
      <Dashboard />
    </>
  );
}
