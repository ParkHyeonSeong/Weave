import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { common, createLowlight } from 'lowlight';
import CalloutExtension from '@/components/Canvas/extensions/CalloutExtension';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import CanvasEditorToolbar from '@/components/Canvas/CanvasEditorToolbar';

const lowlight = createLowlight(common);

const extensions = [
  StarterKit.configure({ codeBlock: false }),
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
  }),
  Placeholder.configure({ placeholder: 'Add description...' }),
  CodeBlockLowlight.configure({ lowlight }),
  Underline,
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  CalloutExtension,
  TaskRefNode,
  MentionNode,
];

export default function TaskDescriptionEditor({ content, onSave }) {
  const savedRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: content || '',
  });

  // blur 시 저장
  useEffect(() => {
    if (!editor) return;

    const handleBlur = () => {
      if (savedRef.current) return;
      savedRef.current = true;
      const html = editor.getHTML();
      const isEmpty = !html || html === '<p></p>';
      onSave(isEmpty ? null : html);
    };

    editor.on('blur', handleBlur);
    return () => editor.off('blur', handleBlur);
  }, [editor, onSave]);

  if (!editor) return null;

  return (
    <div className="TaskDescEditor">
      <CanvasEditorToolbar editor={editor} />
      <EditorContent editor={editor} className="TaskDescEditor__Content" />
    </div>
  );
}
