import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';

/**
 * 풀페이지 라우트(canvas·task·issue)용 레이아웃 — 본문 + 우측 ref 패널.
 * useRefPreview를 자체 보유하므로 라우트는 칩 클릭 상태를 신경 쓸 필요가 없고,
 * children을 element로 넘기면(참조가 고정됨) 칩 클릭으로 패널이 열려도 본문은
 * 리렌더되지 않는다. 읽기 모드 폴백(canvas의 onRefClick)이 필요한 라우트는
 * children을 함수로 넘겨 setPreviewRef를 받는다.
 *
 * BranchDetail은 작업 패널과 나란히 놓이는 3열 구성 + 같은 task 중복 가드라는
 * 고유 사정이 있어, 이 컴포넌트를 쓰지 않고 useRefPreview를 직접 쓴다.
 */
export default function RefPanelPageLayout({ children }) {
  const [previewRef, setPreviewRef] = useRefPreview();
  return (
    <div className="RefPanelPageLayout">
      <div className="RefPanelPageLayout__Main">
        {typeof children === 'function' ? children(setPreviewRef) : children}
      </div>
      <RefPanelHost
        previewRef={previewRef}
        onClose={() => setPreviewRef(null)}
        onChangeRef={setPreviewRef}
      />
    </div>
  );
}
