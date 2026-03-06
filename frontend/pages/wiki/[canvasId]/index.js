import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import WikiCanvas from '@/components/Wiki/WikiCanvas';

export default function WikiCanvasPage() {
  return (
    <Layout>
      <Head>
        <title>Canvas - Weave</title>
      </Head>
      <WikiCanvas />
    </Layout>
  );
}
