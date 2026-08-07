import { Extension } from '@tiptap/core';
import { undoCommand, redoCommand } from 'y-prosemirror';

// undoRedo:false로 PM UndoRedo를 끈 collab 표면(ScrumCell·Canvas)에서 undo/redo 명령·키맵을
// Yjs 인지 방식으로 복원한다. y-prosemirror의 undo/redo는 undoManager를 즉시 조작해 Yjs를
// 바꾸고 그 결과가 y-sync 트랜잭션으로 반영된다 — TipTap 명령 러너가 만든 자기 tr을 그대로
// dispatch하면 "Applying a mismatched transaction"이 난다. 그래서:
//  ① dispatch가 있을 때만 실제 undo 실행(undoCommand는 dispatch==null이면 canUndo 조회만 —
//     TipTap can()의 dry-run과 호환), ② TipTap 자기 tr은 preventDispatch로 억제(core dist:61·83).
export default Extension.create({
  name: 'yUndoRedo',
  addCommands() {
    const run = (cmd) => () => ({ state, tr, dispatch }) => {
      if (dispatch) tr.setMeta('preventDispatch', true); // TipTap의 stale tr 억제
      return cmd(state, dispatch);                        // Yjs undoManager가 직접 변경
    };
    return { undo: run(undoCommand), redo: run(redoCommand) };
  },
  addKeyboardShortcuts() {
    // upstream UndoRedo가 제공하던 바인딩을 전부 유지한다(러시아어 레이아웃 Mod-я·Shift-Mod-я 포함).
    return {
      'Mod-z': () => this.editor.commands.undo(),
      'Mod-y': () => this.editor.commands.redo(),
      'Shift-Mod-z': () => this.editor.commands.redo(),
      'Mod-я': () => this.editor.commands.undo(),
      'Shift-Mod-я': () => this.editor.commands.redo(),
    };
  },
});
