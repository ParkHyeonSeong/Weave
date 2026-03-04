import Head from 'next/head';
import SetupWizard from '@/components/Setup/SetupWizard';

export default function SetupPage() {
  return (
    <>
      <Head>
        <title>Weave - Initial Setup</title>
        <meta name="description" content="Configure your Weave workspace" />
      </Head>
      <SetupWizard />
    </>
  );
}
