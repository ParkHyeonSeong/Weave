import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { useEditorRefHydration } from '@/library/refHydration';
import { buildCommentEditorExtensions } from './commentEditorExtensions';

/**
 * Lightweight TipTap editor for task comments.
 *
 * Props:
 *   - initialContent: string (HTML)
 *   - placeholder: string
 *   - branchId: number (enables image upload)
 *   - autoFocus: bool
 *   - onSubmit(html): called on Cmd/Ctrl+Enter; receives current HTML
 *   - onCancel(): called on Esc
 */
export default function CommentEditor({
  initialContent = '',
  placeholder = 'Add a comment...',
  branchId,
  autoFocus = false,
  onSubmit,
  onCancel,
}) {
  // keep latest callbacks in refs so the editor's keydown handler always sees current values
  const submitRef = useRef(onSubmit);
  const cancelRef = useRef(onCancel);
  const editorRef = useRef(null);
  // 제출 중 가드: keydown 연타는 리렌더보다 빠르므로 ref가 진실원천, state는 표시용
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);

  const extensions = useMemo(
    () => buildCommentEditorExtensions({ placeholder, branchId }),
    [placeholder, branchId]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: initialContent,
    autofocus: autoFocus,
    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const ed = editorRef.current;
          if (submittingRef.current || !ed || ed.isEmpty) return true;
          submittingRef.current = true;
          setSubmitting(true);
          ed.setEditable(false);
          const finish = () => {
            submittingRef.current = false;
            // 성공 시 부모가 remount/close로 에디터를 unmount함 → destroyed면 no-op
            if (!ed.isDestroyed) {
              ed.setEditable(true);
              setSubmitting(false);
            }
          };
          try {
            Promise.resolve(submitRef.current?.(ed.getHTML())).finally(finish);
          } catch {
            // onSubmit이 동기 throw해도 가드가 잠기지 않게 즉시 복구
            finish();
          }
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!submittingRef.current) cancelRef.current?.();
          return true;
        }
        return false;
      },
    },
  }, [extensions]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // 칩 하이드레이션: 마운트 직후 + 탭 내 태스크 변경 시
  useEditorRefHydration(editor);

  if (!editor) return null;
  return (
    <div className={`CommentEditor${submitting ? ' CommentEditor--submitting' : ''}`}>
      <EditorContent editor={editor} />
      <div className="CommentEditor__Hint">
        {submitting ? '등록 중…' : 'Cmd/Ctrl+Enter to submit · Esc to cancel'}
      </div>
    </div>
  );
}
