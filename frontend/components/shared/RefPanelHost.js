import dynamic from 'next/dynamic';
import RefPreviewPanel from '@/components/Canvas/RefPreviewPanel';

// TipTap 에디터 서브트리(설명·댓글 에디터)를 물고 있어, 칩을 클릭하기 전까지는
// 호스트 화면의 초기 번들에 싣지 않는다.
const TaskDetailPanel = dynamic(() => import('@/components/Branch/Tasks/TaskDetailPanel'), { ssr: false });

/**
 * 인라인 ref 칩 클릭 패널 라우터 — 칩 타입별로 패널을 분기한다.
 * task는 편집 가능한 TaskDetailPanel을 그대로 재사용(편집 패널 중복 구현 금지),
 * doc/issue는 읽기 전용 RefPreviewPanel. onChangeRef 체이닝은 현재 task→task
 * (패널 설명 안의 task-ref 클릭)만 연결되어 있다.
 */
export default function RefPanelHost({ previewRef, onClose, onChangeRef }) {
  if (!previewRef) return null;

  if (previewRef.type === 'task') {
    // 칩 클릭 경로에 따라 id가 string(DOM attr)일 수 있어 한 곳에서 정규화
    const branchId = Number(previewRef.data.branchId);
    const taskId = Number(previewRef.data.taskId);
    return (
      <TaskDetailPanel
        key={`${branchId}-${taskId}`}
        branchId={branchId}
        taskSummary={{ task_id: taskId }}
        onClose={onClose}
        onSelectTask={(t) =>
          onChangeRef({ type: 'task', data: { branchId: t.branch_id || branchId, taskId: t.task_id } })
        }
      />
    );
  }

  return <RefPreviewPanel refType={previewRef.type} refData={previewRef.data} onClose={onClose} />;
}
