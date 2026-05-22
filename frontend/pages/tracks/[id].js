import Head from 'next/head';
import TrackDetail from '@/components/Track/TrackDetail';

export default function TrackPage() {
  return (
    <>
      <Head>
        <title>Track · Weave</title>
      </Head>
      <TrackDetail />
    </>
  );
}
