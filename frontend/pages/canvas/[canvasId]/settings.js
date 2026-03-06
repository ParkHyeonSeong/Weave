import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import CanvasSettings from '@/components/Canvas/Settings/CanvasSettings';

export default function CanvasSettingsPage() {
  return (
    <Layout>
      <Head>
        <title>Canvas Settings - Weave</title>
      </Head>
      <CanvasSettings />
    </Layout>
  );
}
