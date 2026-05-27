import Head from 'next/head';
import TrackSettings from '@/components/Track/Settings/TrackSettings';

export default function TrackSettingsPage() {
  return (
    <>
      <Head>
        <title>Track Settings · Weave</title>
      </Head>
      <TrackSettings />
    </>
  );
}
