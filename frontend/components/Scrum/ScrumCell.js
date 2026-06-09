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
      StarterKit.configure({ history: false, codeBlock: false, heading: false, blockquote: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: placeholder || '' }),
      TaskList,
      TaskItem.configure({ nested: false }),
      TaskRefNode,
      DocRefNode,
      MentionNode,
      Yjs,
    ];
  }, [ydoc, fragmentKey]);

  // [ydoc, fragmentKey] deps → 바인딩이 바뀌면 에디터를 진짜로 재생성(setOptions가
  // ProseMirror 플러그인을 재빌드하지 않아 옛 fragment에 붙는 잠재 버그를 구조적으로 차단)
  const editor = useEditor({ immediatelyRender: false, extensions }, [ydoc, fragmentKey]);
  if (!editor) return <div className="ScrumCell ScrumCell--loading" />;
  return <EditorContent editor={editor} className="ScrumCell" />;
}
