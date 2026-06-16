import { describe, it, expect } from 'vitest';
import { getRefUrl, refFromChipEl, refUrlFromChipEl } from './refUrl.js';

// DOM 없이 node에서 테스트하기 위한 가짜 칩 엘리먼트
const chip = (attrs) => ({
  hasAttribute: (a) => a in attrs,
  getAttribute: (a) => (a in attrs ? attrs[a] : null),
});

describe('getRefUrl', () => {
  it('task/issue/doc 경로를 만든다', () => {
    expect(getRefUrl('task', { branchId: '1', taskId: '2' })).toBe('/branch/1/task/2');
    expect(getRefUrl('issue', { branchId: '1', taskId: '2', issueId: '3' })).toBe('/branch/1/task/2/issue/3');
    expect(getRefUrl('doc', { canvasId: '4', pageId: '5' })).toBe('/canvas/4/5');
  });

  it('필수 id가 빠지면 null', () => {
    expect(getRefUrl('task', { branchId: '1' })).toBe(null);
    expect(getRefUrl('issue', { branchId: '1', taskId: '2' })).toBe(null);
    expect(getRefUrl('doc', { canvasId: '4' })).toBe(null);
  });

  it('알 수 없는 타입은 null', () => {
    expect(getRefUrl('bogus', { branchId: '1', taskId: '2' })).toBe(null);
    expect(getRefUrl(undefined)).toBe(null);
  });
});

describe('refFromChipEl', () => {
  it('data 속성에서 디스크립터를 읽는다', () => {
    expect(refFromChipEl(chip({ 'data-task-ref': '', 'data-branch-id': '1', 'data-task-id': '2' })))
      .toEqual({ type: 'task', data: { branchId: '1', taskId: '2' } });
    expect(refFromChipEl(chip({ 'data-issue-ref': '', 'data-branch-id': '1', 'data-task-id': '2', 'data-issue-id': '3' })))
      .toEqual({ type: 'issue', data: { branchId: '1', taskId: '2', issueId: '3' } });
    expect(refFromChipEl(chip({ 'data-doc-ref': '', 'data-canvas-id': '4', 'data-page-id': '5' })))
      .toEqual({ type: 'doc', data: { canvasId: '4', pageId: '5' } });
  });

  it('ref 칩이 아니면 null', () => {
    expect(refFromChipEl(chip({ class: 'foo' }))).toBe(null);
    expect(refFromChipEl(null)).toBe(null);
  });
});

describe('refUrlFromChipEl', () => {
  it('칩 엘리먼트 → URL', () => {
    expect(refUrlFromChipEl(chip({ 'data-doc-ref': '', 'data-canvas-id': '4', 'data-page-id': '5' }))).toBe('/canvas/4/5');
    expect(refUrlFromChipEl(chip({ 'data-task-ref': '', 'data-branch-id': '1', 'data-task-id': '2' }))).toBe('/branch/1/task/2');
    expect(refUrlFromChipEl(chip({ class: 'x' }))).toBe(null);
  });
});
