import Head from 'next/head';
import TrackHome from '@/components/Track/TrackHome';

export default function TracksIndex() {
  return (
    <>
      <Head>
        <title>Tracks - Weave</title>
      </Head>
      <TrackHome />
    </>
  );
}
