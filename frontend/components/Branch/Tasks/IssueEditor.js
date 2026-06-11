import { useImperativeHandle, forwardRef, useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { common, createLowlight } from 'lowlight';
import CalloutExtension from '@/components/Canvas/extensions/CalloutExtension';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import SlashCommandsExtension from '@/components/Canvas/extensions/SlashCommandsExtension';
import { ResizableImage } from '@/components/Canvas/extensions/ResizableImageExtension';
import { createImageUploadPlugin } from '@/components/Canvas/extensions/ImageUploadPlugin';
import { createMarkdownPastePlugin } from '@/components/Canvas/extensions/MarkdownPastePlugin';
import MermaidExtension from '@/components/Canvas/extensions/MermaidExtension';
import CanvasEditorToolbar from '@/components/Canvas/CanvasEditorToolbar';
import { hydrateEditor } from '@/library/refHydration';

const lowlight = createLowlight(common);

const makeBaseExtensions = (placeholder) => [
  StarterKit.configure({
    codeBlock: false,
    link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
  }),
  Placeholder.configure({ placeholder: placeholder || 'Write something...' }),
  CodeBlockLowlight.configure({ lowlight }),
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  CalloutExtension,
  TaskRefNode,
  MentionNode,
  SlashCommandsExtension.configure({ enabled: ['/t', '/ta'] }),
  ResizableImage,
  MermaidExtension,
];

const IssueEditor = forwardRef(({ content, placeholder, minHeight = 150, branchId }, ref) => {
  const extensions = useMemo(() => {
    const ext = makeBaseExtensions(placeholder);
    ext.push(
      Extension.create({
        name: 'markdownPaste',
        addProseMirrorPlugins() {
          return [createMarkdownPastePlugin()];
        },
      })
    );
    if (branchId) {
      ext.push(
        Extension.create({
          name: 'imageUpload',
          addProseMirrorPlugins() {
            return [createImageUploadPlugin({ branchId })];
          },
        })
      );
    }
    return ext;
  }, [placeholder, branchId]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: content || '',
  });

  // 칩 하이드레이션: 마운트 직후 + 탭 내 태스크 변경 시
  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(() => hydrateEditor(editor), 1000);
    const refresh = () => hydrateEditor(editor);
    window.addEventListener('task:updated', refresh);
    window.addEventListener('issue:updated', refresh);
    return () => {
      clearTimeout(t);
      window.removeEventListener('task:updated', refresh);
      window.removeEventListener('issue:updated', refresh);
    };
  }, [editor]);

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
