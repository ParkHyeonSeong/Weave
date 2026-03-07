import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState, useCallback, useRef } from 'react';

const ALIGN_STYLE = {
  left: { justifyContent: 'flex-start' },
  center: { justifyContent: 'center' },
  right: { justifyContent: 'flex-end' },
};

function ResizableImageView({ node, updateAttributes, selected }) {
  const { src, alt, title, width, textAlign } = node.attrs;
  const [resizing, setResizing] = useState(false);
  const imgRef = useRef(null);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing(true);
    startX.current = e.clientX;
    startW.current = imgRef.current?.offsetWidth || 300;

    const onMouseMove = (ev) => {
      const diff = ev.clientX - startX.current;
      const newWidth = Math.max(50, startW.current + diff);
      updateAttributes({ width: newWidth });
    };

    const onMouseUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [updateAttributes]);

  const wrapStyle = {
    display: 'flex',
    ...(ALIGN_STYLE[textAlign] || {}),
  };

  return (
    <NodeViewWrapper className="ResizableImage" style={wrapStyle}>
      <div
        className={`ResizableImage__Wrap ${selected ? 'ResizableImage__Wrap--selected' : ''} ${resizing ? 'ResizableImage__Wrap--resizing' : ''}`}
        style={{ width: width ? `${width}px` : undefined, maxWidth: '100%', position: 'relative', display: 'inline-block' }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || ''}
          title={title || ''}
          style={{ width: '100%', display: 'block' }}
          draggable={false}
        />
        {selected && (
          <>
            <div className="ResizableImage__Handle ResizableImage__Handle--right" onMouseDown={onMouseDown} />
            <div className="ResizableImage__Handle ResizableImage__Handle--bottomRight" onMouseDown={onMouseDown} />
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.getAttribute('width') || el.style.width;
          return w ? parseInt(w, 10) || null : null;
        },
        renderHTML: (attrs) => {
          if (!attrs.width) return {};
          return { width: attrs.width, style: `width: ${attrs.width}px` };
        },
      },
      textAlign: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-text-align') || null,
        renderHTML: (attrs) => {
          if (!attrs.textAlign) return {};
          return { 'data-text-align': attrs.textAlign };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
