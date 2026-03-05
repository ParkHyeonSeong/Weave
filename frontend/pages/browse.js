import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import BrowseBranches from '@/components/Browse/BrowseBranches';

export default function Browse() {
  return (
    <Layout>
      <Head>
        <title>Browse Branches - Weave</title>
      </Head>
      <BrowseBranches />
    </Layout>
  );
}
