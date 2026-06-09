import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import SlashCommandMenu from './SlashCommandMenu';
import { filterSlashCommands, exactSlashCommand } from './slashCommands';
import { taskRefPluginKey } from './TaskRefExtension';
import { docRefPluginKey } from './DocRefExtension';
import { issueRefPluginKey } from './IssueRefExtension';

export const slashCommandPluginKey = new PluginKey('slashCommandMenu');
const OFF = { active: false, query: '', from: 0, index: 0 };

// 선택된 커맨드로 검색 시작: 정규 토큰으로 치환 후 해당 ref 플러그인을 active 화.
function activateRef(command, from, view) {
  const { state } = view;
  let tr = state.tr.insertText(command.cmd, from, state.selection.from);
  tr = tr.setMeta(slashCommandPluginKey, OFF);
  if (command.kind === 'task') {
    tr = tr.setMeta(taskRefPluginKey, { active: true, mode: command.mode, keyword: '', from });
  } else if (command.kind === 'doc') {
    tr = tr.setMeta(docRefPluginKey, { active: true, keyword: '', from });
  } else if (command.kind === 'issue') {
    tr = tr.setMeta(issueRefPluginKey, { active: true, keyword: '', from });
  }
  view.dispatch(tr);
  view.focus();
}

const SlashCommandsExtension = Extension.create({
  name: 'slashCommands',
  addOptions() { return { enabled: null }; }, // null=전체, 또는 ['/t','/ta','/d','/i'] 부분집합

  addProseMirrorPlugins() {
    const editor = this.editor;
    const enabled = this.options.enabled;

    return [
      new Plugin({
        key: slashCommandPluginKey,
        state: {
          init() { return { ...OFF }; },
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(slashCommandPluginKey);
            if (meta) return meta;
            if (!prev.active || !tr.docChanged) return prev;
            // 타이핑·undo·붙여넣기·원격편집 등 모든 문서 변경에서 슬래시 토큰 재검증
            // (handleTextInput를 안 거치는 undo도 여기서 닫힘 처리됨)
            const $pos = newState.doc.resolve(newState.selection.from);
            const fromIdx = prev.from - $pos.start();
            const toIdx = newState.selection.from - $pos.start();
            if (fromIdx < 0 || toIdx < fromIdx) return { ...OFF };
            const textBefore = $pos.parent.textBetween(fromIdx, toIdx, null, '￼');
            if (/^\/\S*$/.test(textBefore) && filterSlashCommands(textBefore, enabled).length > 0) {
              return prev.query === textBefore ? prev : { ...prev, query: textBefore, index: 0 };
            }
            return { ...OFF };
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const ps = slashCommandPluginKey.getState(state);

            // 활성 중 키워드 갱신·종료는 plugin state.apply()가 담당
            if (ps.active) return false;

            if (text === '/') {
              const $pos = state.doc.resolve(from);
              const charBefore = from > $pos.start()
                ? $pos.parent.textBetween(from - $pos.start() - 1, from - $pos.start(), null, '￼')
                : '';
              if (!charBefore || /\s/.test(charBefore)) {
                setTimeout(() => {
                  view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, {
                    active: true, query: '/', from, index: 0,
                  }));
                }, 0);
              }
            }
            return false;
          },

          handleKeyDown(view, event) {
            const ps = slashCommandPluginKey.getState(view.state);
            if (!ps.active) return false;
            const list = filterSlashCommands(ps.query, enabled);

            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, OFF));
              return true;
            }
            if (event.key === 'ArrowDown') {
              const index = list.length ? (ps.index + 1) % list.length : 0;
              view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, { ...ps, index }));
              return true;
            }
            if (event.key === 'ArrowUp') {
              const index = list.length ? (ps.index - 1 + list.length) % list.length : 0;
              view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, { ...ps, index }));
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              if (list[ps.index]) { activateRef(list[ps.index], ps.from, view); return true; }
              return false;
            }
            if (event.key === ' ') {
              const exact = exactSlashCommand(ps.query, enabled);
              if (exact) { activateRef(exact, ps.from, view); return true; }
              view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, OFF));
              return false;
            }
            return false;
          },
        },

        view(editorView) {
          let popup = null;
          let renderer = null;

          function destroyPopup() {
            if (renderer) { renderer.destroy(); renderer = null; }
            if (popup) { popup.remove(); popup = null; }
          }

          function render(ps) {
            const list = filterSlashCommands(ps.query, enabled);
            if (!list.length) { destroyPopup(); return; }
            if (!popup) {
              const coords = editorView.coordsAtPos(editorView.state.selection.from);
              popup = document.createElement('div');
              popup.style.position = 'fixed';
              popup.style.left = `${Math.min(coords.left, window.innerWidth - 320)}px`;
              popup.style.top = `${coords.bottom + 4}px`;
              popup.style.zIndex = '500';
              document.body.appendChild(popup);
              requestAnimationFrame(() => {
                if (!popup) return;
                const h = popup.offsetHeight;
                if (h && coords.bottom + h + 8 > window.innerHeight) {
                  popup.style.top = `${Math.max(8, coords.top - h - 4)}px`;
                }
              });
              renderer = new ReactRenderer(SlashCommandMenu, {
                editor,
                props: {
                  commands: list,
                  activeIndex: ps.index,
                  onSelect: (cmd) => activateRef(cmd, slashCommandPluginKey.getState(editorView.state).from, editorView),
                  onHover: (idx) => editorView.dispatch(
                    editorView.state.tr.setMeta(slashCommandPluginKey, { ...slashCommandPluginKey.getState(editorView.state), index: idx }),
                  ),
                },
              });
              popup.appendChild(renderer.element);
            } else {
              renderer.updateProps({ commands: list, activeIndex: ps.index });
            }
          }

          return {
            update(view) {
              const ps = slashCommandPluginKey.getState(view.state);
              if (ps.active) render(ps); else destroyPopup();
            },
            destroy() { destroyPopup(); },
          };
        },
      }),
    ];
  },
});

export default SlashCommandsExtension;
