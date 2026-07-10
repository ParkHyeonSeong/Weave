import { useState, useEffect, useCallback, useRef } from 'react';
import { docToMarkdown, markdownToEditorHtml, findUnsupportedFormatting } from '@/library/markdownCodec';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { hydrateEditor } from '@/library/refHydration';

// findUnsupportedFormatting 키 → 사용자 표시 라벨 (모르는 키는 키 그대로 노출)
const UNSUPPORTED_LABELS = {
  underline: '밑줄',
  color: '글자색',
  highlightColor: '형광펜 색',
  textAlign: '정렬',
  imageWidth: '이미지 크기',
  cellBackground: '셀 배경',
};

// 손실 경고 배지 문구. 경고 없으면 null.
export function formatUnsupportedWarning(keys) {
  if (!keys || keys.length === 0) return null;
  const labels = keys.map((k) => UNSUPPORTED_LABELS[k] || k);
  return `일부 서식(${labels.join(', ')})은 markdown으로 표현되지 않아 단순화됩니다`;
}

// WYSIWYG → raw 진입: 현재 doc의 markdown + md 미표현 서식 경고 키
export function enterRawState(editor) {
  return {
    markdown: docToMarkdown(editor),
    warnings: findUnsupportedFormatting(editor.getJSON()), // 계약: JSONContent (PM Node 아님 — S0.2 §)
  };
}

// raw → 에디터 HTML. 공백뿐이면 null (기존 editor.isEmpty → onSave(null) 시맨틱).
export function parseRawToHtml(md, extensions) {
  if (!md || !md.trim()) return null;
  return markdownToEditorHtml(md, extensions);
}

// 비협업 3표면(task 설명·issue·댓글) 공용 raw 모드 훅.
// - editor: TipTap Editor (준비 전 null 허용)
// - extensions: 해당 표면 useEditor에 넘긴 것과 같은 배열
// - enabled: false면 자동 진입·토글 비활성 (IssueEditor를 공유하는 AnnotationSidebar 제외용)
export function useRawMode(editor, extensions, enabled = true) {
  const { prefs, loaded, setNamespace } = useUiPrefs();
  const [isRaw, setIsRaw] = useState(false);
  const isRawRef = useRef(false);
  const [rawText, setRawText] = useState('');
  const rawTextRef = useRef('');
  // RawMarkdownEditor는 value를 마운트 초기값으로만 쓰는 uncontrolled —
  // session을 key로 넘겨 enterRaw/resetRaw마다 강제 리마운트한다.
  const [session, setSession] = useState(0);
  const [warnings, setWarnings] = useState([]);
  const [parseError, setParseError] = useState(false);

  const handleRawChange = useCallback((text) => {
    rawTextRef.current = text;
    setRawText(text);
  }, []);

  // raw 세션 텍스트 교체 + 강제 리마운트 (imperative clearContent용)
  const resetRaw = useCallback((text = '') => {
    rawTextRef.current = text;
    setRawText(text);
    setSession((s) => s + 1);
  }, []);

  const enterRaw = useCallback(() => {
    if (!editor || editor.isDestroyed || isRawRef.current) return;
    const { markdown, warnings: warn } = enterRawState(editor);
    rawTextRef.current = markdown;
    setRawText(markdown);
    setWarnings(warn);
    setParseError(false);
    setSession((s) => s + 1);
    // ref를 상태보다 먼저 — EditorContent가 숨겨지며 나는 tiptap blur가
    // 표면의 blur-저장 가드(isRawRef 체크)에 걸리도록 동기 세팅.
    isRawRef.current = true;
    setIsRaw(true);
  }, [editor]);

  // 저장/복귀 공용 파싱. 실패 시 parseError 배지 on — 저장 차단은 호출부 책임.
  const parseCurrentRaw = useCallback(() => {
    try {
      const html = parseRawToHtml(rawTextRef.current, extensions);
      setParseError(false);
      return { ok: true, html };
    } catch (err) {
      console.error('raw markdown parse failed', err);
      setParseError(true);
      return { ok: false, html: null };
    }
  }, [extensions]);

  const exitRaw = useCallback(() => {
    if (!editor || editor.isDestroyed || !isRawRef.current) return;
    const res = parseCurrentRaw();
    if (!res.ok) return; // 파싱 실패(방어) — raw 유지 + 배지, 사용자 텍스트 보존
    editor.commands.setContent(res.html || '', { emitUpdate: true });
    isRawRef.current = false;
    setIsRaw(false);
    setWarnings([]);
    // md 링크에서 복원된 칩을 최신 제목·상태로 재해석 (fire-and-forget)
    hydrateEditor(editor);
  }, [editor, parseCurrentRaw]);

  const toggleRaw = useCallback(() => {
    if (!enabled) return;
    const wantRaw = !isRawRef.current;
    if (wantRaw) enterRaw(); else exitRaw();
    // 전환이 실제로 일어났을 때만 선호 기록 (exitRaw 파싱 실패 시 미기록)
    if (isRawRef.current === wantRaw) setNamespace('editor_raw_mode', wantRaw);
  }, [enabled, enterRaw, exitRaw, setNamespace]);

  const isRawEmpty = useCallback(() => rawTextRef.current.trim() === '', []);

  // ui_prefs 선호 자동 진입 — 에디터 준비 + prefs 로드 후 1회
  const autoRef = useRef(false);
  useEffect(() => {
    if (!enabled || autoRef.current || !editor || !loaded) return;
    autoRef.current = true;
    if (prefs.editor_raw_mode === true) enterRaw();
  }, [enabled, editor, loaded, prefs.editor_raw_mode, enterRaw]);

  return {
    isRaw, isRawRef, rawText, session, warnings, parseError,
    handleRawChange, toggleRaw, parseCurrentRaw, isRawEmpty, resetRaw,
  };
}
