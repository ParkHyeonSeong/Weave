import { useEffect, useRef } from 'react';
import { renderMathElement } from '@/library/mathRender';

// remark-math가 만든 수식 노드를 하이브리드(KaTeX→MathJax) 렌더.
export default function MarkdownMath({ latex, display }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) renderMathElement(ref.current, latex, { displayMode: display });
  }, [latex, display]);
  return display
    ? <div ref={ref} className="MarkdownMath MarkdownMath--block" />
    : <span ref={ref} className="MarkdownMath" />;
}
