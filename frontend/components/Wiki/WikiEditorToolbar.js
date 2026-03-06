import { useState, useRef, useEffect } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, Code,
  List, ListOrdered, ListChecks,
  Quote, Minus, CodeSquare,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Undo2, Redo2,
  AlignLeft, AlignCenter, AlignRight,
  ChevronDown, Highlighter, Palette,
  Info, AlertTriangle, CheckCircle2, XCircle,
  Type,
} from 'lucide-react';

// 프리셋 컬러 팔레트
const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999',
  '#DC2626', '#EA580C', '#D97706', '#16A34A',
  '#2563EB', '#7C3AED', '#DB2777', '#0891B2',
];

const HIGHLIGHT_COLORS = [
  { label: 'Yellow', color: '#FEF08A' },
  { label: 'Green', color: '#BBF7D0' },
  { label: 'Blue', color: '#BFDBFE' },
  { label: 'Pink', color: '#FBCFE8' },
  { label: 'Orange', color: '#FED7AA' },
  { label: 'Purple', color: '#DDD6FE' },
];

export default function WikiEditorToolbar({ editor }) {
  const [openDropdown, setOpenDropdown] = useState(null);

  if (!editor) return null;

  const toggleDropdown = (name) => {
    setOpenDropdown((prev) => (prev === name ? null : name));
  };

  const closeDropdown = () => setOpenDropdown(null);

  // 현재 헤딩 레벨 라벨
  const getHeadingLabel = () => {
    for (let i = 1; i <= 3; i++) {
      if (editor.isActive('heading', { level: i })) return `H${i}`;
    }
    return 'Text';
  };

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

  const Btn = ({ onClick, active, children, title, className = '' }) => (
    <button
      type="button"
      className={`WikiEditorToolbar__Btn ${active ? 'WikiEditorToolbar__Btn--active' : ''} ${className}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );

  const Sep = () => <div className="WikiEditorToolbar__Sep" />;

  return (
    <div className="WikiEditorToolbar">
      {/* 헤딩 드롭다운 */}
      <DropdownWrapper
        isOpen={openDropdown === 'heading'}
        onClose={closeDropdown}
      >
        <button
          type="button"
          className="WikiEditorToolbar__Dropdown"
          onClick={() => toggleDropdown('heading')}
        >
          <Type size={14} />
          <span>{getHeadingLabel()}</span>
          <ChevronDown size={12} />
        </button>
        {openDropdown === 'heading' && (
          <div className="WikiEditorToolbar__DropdownMenu">
            <button
              className={`WikiEditorToolbar__DropdownItem ${!editor.isActive('heading') ? 'WikiEditorToolbar__DropdownItem--active' : ''}`}
              onClick={() => { editor.chain().focus().setParagraph().run(); closeDropdown(); }}
            >
              <span style={{ fontSize: '14px' }}>Normal text</span>
            </button>
            {[1, 2, 3].map((level) => (
              <button
                key={level}
                className={`WikiEditorToolbar__DropdownItem ${editor.isActive('heading', { level }) ? 'WikiEditorToolbar__DropdownItem--active' : ''}`}
                onClick={() => { editor.chain().focus().toggleHeading({ level }).run(); closeDropdown(); }}
              >
                <span style={{ fontSize: `${20 - level * 2}px`, fontWeight: 700 }}>Heading {level}</span>
              </button>
            ))}
          </div>
        )}
      </DropdownWrapper>

      <Sep />

      {/* 텍스트 서식 */}
      <Btn onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')} title="Bold (Ctrl+B)">
        <Bold size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')} title="Italic (Ctrl+I)">
        <Italic size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')} title="Underline (Ctrl+U)">
        <Underline size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')} title="Strikethrough">
        <Strikethrough size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive('code')} title="Inline Code">
        <Code size={16} />
      </Btn>

      {/* 텍스트 컬러 드롭다운 */}
      <DropdownWrapper isOpen={openDropdown === 'color'} onClose={closeDropdown}>
        <Btn onClick={() => toggleDropdown('color')} title="Text Color">
          <Palette size={16} />
        </Btn>
        {openDropdown === 'color' && (
          <div className="WikiEditorToolbar__DropdownMenu WikiEditorToolbar__ColorMenu">
            <div className="WikiEditorToolbar__ColorSection">
              <span className="WikiEditorToolbar__ColorLabel">Text</span>
              <div className="WikiEditorToolbar__ColorGrid">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    className="WikiEditorToolbar__ColorSwatch"
                    style={{ backgroundColor: c }}
                    onClick={() => { editor.chain().focus().setColor(c).run(); closeDropdown(); }}
                  />
                ))}
              </div>
              <button
                className="WikiEditorToolbar__ColorReset"
                onClick={() => { editor.chain().focus().unsetColor().run(); closeDropdown(); }}
              >
                Reset color
              </button>
            </div>
            <div className="WikiEditorToolbar__ColorSection">
              <span className="WikiEditorToolbar__ColorLabel">Highlight</span>
              <div className="WikiEditorToolbar__ColorGrid">
                {HIGHLIGHT_COLORS.map((h) => (
                  <button
                    key={h.color}
                    className="WikiEditorToolbar__ColorSwatch WikiEditorToolbar__ColorSwatch--highlight"
                    style={{ backgroundColor: h.color }}
                    title={h.label}
                    onClick={() => { editor.chain().focus().toggleHighlight({ color: h.color }).run(); closeDropdown(); }}
                  />
                ))}
              </div>
              <button
                className="WikiEditorToolbar__ColorReset"
                onClick={() => { editor.chain().focus().unsetHighlight().run(); closeDropdown(); }}
              >
                Remove highlight
              </button>
            </div>
          </div>
        )}
      </DropdownWrapper>

      <Sep />

      {/* 리스트 */}
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')} title="Bullet List">
        <List size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')} title="Ordered List">
        <ListOrdered size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive('taskList')} title="Checklist">
        <ListChecks size={16} />
      </Btn>

      <Sep />

      {/* 정렬 */}
      <Btn onClick={() => editor.chain().focus().setTextAlign('left').run()}
        active={editor.isActive({ textAlign: 'left' })} title="Align Left">
        <AlignLeft size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign('center').run()}
        active={editor.isActive({ textAlign: 'center' })} title="Align Center">
        <AlignCenter size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign('right').run()}
        active={editor.isActive({ textAlign: 'right' })} title="Align Right">
        <AlignRight size={16} />
      </Btn>

      <Sep />

      {/* 삽입: 인용, 콜아웃, 코드블록, 구분선 */}
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')} title="Quote">
        <Quote size={16} />
      </Btn>

      {/* 콜아웃 패널 드롭다운 */}
      <DropdownWrapper isOpen={openDropdown === 'callout'} onClose={closeDropdown}>
        <Btn onClick={() => toggleDropdown('callout')} title="Info Panel"
          active={editor.isActive('callout')}>
          <Info size={16} />
        </Btn>
        {openDropdown === 'callout' && (
          <div className="WikiEditorToolbar__DropdownMenu">
            <button className="WikiEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('info').run(); closeDropdown(); }}>
              <Info size={14} style={{ color: '#2563EB' }} /> Info
            </button>
            <button className="WikiEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('warning').run(); closeDropdown(); }}>
              <AlertTriangle size={14} style={{ color: '#D97706' }} /> Warning
            </button>
            <button className="WikiEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('success').run(); closeDropdown(); }}>
              <CheckCircle2 size={14} style={{ color: '#16A34A' }} /> Success
            </button>
            <button className="WikiEditorToolbar__DropdownItem"
              onClick={() => { editor.chain().focus().toggleCallout('error').run(); closeDropdown(); }}>
              <XCircle size={14} style={{ color: '#DC2626' }} /> Error
            </button>
          </div>
        )}
      </DropdownWrapper>

      <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')} title="Code Block">
        <CodeSquare size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
        <Minus size={16} />
      </Btn>

      <Sep />

      {/* 링크, 이미지, 테이블 */}
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

      {/* Undo / Redo */}
      <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo">
        <Undo2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo">
        <Redo2 size={16} />
      </Btn>
    </div>
  );
}

// 드롭다운 래퍼: 외부 클릭 시 닫기
function DropdownWrapper({ isOpen, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

  return (
    <div className="WikiEditorToolbar__DropdownWrap" ref={ref}>
      {children}
    </div>
  );
}
