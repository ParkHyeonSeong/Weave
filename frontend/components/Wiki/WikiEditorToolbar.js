import {
  Bold, Italic, Strikethrough, Code, List, ListOrdered,
  Quote, Minus, Heading1, Heading2, Heading3,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Undo2, Redo2, CodeSquare,
} from 'lucide-react';

export default function WikiEditorToolbar({ editor }) {
  if (!editor) return null;

  const addLink = () => {
    const url = window.prompt('URL:');
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  const addImage = () => {
    const url = window.prompt('Image URL:');
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  const addTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const Btn = ({ onClick, active, children, title }) => (
    <button
      type="button"
      className={`WikiEditorToolbar__Btn ${active ? 'WikiEditorToolbar__Btn--active' : ''}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );

  const Sep = () => <div className="WikiEditorToolbar__Sep" />;

  return (
    <div className="WikiEditorToolbar">
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })} title="Heading 1">
        <Heading1 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })} title="Heading 2">
        <Heading2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })} title="Heading 3">
        <Heading3 size={16} />
      </Btn>

      <Sep />

      <Btn onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')} title="Bold">
        <Bold size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')} title="Italic">
        <Italic size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')} title="Strikethrough">
        <Strikethrough size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive('code')} title="Inline Code">
        <Code size={16} />
      </Btn>

      <Sep />

      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')} title="Bullet List">
        <List size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')} title="Ordered List">
        <ListOrdered size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')} title="Quote">
        <Quote size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')} title="Code Block">
        <CodeSquare size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Divider">
        <Minus size={16} />
      </Btn>

      <Sep />

      <Btn onClick={addLink} active={editor.isActive('link')} title="Link">
        <LinkIcon size={16} />
      </Btn>
      <Btn onClick={addImage} title="Image">
        <ImageIcon size={16} />
      </Btn>
      <Btn onClick={addTable} title="Table">
        <TableIcon size={16} />
      </Btn>

      <Sep />

      <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo">
        <Undo2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo">
        <Redo2 size={16} />
      </Btn>
    </div>
  );
}
