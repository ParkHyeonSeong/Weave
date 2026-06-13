import Head from 'next/head';
import TaskIssueDetail from '@/components/Branch/Tasks/TaskIssueDetail';
import RefPanelPageLayout from '@/components/shared/RefPanelPageLayout';

export default function IssuePage() {
  return (
    <>
      <Head>
        <title>Issue - Weave</title>
      </Head>
      <RefPanelPageLayout>
        <TaskIssueDetail />
      </RefPanelPageLayout>
    </>
  );
}
