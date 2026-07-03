import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import SlashCommandMenu from './SlashCommandMenu';
import { filterSlashCommands, exactSlashCommand } from './slashCommands';
import { mapTokenBeforeCursor, scheduleTriggerActivation, slashCommandPluginKey } from './refSuggestion';
import { taskRefPluginKey } from './TaskRefExtension';
import { docRefPluginKey } from './DocRefExtension';
import { issueRefPluginKey } from './IssueRefExtension';
import { mathEditPluginKey } from './mathExtensions';

export { slashCommandPluginKey };
const OFF = { active: false, query: '', from: 0, index: 0 };

// 선택된 커맨드로 검색 시작: 토큰을 지우고 해당 ref 팝업의 input 검색으로 전환.
// 포커스는 팝업 input이 가져간다.
function activateRef(command, from, view) {
  const { state } = view;
  let tr = state.tr.delete(from, state.selection.from);
  tr = tr.setMeta(slashCommandPluginKey, OFF);
  if (command.kind === 'task') {
    tr = tr.setMeta(taskRefPluginKey, { active: true, mode: command.mode, from });
  } else if (command.kind === 'doc') {
    tr = tr.setMeta(docRefPluginKey, { active: true, from });
  } else if (command.kind === 'issue') {
    tr = tr.setMeta(issueRefPluginKey, { active: true, from });
  } else if (command.kind === 'math') {
    const mathType = state.schema.nodes.inlineMath;
    if (mathType) {
      tr = tr.insert(from, mathType.create({ latex: '' }));
      tr = tr.setMeta(mathEditPluginKey, { active: true, pos: from, latex: '', kind: 'inline', isNew: true });
    }
  }
  view.dispatch(tr);
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
            const token = mapTokenBeforeCursor(prev.from, tr, newState);
            if (token && /^\/\S*$/.test(token.text) && filterSlashCommands(token.text, enabled).length > 0) {
              if (prev.query === token.text && prev.from === token.from) return prev;
              return { ...prev, from: token.from, query: token.text, index: prev.query === token.text ? prev.index : 0 };
            }
            return OFF;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const ps = slashCommandPluginKey.getState(view.state);

            // 활성 중 키워드 갱신·종료는 plugin state.apply()가 담당
            if (ps.active) return false;

            // '/' 감지 — 단어 시작 조건 검증은 헬퍼가 콜백 시점에 수행
            if (text === '/') {
              scheduleTriggerActivation(view, '/', slashCommandPluginKey, { active: true, query: '/', index: 0 });
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
          let lastState = null; // 상태 불변 시 updateProps 리렌더 스킵용

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
              if (ps === lastState) return;
              lastState = ps;
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
