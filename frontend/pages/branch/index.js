import Head from 'next/head';
import BranchHome from '@/components/Branch/BranchHome';

export default function BranchIndex() {
  return (
    <>
      <Head>
        <title>Branch - Weave</title>
      </Head>
      <BranchHome />
    </>
  );
}
