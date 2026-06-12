import { useState } from 'react';
import Head from 'next/head';
import CanvasPageView from '@/components/Canvas/CanvasPageView';
import RefPanelHost from '@/components/shared/RefPanelHost';

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
        <RefPanelHost
          previewRef={previewRef}
          onClose={() => setPreviewRef(null)}
          onChangeRef={setPreviewRef}
        />
      </div>
    </>
  );
}
