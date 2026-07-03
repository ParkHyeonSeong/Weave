import { useEffect, useRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Highlight from '@tiptap/extension-highlight';
import { checklistExtensions } from '@/components/Canvas/extensions/checklistExtension';
import { common, createLowlight } from 'lowlight';
import CalloutExtension from '@/components/Canvas/extensions/CalloutExtension';
import TaskRefNode, { taskRefPluginKey } from '@/components/Canvas/extensions/TaskRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import SlashCommandsExtension, { slashCommandPluginKey } from '@/components/Canvas/extensions/SlashCommandsExtension';
import { ResizableImage } from '@/components/Canvas/extensions/ResizableImageExtension';
import { createImageUploadPlugin } from '@/components/Canvas/extensions/ImageUploadPlugin';
import { createMarkdownPastePlugin } from '@/components/Canvas/extensions/MarkdownPastePlugin';
import { BookmarkPasteExtension } from '@/components/Canvas/extensions/BookmarkPastePlugin';
import MermaidExtension from '@/components/Canvas/extensions/MermaidExtension';
import { mathExtensions, mathEditPluginKey } from '@/components/Canvas/extensions/mathExtensions';
import CanvasEditorToolbar from '@/components/Canvas/CanvasEditorToolbar';
import { useEditorRefHydration } from '@/library/refHydration';

const lowlight = createLowlight(common);

const baseExtensions = [
  StarterKit.configure({
    codeBlock: false,
    link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
  }),
  Placeholder.configure({ placeholder: 'Add description...' }),
  CodeBlockLowlight.configure({ lowlight }),
  Highlight.configure({ multicolor: true }),
  ...checklistExtensions({ nested: true }),
  CalloutExtension,
  TaskRefNode,
  SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/m'] }),
  ResizableImage,
  MermaidExtension,
  ...mathExtensions(),
];

export default function TaskDescriptionEditor({ content, onSave, branchId }) {
  const savedRef = useRef(false);

  const extensions = useMemo(() => {
    const ext = [...baseExtensions];
    ext.push(MentionNode.configure({ branchId }));
    ext.push(BookmarkPasteExtension);
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

  // 칩 하이드레이션: 마운트 직후 + 탭 내 태스크 변경 시
  useEditorRefHydration(editor);

  // blur 시 저장
  useEffect(() => {
    if (!editor) return;

    const handleBlur = () => {
      // 슬래시 메뉴/ref 검색 팝업이 열려 있는 동안의 blur는 팝업 input으로의
      // 포커스 이동이다 — 저장/종료 트리거가 아님. 팝업이 닫히면 에디터로
      // 포커스가 돌아오고, 이후의 진짜 blur에서 저장된다.
      const st = editor.state;
      if (
        taskRefPluginKey.getState(st)?.active ||
        slashCommandPluginKey.getState(st)?.active ||
        mathEditPluginKey.getState(st)?.active
      ) return;
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

  // 외부 클릭으로 팝업이 dismiss되면 포커스가 에디터로 돌아오지 않아 blur 저장이
  // 영영 안 일어난다. 팝업 활성→비활성 전환을 감지해, 한 틱 뒤에도 에디터가
  // 포커스를 못 받았으면(=Esc/칩 선택이 아닌 dismiss) 바깥 클릭과 동일하게 저장한다.
  useEffect(() => {
    if (!editor) return;
    let wasRefActive = false;
    const handleTransaction = ({ editor: ed }) => {
      const st = ed.state;
      const refActive =
        taskRefPluginKey.getState(st)?.active ||
        slashCommandPluginKey.getState(st)?.active ||
        mathEditPluginKey.getState(st)?.active;
      if (wasRefActive && !refActive) {
        setTimeout(() => {
          if (editor.isDestroyed || editor.isFocused || savedRef.current) return;
          savedRef.current = true;
          onSave(editor.isEmpty ? null : editor.getHTML());
        }, 0);
      }
      wasRefActive = !!refActive;
    };
    editor.on('transaction', handleTransaction);
    return () => editor.off('transaction', handleTransaction);
  }, [editor, onSave]);

  if (!editor) return null;

  return (
    <div className="TaskDescEditor">
      <CanvasEditorToolbar editor={editor} />
      <EditorContent editor={editor} className="TaskDescEditor__Content" />
    </div>
  );
}
