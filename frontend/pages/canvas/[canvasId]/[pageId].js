import { useState } from 'react';
import Head from 'next/head';
import CanvasPageView from '@/components/Canvas/CanvasPageView';
import RefPreviewPanel from '@/components/Canvas/RefPreviewPanel';

export default function CanvasPageRoute() {
  const [previewRef, setPreviewRef] = useState(null);

  return (
    <>
      <Head>
        <title>Page - Weave</title>
      </Head>
      <div className="CanvasPageLayout">
        <div className="CanvasPageLayout__Main">
          <CanvasPageView onRefClick={setPreviewRef} />
        </div>
        {previewRef && (
          <RefPreviewPanel
            refType={previewRef.type}
            refData={previewRef.data}
            onClose={() => setPreviewRef(null)}
          />
        )}
      </div>
    </>
  );
}
