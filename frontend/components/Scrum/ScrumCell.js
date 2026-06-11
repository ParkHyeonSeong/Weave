import { useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import DocRefNode from '@/components/Canvas/extensions/DocRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import ScrumCellToolbar from './ScrumCellToolbar';
import SlashCommandsExtension from '@/components/Canvas/extensions/SlashCommandsExtension';
import { useEditorRefHydration } from '@/library/refHydration';

// ydoc/provider가 준비된 뒤에만 마운트 (wrapper)
export default function ScrumCell(props) {
  if (!props.ydoc) return <div className="ScrumCell ScrumCell--loading" />;
  return <ScrumCellInner {...props} />;
}

function ScrumCellInner({ ydoc, fragmentKey, placeholder }) {
  const extensions = useMemo(() => {
    const fragment = ydoc.getXmlFragment(fragmentKey);
    const Yjs = Extension.create({
      name: 'yjs',
      addProseMirrorPlugins() { return [ySyncPlugin(fragment), yUndoPlugin()]; },
    });
    return [
      StarterKit.configure({ history: false, codeBlock: false, heading: false, blockquote: false, horizontalRule: false, link: { openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      TaskList,
      TaskItem.configure({ nested: false }),
      TaskRefNode,
      DocRefNode,
      MentionNode,
      SlashCommandsExtension.configure({ enabled: ['/t', '/ta', '/d'] }),
      Yjs,
    ];
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
    </>
  );
}
