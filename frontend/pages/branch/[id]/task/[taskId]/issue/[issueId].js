import Head from 'next/head';
import TaskIssueDetail from '@/components/Branch/Tasks/TaskIssueDetail';

export default function IssuePage() {
  return (
    <>
      <Head>
        <title>Issue - Weave</title>
      </Head>
      <TaskIssueDetail />
    </>
  );
}
