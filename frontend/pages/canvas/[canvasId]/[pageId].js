import Head from 'next/head';
import CanvasPageView from '@/components/Canvas/CanvasPageView';

export default function CanvasPageRoute() {
  return (
    <>
      <Head>
        <title>Page - Weave</title>
      </Head>
      <CanvasPageView />
    </>
  );
}
