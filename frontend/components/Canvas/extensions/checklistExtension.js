import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

// 체크리스트(TaskList/TaskItem) 확장을 한 곳에서 구성한다.
// TipTap v3의 TaskItem NodeView는 편집 중 그리는 <li>에 data-type="taskItem"을
// 붙이지 않아(data-checked만 설정), li[data-type="taskItem"]{display:flex} SCSS
// 규칙이 적용되지 않으면 체크박스 다음 줄로 본문이 밀린다. HTMLAttributes로
// data-type을 부여해 라이브 DOM이 저장 HTML/CSS 셀렉터와 일치하도록 한다.
// 새 에디터도 이 헬퍼를 통해 체크리스트를 추가하면 data-type 누락을 피한다.
export const checklistExtensions = ({ nested = true } = {}) => [
  TaskList,
  TaskItem.configure({ nested, HTMLAttributes: { 'data-type': 'taskItem' } }),
];
