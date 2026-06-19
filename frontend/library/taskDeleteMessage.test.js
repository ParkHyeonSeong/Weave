import { describe, it, expect } from 'vitest';
import { subtaskCount, taskDeleteMessage } from './taskDeleteMessage.js';

describe('subtaskCount', () => {
  it('subtasks 배열 길이를 센다 (cancelled 포함)', () => {
    expect(subtaskCount({ subtasks: [{}, {}, {}] })).toBe(3);
  });
  it('subtasks 없으면 0', () => {
    expect(subtaskCount({})).toBe(0);
    expect(subtaskCount(null)).toBe(0);
    expect(subtaskCount(undefined)).toBe(0);
  });
  it('subtask_progress.total로 폴백하지 않는다 (cancelled 누락 방지)', () => {
    // subtasks 배열이 없으면 progress.total이 있어도 0 — 경고 미표시
    expect(subtaskCount({ subtask_progress: { done: 1, total: 5 } })).toBe(0);
  });
  it('subtasks가 progress.total보다 클 때 subtasks 길이를 쓴다', () => {
    // cancelled 2개 포함 → subtasks 5, progress.total 3. cascade 기준은 5.
    expect(subtaskCount({
      subtasks: [{}, {}, {}, {}, {}],
      subtask_progress: { done: 1, total: 3 },
    })).toBe(5);
  });
});

describe('taskDeleteMessage', () => {
  it('하위 있으면 cascade 경고를 prefix 뒤에 붙인다', () => {
    expect(taskDeleteMessage(
      { subtasks: [{}, {}] },
      { prefix: 'X-1 태스크를 삭제하시겠습니까?' },
    )).toBe('X-1 태스크를 삭제하시겠습니까? 하위태스크 2개도 함께 삭제됩니다.');
  });
  it('하위 없으면 prefix만 반환', () => {
    expect(taskDeleteMessage(
      { subtasks: [] },
      { prefix: 'X-1 태스크를 삭제하시겠습니까?' },
    )).toBe('X-1 태스크를 삭제하시겠습니까?');
  });
  it('subtask_progress.total만 있고 subtasks 없으면 경고 미표시 (폴백 금지)', () => {
    expect(taskDeleteMessage(
      { subtask_progress: { done: 0, total: 4 } },
      { prefix: '"AB-3 - 제목" 을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.' },
    )).toBe('"AB-3 - 제목" 을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.');
  });
});
