import { useEffect, useRef, useMemo } from 'react';
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

const lowlight = createLowlight(common);

const baseExtensions = [
  StarterKit.configure({
    codeBlock: false,
    link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
  }),
  Placeholder.configure({ placeholder: 'Add description...' }),
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

export default function TaskDescriptionEditor({ content, onSave, branchId }) {
  const savedRef = useRef(false);

  const extensions = useMemo(() => {
    const ext = [...baseExtensions];
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
  }, [branchId]);

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
      if (editor.isEmpty) {
        onSave(null);
      } else {
        onSave(editor.getHTML());
      }
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
