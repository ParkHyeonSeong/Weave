import Head from 'next/head';
import CanvasPageView from '@/components/Canvas/CanvasPageView';
import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';

export default function CanvasPageRoute() {
  // 패널 상태로 들어오는 두 경로: 편집 모드 칩은 window 이벤트(useRefPreview 수신),
  // 읽기 모드 칩은 window 이벤트를 안 쏘므로 onRefClick prop으로 직접 전달.
  const [previewRef, setPreviewRef] = useRefPreview();

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
