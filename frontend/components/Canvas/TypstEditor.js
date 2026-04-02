import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, AlertTriangle, Loader } from 'lucide-react';
import { compileToSvg, downloadPdf } from '@/library/typstCompiler';
import { sanitizeHtml } from '@/library/sanitize';
import { yCollab, patchYSync } from '@/library/yCollabPatched';

// CodeMirror + Yjs (동적 로드)
let cmModulesPromise = null;
function loadCmModules() {
  if (cmModulesPromise) return cmModulesPromise;
  cmModulesPromise = Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/language'),
    import('@codemirror/lang-markdown'),
  ]).then(([state, view, commands, lang, markdown]) => ({
    state, view, commands, lang, markdown,
  }));
  return cmModulesPromise;
}

export default function TypstEditor(props) {
  if (!props.ydoc || !props.provider) return null;
  return <TypstEditorInner {...props} />;
}

function TypstEditorInner({
  ydoc,
  provider,
  initialContent,
  hasExistingYjsState,
  onContentChange,
  pageTitle,
}) {
  const editorRef = useRef(null);
  const editorViewRef = useRef(null);
  const previewRef = useRef(null);

  const [svgContent, setSvgContent] = useState(null);
  const [compileErrors, setCompileErrors] = useState([]);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const compileTimerRef = useRef(null);
  const lastSourceRef = useRef('');

  // SourceDiagnostic 문자열에서 사용자 친화적 메시지 추출
  const parseTypstError = (raw) => {
    const match = raw.match(/message:\s*"([^"]+)"/);
    return match ? match[1] : raw;
  };

  // Typst 소스 컴파일 (디바운스)
  const compileSource = useCallback(async (source) => {
    if (!source.trim()) {
      setSvgContent(null);
      setCompileErrors([]);
      return;
    }
    setIsCompiling(true);
    const { svg, errors } = await compileToSvg(source);
    setIsCompiling(false);
    setIsWasmReady(true);
    if (svg) {
      setSvgContent(svg);
      setCompileErrors([]);
    } else {
      setSvgContent(null);
      setCompileErrors(errors.map(parseTypstError));
    }
  }, []);

  const scheduleCompile = useCallback((source) => {
    lastSourceRef.current = source;
    if (compileTimerRef.current) clearTimeout(compileTimerRef.current);
    compileTimerRef.current = setTimeout(() => compileSource(source), 500);
  }, [compileSource]);

  // CodeMirror 초기화
  useEffect(() => {
    if (!editorRef.current || !ydoc || !provider) return;

    let view = null;
    let destroyed = false;

    (async () => {
      const { state, view: cmView, commands, lang, markdown } = await loadCmModules();
      if (destroyed) return;

      const ytext = ydoc.getText('typst');

      const extensions = [
        cmView.lineNumbers(),
        cmView.highlightActiveLine(),
        cmView.highlightSpecialChars(),
        cmView.drawSelection(),
        cmView.dropCursor(),
        cmView.rectangularSelection(),
        cmView.crosshairCursor(),
        lang.indentOnInput(),
        lang.bracketMatching(),
        lang.foldGutter(),
        lang.syntaxHighlighting(lang.defaultHighlightStyle, { fallback: true }),
        state.EditorState.allowMultipleSelections.of(true),
        cmView.keymap.of([
          ...commands.defaultKeymap,
          ...commands.historyKeymap,
        ]),
        commands.history(),
        markdown.markdown(),
        // Yjs 바인딩
        yCollab(ytext, provider.awareness),
        // 내용 변경 시 콜백
        cmView.EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const source = update.state.doc.toString();
            scheduleCompile(source);
            if (onContentChange) onContentChange(source);
          }
        }),
        // 기본 스타일
        cmView.EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'monospace' },
          '.cm-content': { padding: '16px 0' },
          '.cm-gutters': { minWidth: '40px' },
        }),
      ];

      // sync 완료 후 에디터 생성 (ytext에 초기 콘텐츠가 있어야 동기화 정상 작동)
      const createEditor = () => {
        if (destroyed) return;

        // sync 후에도 ytext가 비어있으면 DB의 content 삽입
        if (ytext.length === 0 && initialContent) {
          ytext.insert(0, initialContent);
        }

        view = new cmView.EditorView({
          state: state.EditorState.create({
            doc: ytext.toString(),
            extensions,
          }),
          parent: editorRef.current,
        });

        // 한글 IME composition 중 ySync dispatch 충돌 방지 패치
        patchYSync(view, ytext);

        editorViewRef.current = view;

        // 초기 컴파일
        const initSource = ytext.toString();
        if (initSource.trim()) {
          scheduleCompile(initSource);
        }
      };

      if (provider.synced) {
        createEditor();
      } else {
        provider.once('sync', createEditor);
      }
    })();

    return () => {
      destroyed = true;
      if (compileTimerRef.current) clearTimeout(compileTimerRef.current);
      if (view) view.destroy();
      editorViewRef.current = null;
    };
  }, [ydoc, provider]);

  // PDF 내보내기
  const handleExportPdf = async () => {
    const source = lastSourceRef.current || editorViewRef.current?.state.doc.toString() || '';
    if (!source.trim()) return;
    setIsExporting(true);
    try {
      const filename = (pageTitle || 'document').replace(/[^a-zA-Z0-9가-힣\s_-]/g, '') + '.pdf';
      await downloadPdf(source, filename);
    } catch (err) {
      setCompileErrors([err.message || 'PDF export failed']);
    }
    setIsExporting(false);
  };

  return (
    <div className="TypstEditor">
      {/* 툴바 */}
      <div className="TypstEditor__Toolbar">
        <div className="TypstEditor__ToolbarLeft">
          <span className="TypstEditor__Label">Typst Editor</span>
          {isCompiling && (
            <span className="TypstEditor__Compiling">
              <Loader size={13} className="TypstEditor__Spin" />
              Compiling...
            </span>
          )}
        </div>
        <div className="TypstEditor__ToolbarRight">
          <button
            className="TypstEditor__ExportBtn"
            onClick={handleExportPdf}
            disabled={isExporting || !lastSourceRef.current?.trim()}
            title="Download PDF"
          >
            {isExporting ? <Loader size={14} className="TypstEditor__Spin" /> : <Download size={14} />}
            PDF
          </button>
        </div>
      </div>

      {/* Split View */}
      <div className="TypstEditor__Split">
        {/* 코드 에디터 */}
        <div className="TypstEditor__Code" ref={editorRef} />

        {/* 미리보기 */}
        <div className="TypstEditor__Preview" ref={previewRef}>
          {compileErrors.length > 0 && (
            <div className="TypstEditor__Error">
              <AlertTriangle size={14} />
              <div className="TypstEditor__ErrorList">
                {compileErrors.map((err, i) => (
                  <pre key={i}>{err}</pre>
                ))}
              </div>
            </div>
          )}
          {svgContent ? (
            <div
              className="TypstEditor__Page"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(svgContent) }}
            />
          ) : !compileErrors.length && (
            <div className="TypstEditor__Empty">
              {!isWasmReady ? (
                <>
                  <Loader size={20} className="TypstEditor__Spin" />
                  <span>Loading Typst compiler...</span>
                </>
              ) : (
                <span>Start typing to see preview</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
