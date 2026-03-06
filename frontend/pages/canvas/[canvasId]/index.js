import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import CanvasOverview from '@/components/Canvas/CanvasOverview';

export default function CanvasOverviewPage() {
  return (
    <Layout>
      <Head>
        <title>Canvas - Weave</title>
      </Head>
      <CanvasOverview />
    </Layout>
  );
}
