import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Pencil, Eye, AlertTriangle } from 'lucide-react';
import { getMermaid, nextMermaidId } from './mermaidConfig';

// Mermaid DSL 블록 노드
// - source: 원본 mermaid DSL 텍스트 (data-source 속성에 저장)
// - 렌더 시점에 mermaid.render()로 SVG 생성 (저장하지 않음)

function MermaidView({ node, updateAttributes, selected, editor }) {
  const source = node.attrs.source || '';
  const [mode, setMode] = useState('preview'); // 'preview' | 'edit'
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);
  const [draft, setDraft] = useState(source);
  const cancelledRef = useRef(false);

  // source 변경 시 SVG 재렌더
  useEffect(() => {
    cancelledRef.current = false;
    setRendering(true);
    setError('');

    (async () => {
      try {
        if (!source.trim()) {
          if (cancelledRef.current) return;
          setSvg('');
          setRendering(false);
          return;
        }
        const mermaid = await getMermaid();
        // mermaid v10+: parse로 사전 검증
        const valid = await mermaid.parse(source, { suppressErrors: true });
        if (valid === false) {
          if (cancelledRef.current) return;
          setError('Invalid Mermaid syntax');
          setSvg('');
          setRendering(false);
          return;
        }
        const { svg: rendered } = await mermaid.render(nextMermaidId(), source);
        if (cancelledRef.current) return;
        setSvg(rendered);
        setRendering(false);
      } catch (e) {
        if (cancelledRef.current) return;
        setError(e?.message || String(e));
        setSvg('');
        setRendering(false);
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [source]);

  // edit 모드 진입 시 draft를 현재 source로 리셋
  useEffect(() => {
    if (mode === 'edit') setDraft(source);
  }, [mode, source]);

  const isReadonly = !editor?.isEditable;

  const saveAndPreview = useCallback(() => {
    if (draft !== source) {
      updateAttributes({ source: draft });
    }
    setMode('preview');
  }, [draft, source, updateAttributes]);

  const cancelEdit = useCallback(() => {
    setDraft(source);
    setMode('preview');
  }, [source]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveAndPreview();
    }
  };

  return (
    <NodeViewWrapper
      className={`mermaid-block ${selected ? 'mermaid-block--selected' : ''}`}
    >
      <div contentEditable={false}>
        {/* 툴바: 선택되었거나 편집 모드일 때만 노출 */}
        {!isReadonly && (selected || mode === 'edit') && (
          <div className="mermaid-block__toolbar">
            {mode === 'preview' ? (
              <button
                type="button"
                className="mermaid-block__toolbarBtn"
                onClick={() => setMode('edit')}
                title="Edit diagram"
              >
                <Pencil size={12} />
                <span>Edit</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="mermaid-block__toolbarBtn"
                  onClick={saveAndPreview}
                  title="Preview (Cmd/Ctrl + Enter)"
                >
                  <Eye size={12} />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  className="mermaid-block__toolbarBtn mermaid-block__toolbarBtn--secondary"
                  onClick={cancelEdit}
                  title="Cancel (Esc)"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        )}

        {mode === 'edit' ? (
          <textarea
            className="mermaid-block__editor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoFocus
            placeholder="graph TD&#10;  A[Start] --> B[End]"
          />
        ) : error ? (
          <div className="mermaid-block__error">
            <div className="mermaid-block__errorHeader">
              <AlertTriangle size={14} />
              <span>Mermaid render error</span>
            </div>
            <pre className="mermaid-block__errorMsg">{error}</pre>
            <pre className="mermaid-block__errorSource">{source}</pre>
          </div>
        ) : rendering ? (
          <div className="mermaid-block__loading">Rendering diagram...</div>
        ) : svg ? (
          <div
            className="mermaid-block__svg"
            // mermaid는 securityLevel:'strict'에서 출력 SVG를 자체 DOMPurify로 정화한다(mermaidConfig).
            // 별도 sanitizeSvg를 덧씌우면 라벨용 foreignObject(HTML)가 제거돼 다이어그램이 깨지므로 적용하지 않는다.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="mermaid-block__empty">Empty diagram. Click Edit to add content.</div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

const MermaidExtension = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      source: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-source') || '',
        renderHTML: (attrs) => {
          if (!attrs.source) return { 'data-source': '' };
          return { 'data-source': attrs.source };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-mermaid]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-mermaid': 'true',
        class: 'mermaid-block',
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },

  addCommands() {
    return {
      insertMermaid:
        (source = 'graph TD\n  A[Start] --> B[End]') =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { source },
          });
        },
    };
  },
});

export default MermaidExtension;
