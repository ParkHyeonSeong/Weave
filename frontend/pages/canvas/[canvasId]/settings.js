import Head from 'next/head';
import CanvasSettings from '@/components/Canvas/Settings/CanvasSettings';

export default function CanvasSettingsPage() {
  return (
    <>
      <Head>
        <title>Canvas Settings - Weave</title>
      </Head>
      <CanvasSettings />
    </>
  );
}
