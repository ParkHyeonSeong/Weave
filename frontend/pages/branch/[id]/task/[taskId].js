import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import TaskFullPage from '@/components/Branch/Tasks/TaskFullPage';

export default function TaskPage() {
  return (
    <Layout>
      <Head>
        <title>Task - Weave</title>
      </Head>
      <TaskFullPage />
    </Layout>
  );
}
