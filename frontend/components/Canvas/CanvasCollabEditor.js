import { useState, useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { ResizableImage } from './extensions/ResizableImageExtension';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCellWithBgColor, TableHeaderWithBgColor } from './extensions/TableCellExtension';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import { checklistExtensions } from './extensions/checklistExtension';
import Mathematics from '@tiptap/extension-mathematics';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import { common, createLowlight } from 'lowlight';
import CalloutExtension from './extensions/CalloutExtension';
import TaskRefNode from './extensions/TaskRefExtension';
import MentionNode from './extensions/MentionExtension';
import DocRefNode from './extensions/DocRefExtension';
import IssueRefNode from './extensions/IssueRefExtension';
import SlashCommandsExtension from './extensions/SlashCommandsExtension';
import { createImageUploadPlugin } from './extensions/ImageUploadPlugin';
import BookmarkNode from './extensions/BookmarkExtension';
import { BookmarkPasteExtension } from './extensions/BookmarkPastePlugin';
import { createMarkdownPastePlugin } from './extensions/MarkdownPastePlugin';
import MermaidExtension from './extensions/MermaidExtension';
import CanvasEditorToolbar from './CanvasEditorToolbar';
import TableBubbleMenu from './TableBubbleMenu';
import { getBaseURL } from '@/library/_axios';
import { buildAvatarDOM } from '@/library/userAvatar';
import { useEditorRefHydration } from '@/library/refHydration';

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
            return [createImageUploadPlugin({ canvasId })];
          },
        })
      : null;

    const MarkdownPaste = Extension.create({
      name: 'markdownPaste',
      addProseMirrorPlugins() {
        return [createMarkdownPastePlugin()];
      },
    });

    // 커스텀 커서 빌더: 볼드 캐럿 + 공용 아바타(buildAvatarDOM)
    const cursorBuilder = (user) => {
      const cursor = document.createElement('span');
      cursor.classList.add('collaboration-cursor__caret');
      cursor.style.borderColor = user.color;

      const avatar = buildAvatarDOM(user, getBaseURL());
      avatar.classList.add('collaboration-cursor__avatar');
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
      TableHeaderWithBgColor,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'image'],
      }),
      Highlight.configure({
        multicolor: true,
      }),
      TextStyle,
      Color,
      ...checklistExtensions({ nested: true }),
      CalloutExtension,
      TaskRefNode,
      MentionNode.configure({ canvasId }),
      DocRefNode,
      IssueRefNode,
      SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/d', '/i'] }),
      BookmarkNode,
      BookmarkPasteExtension,
      MarkdownPaste,
      Mathematics.configure({
        katexOptions: { throwOnError: false },
      }),
      MermaidExtension,
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

  // 칩 하이드레이션: 마운트 직후(yjs 초기 동기화 대기) + 탭 내 태스크 변경 시
  useEditorRefHydration(editor, 1000);

  if (!editor) return null;

  return (
    <div className="CanvasEditor">
      <CanvasEditorToolbar editor={editor} />
      <TableBubbleMenu editor={editor} />
      <EditorContent editor={editor} className="CanvasEditor__Content" />
      <div className={`CanvasEditor__Counter ${isOverLimit ? 'CanvasEditor__Counter--over' : ''}`}>
        {charCount.toLocaleString()} / {MAX_PLAIN_TEXT_LENGTH.toLocaleString()}
      </div>
    </div>
  );
}
