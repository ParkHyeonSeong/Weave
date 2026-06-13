import Head from 'next/head';
import TaskFullPage from '@/components/Branch/Tasks/TaskFullPage';
import RefPanelPageLayout from '@/components/shared/RefPanelPageLayout';

export default function TaskPage() {
  return (
    <>
      <Head>
        <title>Task - Weave</title>
      </Head>
      <RefPanelPageLayout>
        <TaskFullPage />
      </RefPanelPageLayout>
    </>
  );
}
