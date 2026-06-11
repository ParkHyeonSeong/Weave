import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import MentionPopup from './MentionPopup';
import { reparseSuggestion, scheduleTriggerActivation } from './refSuggestion';

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
      dom.setAttribute('data-mention', 'true');
      dom.setAttribute('data-user-id', node.attrs.userId);
      dom.setAttribute('data-username', node.attrs.username);
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
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(mentionPluginKey);
            if (meta) return meta;
            if (!prev.active || !tr.docChanged) return prev;
            return reparseSuggestion(prev, tr, newState, /^@(\S*)$/);
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const pluginState = mentionPluginKey.getState(view.state);
            if (pluginState.active) return false; // 활성 중 갱신은 plugin state.apply()가 담당

            // @ 감지 — 단어 시작 조건 검증은 헬퍼가 콜백 시점에 수행
            if (text === '@') {
              scheduleTriggerActivation(view, '@', mentionPluginKey, { active: true, keyword: '' });
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

            // Space는 그대로 삽입되고, '@kw '가 토큰 정규식에 안 맞아
            // plugin state.apply() 재파싱에서 팝업이 닫힌다
            return false;
          },
        },

        view(editorView) {
          let popup = null;
          let renderer = null;
          let lastState = null; // 상태 불변 시 updateProps 리렌더 스킵용

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
              if (pluginState === lastState) return;
              lastState = pluginState;
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
