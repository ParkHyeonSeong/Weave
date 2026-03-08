import { useEffect, useImperativeHandle, forwardRef } from 'react';
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

const makeExtensions = (placeholder) => [
  StarterKit.configure({ codeBlock: false }),
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
  }),
  Placeholder.configure({ placeholder: placeholder || 'Write something...' }),
  CodeBlockLowlight.configure({ lowlight }),
  Underline,
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  CalloutExtension,
  TaskRefNode,
  MentionNode,
];

const IssueEditor = forwardRef(({ content, placeholder, minHeight = 150 }, ref) => {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: makeExtensions(placeholder),
    content: content || '',
  });

  useImperativeHandle(ref, () => ({
    getHTML: () => editor?.getHTML() || '',
    isEmpty: () => {
      const html = editor?.getHTML() || '';
      return !html || html === '<p></p>';
    },
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
