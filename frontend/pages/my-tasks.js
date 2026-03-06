import Head from 'next/head';
import MyTasksView from '@/components/MyTasks/MyTasksView';

export default function MyTasks() {
  return (
    <>
      <Head>
        <title>My Tasks - Weave</title>
      </Head>
      <MyTasksView />
    </>
  );
}
