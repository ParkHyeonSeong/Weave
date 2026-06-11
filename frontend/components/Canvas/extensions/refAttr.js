// ref 칩 노드(taskRef/issueRef/docRef) 공용 attribute 정의 헬퍼.
// parseHTML: 저장된 HTML 재파싱(설명 편집 재진입 등) 시 data-*에서 attrs 복원.
// 칩 노드는 renderHTML()이 data-* 전부를 직접 출력하므로 per-attr 렌더는 반드시
// 억제해야 한다(안 하면 camelCase 중복 속성이 저장 HTML에 섞임) — 그 불변식을 코드로 강제.
export const numAttr = (name) => ({
  default: null,
  parseHTML: (el) => {
    const v = el.getAttribute(name);
    return v != null && v !== '' ? Number(v) : null;
  },
  renderHTML: () => ({}),
});

export const strAttr = (name, def = '') => ({
  default: def,
  parseHTML: (el) => el.getAttribute(name) || def,
  renderHTML: () => ({}),
});
