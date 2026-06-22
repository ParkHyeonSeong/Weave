// frontend/library/filterBuilderState.js
// FilterBuilder의 순수 불변 헬퍼 — JSX 컴포넌트(FilterBuilder.js)와 분리해 vitest(library/**)로 커버.
export const emptyGroup = () => ({ type: 'group', op: 'AND', negate: false, children: [] });
export const isEmptySpec = (spec) => !spec || (spec.type === 'group' && spec.children.length === 0);

export function updateAtPath(node, path, fn) {
  if (path.length === 0) return fn(node);
  const [head, ...rest] = path;
  return { ...node, children: node.children.map((c, i) => (i === head ? updateAtPath(c, rest, fn) : c)) };
}
export const addCondition = (spec, path, child) =>
  updateAtPath(spec, path, (g) => ({ ...g, children: [...g.children, child] }));
export const setGroupOp = (spec, path, op) => updateAtPath(spec, path, (g) => ({ ...g, op }));
export const removeNode = (spec, path) => {
  if (path.length === 0) return spec;
  const idx = path[path.length - 1];
  return updateAtPath(spec, path.slice(0, -1), (g) => ({ ...g, children: g.children.filter((_, i) => i !== idx) }));
};
