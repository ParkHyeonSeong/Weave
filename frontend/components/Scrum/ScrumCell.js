import { useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { checklistExtensions } from '@/components/Canvas/extensions/checklistExtension';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import { BookmarkPasteExtension } from '@/components/Canvas/extensions/BookmarkPastePlugin';
import DocRefNode from '@/components/Canvas/extensions/DocRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import ScrumCellToolbar from './ScrumCellToolbar';
import LinkHoverPopover from '@/components/shared/LinkHoverPopover';
import SlashCommandsExtension from '@/components/Canvas/extensions/SlashCommandsExtension';
import { useEditorRefHydration } from '@/library/refHydration';

// ydoc/provider가 준비된 뒤에만 마운트 (wrapper)
export default function ScrumCell(props) {
  if (!props.ydoc) return <div className="ScrumCell ScrumCell--loading" />;
  return <ScrumCellInner {...props} />;
}

function ScrumCellInner({ ydoc, fragmentKey, placeholder, members }) {
  const extensions = useMemo(() => {
    const fragment = ydoc.getXmlFragment(fragmentKey);
    const Yjs = Extension.create({
      name: 'yjs',
      addProseMirrorPlugins() { return [ySyncPlugin(fragment), yUndoPlugin()]; },
    });
    return [
      StarterKit.configure({ history: false, codeBlock: false, heading: false, blockquote: false, horizontalRule: false, link: { openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      ...checklistExtensions({ nested: false }),
      TaskRefNode,
      DocRefNode,
      MentionNode.configure({ members }),
      SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/d'] }),
      BookmarkPasteExtension,
      Yjs,
    ];
    // members는 보드 세션 내 정적(멤버는 셀 렌더 전 이미 로드됨)이라 deps에서 의도적으로
    // 제외 — 추가하면 멤버 목록 참조가 바뀔 때마다 에디터/ yjs 바인딩이 재생성되어 churn 발생.
  }, [ydoc, fragmentKey]);

  // [ydoc, fragmentKey] deps → 바인딩이 바뀌면 에디터를 진짜로 재생성(setOptions가
  // ProseMirror 플러그인을 재빌드하지 않아 옛 fragment에 붙는 잠재 버그를 구조적으로 차단)
  const editor = useEditor({ immediatelyRender: false, extensions }, [ydoc, fragmentKey]);

  // 칩 하이드레이션: 마운트 직후(yjs 초기 동기화 대기) + 탭 내 태스크 변경 시
  useEditorRefHydration(editor, 1000);

  if (!editor) return <div className="ScrumCell ScrumCell--loading" />;
  return (
    <>
      <EditorContent editor={editor} className="ScrumCell" />
      <ScrumCellToolbar editor={editor} />
      <LinkHoverPopover editor={editor} />
    </>
  );
}
