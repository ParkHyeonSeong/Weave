import { useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { ArrowRight, Maximize2, Link2, Trash2, ArrowUpToLine, FolderInput } from 'lucide-react';
import { axios } from '@/library/_axios';
import useContextMenu from '@/components/common/useContextMenu';
import { showToast } from '@/components/Layout/Toast';
import { taskDeleteMessage } from '@/library/taskDeleteMessage';

/**
 * 태스크 행/카드 공용 우클릭 메뉴 훅. 리스트·보드 뷰가 같이 쓴다.
 *
 * 사용:
 *   const menu = useTaskContextMenu({ branchId, onSelectTask });
 *   행/카드: onContextMenu={(e) => menu.openMenu(e, task)}
 *   렌더: <ContextMenu {...menu.menuProps} /> + ConfirmModal(menu.confirmTask 기반)
 *         + ParentPickerPopup(menu.parentPicker 기반)
 */
const PARENT_REJECT_MSG = {
  PARENT_NOT_TOP_LEVEL: '하위 태스크는 부모가 될 수 없습니다.',
  TARGET_HAS_SUBTASKS: '하위를 가진 태스크는 다른 태스크의 하위가 될 수 없습니다.',
};

export default function useTaskContextMenu({ branchId, onSelectTask }) {
  const router = useRouter();
  const ctx = useContextMenu();
  const { open } = ctx;
  const [confirmTask, setConfirmTask] = useState(null);
  const [parentPicker, setParentPicker] = useState(null); // { task } | null

  const patchParent = useCallback(async (task, parentTaskId) => {
    try {
      const res = await axios.patch(
        `/branches/${branchId}/tasks/${task.task_id}`,
        { parent_task_id: parentTaskId },
      );
      if (res.data?.status) {
        window.dispatchEvent(new Event('task:updated'));
        showToast(parentTaskId === null ? '상위 태스크로 승격했습니다' : '하위 태스크로 이동했습니다');
      } else {
        showToast(PARENT_REJECT_MSG[res.data?.message] || '이동하지 못했습니다.', 'error');
      }
    } catch {
      showToast('이동하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  }, [branchId]);

  const openMenu = useCallback((e, task) => {
    const path = `/branch/${branchId}/task/${task.task_id}`;
    const isSubtask = !!task.parent_task_id;
    const hasSubtasks = (task.subtasks?.length || 0) > 0;
    const items = [
      { id: 'open', group: 'open', icon: ArrowRight, label: '열기', onSelect: () => onSelectTask?.(task) },
      { id: 'open-full', group: 'open', icon: Maximize2, label: '풀페이지로 열기', onSelect: () => router.push(path) },
    ];
    if (isSubtask) {
      items.push({
        id: 'promote', group: 'organize', icon: ArrowUpToLine, label: '상위로 승격',
        onSelect: () => patchParent(task, null),
      });
    } else if (!hasSubtasks) {
      // 하위를 가진 태스크는 하위가 될 수 없음(1단계 불변식)
      items.push({
        id: 'move-under', group: 'organize', icon: FolderInput, label: '…의 하위로 이동',
        onSelect: () => setParentPicker({ task }),
      });
    }
    items.push(
      {
        id: 'copy-link', group: 'share', icon: Link2, label: '링크 복사',
        onSelect: () => {
          navigator.clipboard.writeText(`${window.location.origin}${path}`)
            .then(() => showToast('링크가 복사되었습니다'))
            .catch(() => {});
        },
      },
      { id: 'delete', group: 'danger', icon: Trash2, variant: 'danger', label: '삭제', onSelect: () => setConfirmTask(task) },
    );
    open(e, items);
  }, [branchId, onSelectTask, router, open, patchParent]);

  const handlePickParent = useCallback((parentTask) => {
    const source = parentPicker?.task;
    setParentPicker(null);
    if (source && parentTask) patchParent(source, parentTask.task_id);
  }, [parentPicker, patchParent]);

  const closeParentPicker = useCallback(() => setParentPicker(null), []);

  const handleConfirmDelete = useCallback(async () => {
    const task = confirmTask;
    setConfirmTask(null);
    if (!task) return;
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${task.task_id}`);
      if (res.data?.status) {
        window.dispatchEvent(new Event('task:updated'));
        // 상세 패널이 이 태스크를 열고 있으면 닫도록 알림 (BranchDetail이 수신)
        window.dispatchEvent(new CustomEvent('task:deleted', { detail: { taskId: task.task_id } }));
      } else {
        showToast(res.data?.message || '태스크를 삭제하지 못했습니다.', 'error');
      }
    } catch {
      showToast('태스크를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  }, [branchId, confirmTask]);

  const clearConfirm = useCallback(() => setConfirmTask(null), []);

  const confirmTitle = 'Delete Task';
  const confirmMessage = confirmTask
    ? taskDeleteMessage(confirmTask, {
      prefix: `${confirmTask.display_id ?? ''} 태스크를 삭제하시겠습니까?`,
    })
    : '';

  return {
    openMenu,
    menuProps: ctx.props,
    confirmTask,
    confirmTitle,
    confirmMessage,
    clearConfirm,
    handleConfirmDelete,
    parentPicker,
    closeParentPicker,
    handlePickParent,
  };
}
