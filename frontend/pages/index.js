import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import Launchpad from '@/components/Home/Launchpad';

export default function Home() {
  return (
    <Layout>
      <Head>
        <title>Weave</title>
        <meta name="description" content="Weave - Project Management Platform" />
      </Head>
      <Launchpad />
    </Layout>
  );
}
