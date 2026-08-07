// @tiptap/core Delete 확장(3.20.x)은 RemoveMarkStep 후처리에서 doc.nodeAt(newStart - 1)을
// 호출한다(dist:4020). 문서 앞머리로 매핑되는 mark 제거가 끼면 nodeAt(-1) → RangeError가
// setTimeout 콜백(dist:4044)에서 unhandled로 터져 에디터가 죽는다(2026-07-14 라이브 실측).
// 앱은 editor.on('delete')를 어디서도 구독하지 않으므로(전수 grep) 콜백 전체를 스킵한다 —
// filterTransaction이 truthy를 반환하면 상단에서 return(dist:3985). 모든 에디터 표면의
// useEditor는 이 상수를 coreExtensionOptions로 전달할 것.
export const WEAVE_CORE_EXTENSION_OPTIONS = {
  delete: { filterTransaction: () => true },
};
