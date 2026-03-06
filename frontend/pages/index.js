import Head from 'next/head';
import Launchpad from '@/components/Home/Launchpad';

export default function Home() {
  return (
    <>
      <Head>
        <title>Weave</title>
        <meta name="description" content="Weave - Project Management Platform" />
      </Head>
      <Launchpad />
    </>
  );
}
