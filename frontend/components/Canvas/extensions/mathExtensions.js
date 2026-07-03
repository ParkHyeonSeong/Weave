import Mathematics from '@tiptap/extension-mathematics';
import MathEditExtension, { mathEditPluginKey } from './MathEditExtension';

export { mathEditPluginKey };

// 수식 지원 에디터 공용 묶음: 노드(inlineMath/blockMath, $$·$$$ 입력 규칙 내장) + 클릭 편집 팝오버.
// 주의: inlineOptions/blockOptions의 onClick을 설정하지 말 것 — 설정 시 NodeView가
// stopPropagation하는 자체 클릭 리스너를 달아 MathEditExtension의 handleClickOn과
// 이중 처리된다. 클릭 감지는 handleClickOn 한 경로만 쓴다(멀티 에디터 페이지에서
// 인스턴스별 view 접근이 필요해 onClick(node, pos) 시그니처로는 배선 불가).
export function mathExtensions() {
  return [
    Mathematics.configure({ katexOptions: { throwOnError: false } }),
    MathEditExtension,
  ];
}
