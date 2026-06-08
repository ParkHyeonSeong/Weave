import Head from 'next/head';
import ScrumSettings from '@/components/Scrum/Settings/ScrumSettings';

export default function ScrumSettingsPage() {
  return (
    <>
      <Head>
        <title>Scrum Settings · Weave</title>
      </Head>
      <ScrumSettings />
    </>
  );
}
