import Head from 'next/head';
import CreateIssuePage from '@/components/Branch/Tasks/CreateIssuePage';

export default function NewIssuePage() {
  return (
    <>
      <Head>
        <title>New Issue - Weave</title>
      </Head>
      <CreateIssuePage />
    </>
  );
}
