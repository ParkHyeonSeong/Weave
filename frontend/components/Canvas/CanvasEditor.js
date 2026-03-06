import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Mathematics from '@tiptap/extension-mathematics';
import { common, createLowlight } from 'lowlight';
import CalloutExtension from './extensions/CalloutExtension';
import TaskRefNode from './extensions/TaskRefExtension';
import { createImageUploadPlugin } from './extensions/ImageUploadPlugin';
import CanvasEditorToolbar from './CanvasEditorToolbar';

const lowlight = createLowlight(common);
const MAX_PLAIN_TEXT_LENGTH = 60000;

export default function CanvasEditor({ content, onChange, canvasId }) {
  const [charCount, setCharCount] = useState(0);
  const isOverLimit = charCount > MAX_PLAIN_TEXT_LENGTH;

  // 이미지 붙여넣기/드래그 플러그인
  const ImageUpload = canvasId
    ? Extension.create({
        name: 'imageUpload',
        addProseMirrorPlugins() {
          return [createImageUploadPlugin(canvasId)];
        },
      })
    : null;

  const extensions = [
    StarterKit.configure({
      codeBlock: false, // CodeBlockLowlight로 대체
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    Image,
    Placeholder.configure({
      placeholder: 'Start writing...',
    }),
    CodeBlockLowlight.configure({ lowlight }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    Underline,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    Highlight.configure({
      multicolor: true,
    }),
    TextStyle,
    Color,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    CalloutExtension,
    TaskRefNode,
    Mathematics.configure({
      katexOptions: { throwOnError: false },
    }),
    ...(ImageUpload ? [ImageUpload] : []),
  ];

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: content || '',
    onUpdate: ({ editor }) => {
      setCharCount(editor.getText().length);
      onChange(editor.getHTML());
    },
  });

  if (!editor) return null;

  return (
    <div className="CanvasEditor">
      <CanvasEditorToolbar editor={editor} />
      <EditorContent editor={editor} className="CanvasEditor__Content" />
      <div className={`CanvasEditor__Counter ${isOverLimit ? 'CanvasEditor__Counter--over' : ''}`}>
        {charCount.toLocaleString()} / {MAX_PLAIN_TEXT_LENGTH.toLocaleString()}
      </div>
    </div>
  );
}
