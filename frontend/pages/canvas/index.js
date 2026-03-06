import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import CanvasHome from '@/components/Canvas/CanvasHome';

export default function CanvasIndex() {
  return (
    <Layout>
      <Head>
        <title>Canvas - Weave</title>
      </Head>
      <CanvasHome />
    </Layout>
  );
}
