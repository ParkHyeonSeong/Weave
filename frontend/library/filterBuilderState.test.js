import { describe, it, expect } from 'vitest';
import { emptyGroup, addCondition, removeNode, setGroupOp, isEmptySpec } from './filterBuilderState';

describe('FilterBuilder helpers', () => {
  it('empty', () => expect(isEmptySpec(emptyGroup())).toBe(true));
  it('add at root', () => {
    const s = addCondition(emptyGroup(), [], { type: 'cond', field: 'priority', op: 'eq', value: 'high' });
    expect(s.children).toHaveLength(1); expect(isEmptySpec(s)).toBe(false);
  });
  it('setGroupOp immutable', () => {
    const b = emptyGroup(); const n = setGroupOp(b, [], 'OR');
    expect(n.op).toBe('OR'); expect(b.op).toBe('AND');
  });
  it('remove child', () => {
    let s = addCondition(emptyGroup(), [], { type: 'cond', field: 'priority', op: 'eq', value: 'high' });
    s = removeNode(s, [0]); expect(s.children).toHaveLength(0);
  });
  it('nested add', () => {
    let s = addCondition(emptyGroup(), [], emptyGroup());
    s = addCondition(s, [0], { type: 'cond', field: 'status', op: 'eq', value: 'todo' });
    expect(s.children[0].children).toHaveLength(1);
  });
});
