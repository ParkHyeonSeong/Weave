import { useState, useEffect, useRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { ResizableImage } from './extensions/ResizableImageExtension';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCellWithBgColor } from './extensions/TableCellExtension';
import { TableHeader } from '@tiptap/extension-table-header';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Mathematics from '@tiptap/extension-mathematics';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import { common, createLowlight } from 'lowlight';
import CalloutExtension from './extensions/CalloutExtension';
import TaskRefNode from './extensions/TaskRefExtension';
import DocRefNode from './extensions/DocRefExtension';
import IssueRefNode from './extensions/IssueRefExtension';
import { createImageUploadPlugin } from './extensions/ImageUploadPlugin';
import CanvasEditorToolbar from './CanvasEditorToolbar';
import { axios } from '@/library/_axios';

const lowlight = createLowlight(common);
const MAX_PLAIN_TEXT_LENGTH = 60000;

// Wrapper: ydoc/provider가 준비되면 Inner를 마운트
export default function CanvasCollabEditor(props) {
  if (!props.ydoc || !props.provider) return null;
  return <CollabEditorInner {...props} />;
}

// Inner: ydoc/provider가 항상 존재하는 상태에서 hooks 호출
function CollabEditorInner({
  ydoc,
  provider,
  canvasId,
  initialContent,
  hasExistingYjsState,
  onHtmlChange,
}) {
  const [charCount, setCharCount] = useState(0);
  const isOverLimit = charCount > MAX_PLAIN_TEXT_LENGTH;

  const extensions = useMemo(() => {
    const fragment = ydoc.getXmlFragment('default');

    const ImageUpload = canvasId
      ? Extension.create({
          name: 'imageUpload',
          addProseMirrorPlugins() {
            return [createImageUploadPlugin(canvasId)];
          },
        })
      : null;

    // 커스텀 커서 빌더: 볼드 캐럿 + 작은 원형 아바타
    const cursorBuilder = (user) => {
      const cursor = document.createElement('span');
      cursor.classList.add('collaboration-cursor__caret');
      cursor.style.borderColor = user.color;

      const avatar = document.createElement('span');
      avatar.classList.add('collaboration-cursor__avatar');
      avatar.style.backgroundColor = user.color;
      avatar.textContent = (user.name || '?').charAt(0).toUpperCase();
      avatar.setAttribute('title', user.name);
      cursor.appendChild(avatar);

      return cursor;
    };

    // y-prosemirror 플러그인을 직접 사용 (TipTap wrapper 버전 불일치 회피)
    const YjsExtension = Extension.create({
      name: 'yjs',
      addProseMirrorPlugins() {
        return [
          ySyncPlugin(fragment),
          yCursorPlugin(provider.awareness, { cursorBuilder }),
          yUndoPlugin(),
        ];
      },
    });

    return [
      StarterKit.configure({
        codeBlock: false,
        history: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      ResizableImage,
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCellWithBgColor,
      TableHeader,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'image'],
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
      TaskRefNode,
      DocRefNode,
      IssueRefNode,
      Mathematics.configure({
        katexOptions: { throwOnError: false },
      }),
      ...(ImageUpload ? [ImageUpload] : []),
      YjsExtension,
    ];
  }, [ydoc, provider, canvasId]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    onUpdate: ({ editor }) => {
      setCharCount(editor.getText().length);
      if (onHtmlChange) {
        onHtmlChange(editor.getHTML());
      }
    },
  });

  // 기존 HTML content를 Yjs doc에 로드 (yjs_state가 없는 기존 페이지용)
  useEffect(() => {
    if (!editor || !initialContent || hasExistingYjsState) return;
    const fragment = ydoc.getXmlFragment('default');
    if (fragment.length === 0) {
      editor.commands.setContent(initialContent);
    }
  }, [editor, initialContent, hasExistingYjsState, ydoc]);

  // 에디터 마운트 시 ref 상태 배치 갱신 (DOM 뱃지만 업데이트, Yjs 속성 미변경)
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (!editor || refreshedRef.current) return;
    refreshedRef.current = true;

    // Yjs sync 후 DOM이 준비되기를 기다린 뒤 배치 갱신
    const timer = setTimeout(() => {
      const taskIds = new Set();
      const issueIds = new Set();

      editor.state.doc.descendants((node) => {
        if (node.type.name === 'taskRef' && node.attrs.taskId) taskIds.add(node.attrs.taskId);
        if (node.type.name === 'issueRef' && node.attrs.issueId) issueIds.add(node.attrs.issueId);
      });

      if (taskIds.size === 0 && issueIds.size === 0) return;

      axios.post('/ref-status', {
        task_ids: [...taskIds],
        issue_ids: [...issueIds],
      }).then((res) => {
        if (!res.data.status) return;
        const { tasks, issues } = res.data;
        const taskStatusMap = { todo: 'Todo', in_progress: 'In Progress', done: 'Done' };
        const issueStatusMap = { open: 'Open', closed: 'Closed' };

        editor.state.doc.descendants((node, nodePos) => {
          if (node.type.name === 'taskRef') {
            const info = tasks[String(node.attrs.taskId)];
            if (!info) return;
            const dom = editor.view.nodeDOM(nodePos);
            const badge = dom?.querySelector('[data-ref-badge]');
            if (badge) {
              badge.className = `ref-chip__badge ref-chip__badge--${info.status}`;
              badge.textContent = taskStatusMap[info.status] || info.status;
            }
          }
          if (node.type.name === 'issueRef') {
            const info = issues[String(node.attrs.issueId)];
            if (!info) return;
            const dom = editor.view.nodeDOM(nodePos);
            const badge = dom?.querySelector('[data-ref-badge]');
            if (badge) {
              badge.className = `ref-chip__badge ref-chip__badge--${info.status}`;
              badge.textContent = issueStatusMap[info.status] || info.status;
            }
          }
        });
      }).catch(() => {});
    }, 1000);

    return () => clearTimeout(timer);
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="CanvasEditor">
      <CanvasEditorToolbar editor={editor} />
      <EditorContent editor={editor} className="CanvasEditor__Content" />
      <div className={`CanvasEditor__Counter ${isOverLimit ? 'CanvasEditor__Counter--over' : ''}`}>
        {charCount.toLocaleString()} / {MAX_PLAIN_TEXT_LENGTH.toLocaleString()}
      </div>
    </div>
  );
}
