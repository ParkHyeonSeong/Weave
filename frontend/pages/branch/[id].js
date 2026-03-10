import Head from 'next/head';
import BranchDetail from '@/components/Branch/BranchDetail';

export default function BranchPage() {
  return (
    <>
      <Head>
        <title>Branch - Weave</title>
      </Head>
      <BranchDetail />
    </>
  );
}
