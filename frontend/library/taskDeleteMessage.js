/**
 * 태스크 삭제 cascade 경고 메시지 공용 헬퍼.
 *
 * cascade 삭제는 cancelled 포함 모든 하위를 지우지만 subtask_progress.total은
 * cancelled를 제외하므로, 개수는 반드시 전체 자식 배열(task.subtasks)에서만 센다.
 * subtask_progress로 폴백하면 cancelled 만큼 적게 세서 경고가 누락된다.
 */
export function subtaskCount(task) {
  return Array.isArray(task?.subtasks) ? task.subtasks.length : 0;
}

/**
 * @param {object} task - subtasks 전체 배열을 가진 태스크
 * @param {{ prefix: string }} opts - 호출부별 기존 확인 문구(그대로 유지)
 * @returns {string} prefix + (하위가 있으면) cascade 경고
 */
export function taskDeleteMessage(task, { prefix }) {
  const n = subtaskCount(task);
  if (n > 0) {
    return `${prefix} 하위태스크 ${n}개도 함께 삭제됩니다.`;
  }
  return prefix;
}
