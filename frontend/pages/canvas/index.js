import Head from 'next/head';
import CanvasHome from '@/components/Canvas/CanvasHome';

export default function CanvasIndex() {
  return (
    <>
      <Head>
        <title>Canvas - Weave</title>
      </Head>
      <CanvasHome />
    </>
  );
}
