import Head from 'next/head';
import TaskFullPage from '@/components/Branch/Tasks/TaskFullPage';

export default function TaskPage() {
  return (
    <>
      <Head>
        <title>Task - Weave</title>
      </Head>
      <TaskFullPage />
    </>
  );
}
