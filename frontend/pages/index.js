import Head from 'next/head';
import Layout from '@/components/Layout/Layout';

export default function Home() {
  return (
    <Layout>
      <Head>
        <title>Weave</title>
        <meta name="description" content="Weave - Project Management Platform" />
      </Head>
      <div>
        <h2>Home</h2>
        <p>Welcome to Weave.</p>
      </div>
    </Layout>
  );
}
