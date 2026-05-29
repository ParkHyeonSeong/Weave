import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import MentionPopup from './MentionPopup';

const mentionPluginKey = new PluginKey('mentionSuggestion');

const MentionNode = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      userId: { default: null },
      username: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-mention': 'true',
        'data-user-id': node.attrs.userId,
        class: 'mention',
      }),
      `@${node.attrs.username}`,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'mention';
      dom.contentEditable = 'false';
      dom.textContent = `@${node.attrs.username}`;
      dom.title = node.attrs.username;
      return { dom };
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const branchId = this.options.branchId || null;

    return [
      new Plugin({
        key: mentionPluginKey,
        state: {
          init() {
            return { active: false, keyword: '', from: 0 };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(mentionPluginKey);
            if (meta) return meta;
            if (tr.docChanged) return { active: false, keyword: '', from: 0 };
            return prev;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const pluginState = mentionPluginKey.getState(state);

            if (pluginState.active) {
              setTimeout(() => {
                const newState = mentionPluginKey.getState(view.state);
                if (!newState.active) return;
                const $pos = view.state.doc.resolve(view.state.selection.from);
                const textBefore = $pos.parent.textBetween(
                  Math.max(0, newState.from - $pos.start()),
                  view.state.selection.from - $pos.start(),
                  null,
                  '\ufffc',
                );
                const match = textBefore.match(/@(\S*)$/);
                if (match) {
                  view.dispatch(view.state.tr.setMeta(mentionPluginKey, {
                    active: true, keyword: match[1], from: newState.from,
                  }));
                } else {
                  view.dispatch(view.state.tr.setMeta(mentionPluginKey, {
                    active: false, keyword: '', from: 0,
                  }));
                }
              }, 0);
              return false;
            }

            // @ 감지 (단어 시작 위치)
            if (text === '@') {
              const $pos = state.doc.resolve(from);
              const charBefore = from > $pos.start()
                ? $pos.parent.textBetween(from - $pos.start() - 1, from - $pos.start(), null, '\ufffc')
                : '';
              // @ 앞이 비어있거나 공백인 경우에만 트리거
              if (!charBefore || /\s/.test(charBefore)) {
                setTimeout(() => {
                  view.dispatch(view.state.tr.setMeta(mentionPluginKey, {
                    active: true, keyword: '', from,
                  }));
                }, 0);
              }
            }
            return false;
          },

          handleKeyDown(view, event) {
            const pluginState = mentionPluginKey.getState(view.state);
            if (!pluginState.active) return false;

            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(mentionPluginKey, {
                active: false, keyword: '', from: 0,
              }));
              return true;
            }

            if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
              return true;
            }

            // Space 입력 시 팝업 닫기
            if (event.key === ' ') {
              view.dispatch(view.state.tr.setMeta(mentionPluginKey, {
                active: false, keyword: '', from: 0,
              }));
              return false;
            }

            return false;
          },
        },

        view(editorView) {
          let popup = null;
          let renderer = null;

          function destroyPopup() {
            if (renderer) {
              renderer.destroy();
              renderer = null;
            }
            if (popup) {
              popup.remove();
              popup = null;
            }
          }

          function createPopup(pluginState) {
            destroyPopup();

            const coords = editorView.coordsAtPos(editorView.state.selection.from);
            const editorContainer = editorView.dom.closest('.CanvasEditor')
              || editorView.dom.closest('.TaskDescEditor')
              || editorView.dom.closest('.IssueEditor')
              || editorView.dom.closest('.CommentEditor')
              || editorView.dom.parentElement;
            const editorRect = editorContainer.getBoundingClientRect();

            popup = document.createElement('div');
            popup.style.position = 'absolute';
            popup.style.left = `${coords.left - editorRect.left}px`;
            popup.style.top = `${coords.bottom - editorRect.top + 4}px`;
            popup.style.zIndex = '200';
            editorContainer.appendChild(popup);

            renderer = new ReactRenderer(MentionPopup, {
              editor,
              props: {
                keyword: pluginState.keyword,
                branchId,
                onSelect: (user) => {
                  const { state } = editorView;
                  const pluginSt = mentionPluginKey.getState(state);
                  const tr = state.tr.replaceWith(
                    pluginSt.from,
                    state.selection.from,
                    state.schema.nodes.mention.create({
                      userId: user.user_id,
                      username: user.username,
                    }),
                  );
                  tr.setMeta(mentionPluginKey, { active: false, keyword: '', from: 0 });
                  editorView.dispatch(tr);
                  editorView.focus();
                },
                onClose: () => {
                  editorView.dispatch(
                    editorView.state.tr.setMeta(mentionPluginKey, {
                      active: false, keyword: '', from: 0,
                    }),
                  );
                },
              },
            });

            popup.appendChild(renderer.element);
          }

          return {
            update(view) {
              const pluginState = mentionPluginKey.getState(view.state);
              if (pluginState.active) {
                if (renderer) {
                  renderer.updateProps({ keyword: pluginState.keyword });
                } else {
                  createPopup(pluginState);
                }
              } else {
                destroyPopup();
              }
            },
            destroy() {
              destroyPopup();
            },
          };
        },
      }),
    ];
  },
});

export default MentionNode;
