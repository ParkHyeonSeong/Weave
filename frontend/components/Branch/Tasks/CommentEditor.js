import { useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import { ResizableImage } from '@/components/Canvas/extensions/ResizableImageExtension';
import { createImageUploadPlugin } from '@/components/Canvas/extensions/ImageUploadPlugin';

const lowlight = createLowlight(common);

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
  useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);
  useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);

  const extensions = useMemo(() => {
    const ext = [
      StarterKit.configure({ codeBlock: false }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder }),
      CodeBlockLowlight.configure({ lowlight }),
      MentionNode,
      TaskRefNode,
      ResizableImage,
    ];
    if (branchId) {
      ext.push(
        Extension.create({
          name: 'imageUpload',
          addProseMirrorPlugins() {
            return [createImageUploadPlugin({ branchId })];
          },
        }),
      );
    }
    return ext;
  }, [placeholder, branchId]);

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
          if (ed && !ed.isEmpty) {
            submitRef.current?.(ed.getHTML());
          }
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelRef.current?.();
          return true;
        }
        return false;
      },
    },
  }, [extensions]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  if (!editor) return null;
  return (
    <div className="CommentEditor">
      <EditorContent editor={editor} />
      <div className="CommentEditor__Hint">Cmd/Ctrl+Enter to submit · Esc to cancel</div>
    </div>
  );
}
