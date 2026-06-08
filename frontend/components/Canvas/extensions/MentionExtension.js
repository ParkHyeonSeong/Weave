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
      userId: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-user-id');
          return v != null && v !== '' ? Number(v) : null;
        },
        renderHTML: (attrs) => (
          attrs.userId != null ? { 'data-user-id': attrs.userId } : {}
        ),
      },
      username: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-username') || '',
        renderHTML: (attrs) => (
          attrs.username ? { 'data-username': attrs.username } : {}
        ),
      },
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

            popup = document.createElement('div');
            // viewport 기준 fixed + body append → 에디터 컨테이너 종류/overflow 클리핑과
            // 무관하게 어디서든(스크럼 셀 포함) 커서 위치에 정확히 뜬다.
            popup.style.position = 'fixed';
            // 우측 가장자리(목/금 칸 등)에서 화면 밖으로 넘치지 않게 left 클램프
            popup.style.left = `${Math.min(coords.left, window.innerWidth - 360)}px`;
            popup.style.top = `${coords.bottom + 4}px`;
            popup.style.zIndex = '500';
            document.body.appendChild(popup);
            // 화면 아래로 넘치면 커서 위로 뒤집어 띄움 (하단 셀에서 안 묻히게)
            requestAnimationFrame(() => {
              if (!popup) return;
              const h = popup.offsetHeight;
              if (h && coords.bottom + h + 8 > window.innerHeight) {
                popup.style.top = `${Math.max(8, coords.top - h - 4)}px`;
              }
            });

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

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildMentionHtml(user) {
  if (!user || !user.user_id) return '';
  const uid = Number(user.user_id);
  if (!Number.isFinite(uid)) return '';
  const uname = escHtml(user.username || '');
  return `<span data-mention="true" data-user-id="${uid}" data-username="${uname}" class="mention">@${uname}</span>`;
}
