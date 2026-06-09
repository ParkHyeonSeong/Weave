import { useState, useEffect, useCallback } from 'react';
import { Bold, Italic, Strikethrough, ListChecks, List, Link as LinkIcon } from 'lucide-react';

const TBtn = ({ active, onClick, title, children }) => (
  <button
    type="button"
    className={`ScrumCellToolbar__Btn ${active ? 'is-active' : ''}`}
    title={title}
    onMouseDown={(e) => e.preventDefault()} // 클릭 시 에디터 blur 방지 → 툴바 유지
    onClick={onClick}
  >
    {children}
  </button>
);

// 스크럼 셀 포커스 시 칸 위에 뜨는 미니 서식 툴바.
// TableBubbleMenu와 동일하게 getBoundingClientRect + fixed 로 그리드 클리핑을 피한다.
export default function ScrumCellToolbar({ editor }) {
  const [pos, setPos] = useState(null);
  const [, force] = useState(0);

  const update = useCallback(() => {
    if (!editor || !editor.isFocused) { setPos(null); return; }
    const rect = editor.view.dom.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.top });
    force((n) => n + 1); // isActive 상태 갱신용 리렌더
  }, [editor]);

  useEffect(() => {
    if (!editor) return undefined;
    const onFocus = () => update();
    const onBlur = () => setTimeout(() => { if (!editor.isFocused) setPos(null); }, 0);
    editor.on('focus', onFocus);
    editor.on('blur', onBlur);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      editor.off('focus', onFocus);
      editor.off('blur', onBlur);
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor, update]);

  if (!pos || !editor) return null;

  return (
    <div
      className="ScrumCellToolbar"
      style={{ position: 'fixed', left: `${pos.left}px`, top: `${Math.max(8, pos.top - 38)}px`, zIndex: 600 }}
    >
      <TBtn title="굵게" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} /></TBtn>
      <TBtn title="기울임" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} /></TBtn>
      <TBtn title="취소선" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={14} /></TBtn>
      <span className="ScrumCellToolbar__Sep" />
      <TBtn title="체크리스트" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={14} /></TBtn>
      <TBtn title="목록" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={14} /></TBtn>
      <TBtn
        title="링크"
        active={editor.isActive('link')}
        onClick={() => {
          const prev = editor.getAttributes('link').href || '';
          const url = window.prompt('링크 URL', prev);
          if (url === null) return;
          if (url === '') { editor.chain().focus().unsetLink().run(); return; }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}
      ><LinkIcon size={14} /></TBtn>
    </div>
  );
}
