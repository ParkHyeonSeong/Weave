import Head from 'next/head';
import Layout from '@/components/Layout/Layout';
import TaskIssueDetail from '@/components/Branch/Tasks/TaskIssueDetail';

export default function IssuePage() {
  return (
    <Layout>
      <Head>
        <title>Issue - Weave</title>
      </Head>
      <TaskIssueDetail />
    </Layout>
  );
}
