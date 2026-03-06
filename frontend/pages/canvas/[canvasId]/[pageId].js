import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import CanvasPageView from '@/components/Canvas/CanvasPageView';

export default function CanvasPageRoute() {
  return (
    <Layout>
      <Head>
        <title>Page - Weave</title>
      </Head>
      <CanvasPageView />
    </Layout>
  );
}
