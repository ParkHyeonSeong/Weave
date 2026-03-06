import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
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
import TextStyle from '@tiptap/extension-text-style';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { common, createLowlight } from 'lowlight';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Link as LinkIcon, Highlighter,
} from 'lucide-react';
import CalloutExtension from './extensions/CalloutExtension';
import WikiEditorToolbar from './WikiEditorToolbar';

const lowlight = createLowlight(common);

export default function WikiEditor({ content, onChange }) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
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
    ],
    content: content || '',
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  if (!editor) return null;

  return (
    <div className="WikiEditor">
      <WikiEditorToolbar editor={editor} />
      <EditorContent editor={editor} className="WikiEditor__Content" />

      {/* 텍스트 선택 시 플로팅 툴바 */}
      <BubbleMenu editor={editor} tippyOptions={{ duration: 150 }} className="WikiEditor__BubbleMenu">
        <button
          type="button"
          className={`BubbleMenu__Btn ${editor.isActive('bold') ? 'BubbleMenu__Btn--active' : ''}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={14} />
        </button>
        <button
          type="button"
          className={`BubbleMenu__Btn ${editor.isActive('italic') ? 'BubbleMenu__Btn--active' : ''}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={14} />
        </button>
        <button
          type="button"
          className={`BubbleMenu__Btn ${editor.isActive('underline') ? 'BubbleMenu__Btn--active' : ''}`}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon size={14} />
        </button>
        <button
          type="button"
          className={`BubbleMenu__Btn ${editor.isActive('strike') ? 'BubbleMenu__Btn--active' : ''}`}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={14} />
        </button>
        <button
          type="button"
          className={`BubbleMenu__Btn ${editor.isActive('link') ? 'BubbleMenu__Btn--active' : ''}`}
          onClick={() => {
            const url = window.prompt('URL:');
            if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
          }}
        >
          <LinkIcon size={14} />
        </button>
        <button
          type="button"
          className={`BubbleMenu__Btn ${editor.isActive('highlight') ? 'BubbleMenu__Btn--active' : ''}`}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <Highlighter size={14} />
        </button>
      </BubbleMenu>
    </div>
  );
}
