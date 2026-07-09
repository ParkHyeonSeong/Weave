import { useImperativeHandle, forwardRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import CanvasEditorToolbar from '@/components/Canvas/CanvasEditorToolbar';
import { useEditorRefHydration } from '@/library/refHydration';
import { buildIssueEditorExtensions } from './issueEditorExtensions';
import { buildMarkdownExtensions } from '@/library/markdownCodec';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';

const IssueEditor = forwardRef(({ content, placeholder, minHeight = 150, branchId, onChange }, ref) => {
  const extensions = useMemo(
    () => buildMarkdownExtensions([...buildIssueEditorExtensions({ placeholder, branchId }), MarkdownClipboardExtension]),
    [placeholder, branchId]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: content || '',
    onUpdate: ({ editor }) => onChange?.(editor.isEmpty),
  });

  // 칩 하이드레이션: 마운트 직후 + 탭 내 태스크 변경 시
  useEditorRefHydration(editor);

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() || '',
    isEmpty: () => editor?.isEmpty ?? true,
    clearContent: () => editor?.commands.clearContent(),
    focus: () => editor?.commands.focus(),
  }), [editor]);

  if (!editor) return null;

  return (
    <div className="TaskDescEditor">
      <CanvasEditorToolbar editor={editor} />
      <EditorContent
        editor={editor}
        className="TaskDescEditor__Content"
        style={{ minHeight }}
      />
    </div>
  );
});

IssueEditor.displayName = 'IssueEditor';
export default IssueEditor;
