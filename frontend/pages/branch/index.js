import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import BranchHome from '@/components/Branch/BranchHome';

export default function BranchIndex() {
  return (
    <Layout>
      <Head>
        <title>Branch - Weave</title>
      </Head>
      <BranchHome />
    </Layout>
  );
}
