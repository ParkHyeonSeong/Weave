import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>Weave</title>
        <meta name="description" content="Weave - Project Management Platform" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <h1>Weave</h1>
      </div>
    </>
  );
}
