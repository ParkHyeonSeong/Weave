import { useEffect, useRef } from 'react';
import { useTheme } from '@/library/theme';
import { createThemeBinding } from '@/library/editorTheme';

// CodeMirror 동적 로드 (TypstEditor.js:8-21과 동일 패턴 — 번들 분리)
let cmModulesPromise = null;
function loadCmModules() {
  if (cmModulesPromise) return cmModulesPromise;
  cmModulesPromise = Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/lang-markdown'),
    import('@codemirror/theme-one-dark'),
  ]).then(([state, view, commands, markdown, oneDark]) => ({ state, view, commands, markdown, oneDark }));
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

  // 생성 effect deps는 []로 유지한다(resolved를 넣으면 initialValueRef uncontrolled
  // 설계가 깨져 테마 토글마다 편집 내용이 초기값으로 리셋된다).
  const { resolved } = useTheme();
  const resolvedRef = useRef(resolved);
  const themeBindingRef = useRef(null);
  const viewRef = useRef(null);       // 테마 재구성용

  useEffect(() => {
    let destroyed = false;
    let view = null;
    (async () => {
      const { state, view: cmView, commands, markdown, oneDark } = await loadCmModules();
      if (destroyed || !hostRef.current) return;

      themeBindingRef.current = createThemeBinding({
        Compartment: state.Compartment,
        getResolved: () => resolvedRef.current,
        getOneDark: () => oneDark,
        variant: 'chrome',   // 라이트에 syntaxHighlighting이 없다 → 'full'은 다크만 구문색이 생겨 비대칭
      });
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
        // 여기서는 extensions 배열이 new EditorView 바로 앞에서 만들어지므로
        // 배열 안에서 initial()을 불러도 안전하다(TypstEditor와 다른 점).
        themeBindingRef.current.initial(),
      ];
      view = new cmView.EditorView({
        state: state.EditorState.create({ doc: initialValueRef.current || '', extensions }),
        parent: hostRef.current,
      });
      viewRef.current = view;
    })();
    return () => {
      destroyed = true;
      if (view) view.destroy();
      viewRef.current = null;
      themeBindingRef.current = null;
    };
    // 마운트 1회 — 세션 교체는 부모의 key 리마운트로
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 테마 변경 — 뷰 재생성 없이 확장만 교체한다.
  useEffect(() => {
    resolvedRef.current = resolved;
    const view = viewRef.current;
    const binding = themeBindingRef.current;
    if (!view || !binding) return;
    view.dispatch({ effects: binding.reconfigure() });
  }, [resolved]);

  return <div className="RawMarkdownEditor" ref={hostRef} />;
}
