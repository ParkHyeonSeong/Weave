import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import WikiHome from '@/components/Wiki/WikiHome';

export default function WikiIndex() {
  return (
    <Layout>
      <Head>
        <title>Wiki - Weave</title>
      </Head>
      <WikiHome />
    </Layout>
  );
}
