import { useEffect, useRef } from 'react';

// CodeMirror 동적 로드 (TypstEditor.js:8-21과 동일 패턴 — 번들 분리)
let cmModulesPromise = null;
function loadCmModules() {
  if (cmModulesPromise) return cmModulesPromise;
  cmModulesPromise = Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/lang-markdown'),
  ]).then(([state, view, commands, markdown]) => ({ state, view, commands, markdown }));
  return cmModulesPromise;
}

/**
 * raw markdown 소스 편집기 — 비협업 표면 전용(Yjs 없음).
 * value는 마운트 시 초기값으로만 쓰는 uncontrolled. 세션 교체는 부모가 key 리마운트로.
 * 미니멀 셋: 문서형 소스라 lineNumbers/gutter/foldGutter 없음.
 * (bracketMatching은 TypstEditor.js:103-108의 한글 IME 이슈 전례에 따라 여기서도 제외)
 */
export default function RawMarkdownEditor({ value, onChange, onBlur, placeholder }) {
  const hostRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onBlurRef.current = onBlur; }, [onBlur]);
  const initialValueRef = useRef(value);

  useEffect(() => {
    let destroyed = false;
    let view = null;
    (async () => {
      const { state, view: cmView, commands, markdown } = await loadCmModules();
      if (destroyed || !hostRef.current) return;
      const extensions = [
        cmView.highlightSpecialChars(),
        cmView.drawSelection(),
        cmView.dropCursor(),
        commands.history(),
        // 주의: defaultKeymap에는 Mod-Enter(빈 줄 삽입)가 있다 — 제출 단축키가 필요한
        // 표면(CommentEditor)은 조상에서 캡처 단계로 가로챈다.
        cmView.keymap.of([...commands.defaultKeymap, ...commands.historyKeymap]),
        markdown.markdown(),
        cmView.EditorView.lineWrapping,
        cmView.placeholder(placeholder || ''),
        cmView.EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
        cmView.EditorView.domEventHandlers({
          blur: () => { onBlurRef.current?.(); },
        }),
      ];
      view = new cmView.EditorView({
        state: state.EditorState.create({ doc: initialValueRef.current || '', extensions }),
        parent: hostRef.current,
      });
    })();
    return () => { destroyed = true; if (view) view.destroy(); };
    // 마운트 1회 — 세션 교체는 부모의 key 리마운트로
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="RawMarkdownEditor" ref={hostRef} />;
}
