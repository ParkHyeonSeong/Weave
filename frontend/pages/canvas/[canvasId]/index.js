import Head from 'next/head';
import CanvasOverview from '@/components/Canvas/CanvasOverview';

export default function CanvasOverviewPage() {
  return (
    <>
      <Head>
        <title>Canvas - Weave</title>
      </Head>
      <CanvasOverview />
    </>
  );
}
