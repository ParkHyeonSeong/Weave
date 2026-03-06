import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import WikiPageView from '@/components/Wiki/WikiPageView';

export default function WikiPageRoute() {
  return (
    <Layout>
      <Head>
        <title>Page - Weave</title>
      </Head>
      <WikiPageView />
    </Layout>
  );
}
