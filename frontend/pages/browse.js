import Head from 'next/head';
import BrowseBranches from '@/components/Browse/BrowseBranches';

export default function Browse() {
  return (
    <>
      <Head>
        <title>Browse - Weave</title>
      </Head>
      <BrowseBranches />
    </>
  );
}
