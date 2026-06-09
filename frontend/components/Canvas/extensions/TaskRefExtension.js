import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import TaskRefPopup from './TaskRefPopup';

export const taskRefPluginKey = new PluginKey('taskRefSuggestion');

// snake_case key를 Title Case로 변환 (fallback용)
const formatStatusKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// 태스크 레퍼런스 인라인 노드
const TaskRefNode = Node.create({
  name: 'taskRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      taskId: { default: null },
      branchId: { default: null },
      displayId: { default: '' },
      title: { default: '' },
      status: { default: 'todo' },
      priority: { default: 'medium' },
      statusLabel: { default: null },
      statusColor: { default: null },
      statusCategory: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-task-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = node.attrs.statusLabel || formatStatusKey(node.attrs.status);
    const category = node.attrs.statusCategory || node.attrs.status;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-task-ref': 'true',
        'data-task-id': node.attrs.taskId,
        'data-branch-id': node.attrs.branchId,
        'data-display-id': node.attrs.displayId,
        'data-title': node.attrs.title,
        'data-status': node.attrs.status,
        'data-priority': node.attrs.priority,
        'data-status-label': node.attrs.statusLabel || '',
        'data-status-color': node.attrs.statusColor || '',
        'data-status-category': node.attrs.statusCategory || '',
        class: 'task-ref',
      }),
      `${node.attrs.displayId} ${node.attrs.title}`,
      ['span', {
        class: `ref-chip__badge ref-chip__badge--${category}`,
        'data-ref-badge': 'true',
        ...(node.attrs.statusColor ? { style: `background-color: ${node.attrs.statusColor}20; color: ${node.attrs.statusColor}` } : {}),
      }, label],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'task-ref';
      dom.contentEditable = 'false';
      dom.setAttribute('data-task-ref', 'true');
      dom.setAttribute('data-branch-id', node.attrs.branchId);
      dom.setAttribute('data-task-id', node.attrs.taskId);
      dom.title = `${node.attrs.displayId} - ${node.attrs.title}`;

      dom.appendChild(document.createTextNode(`${node.attrs.displayId} ${node.attrs.title}`));

      const label = node.attrs.statusLabel || formatStatusKey(node.attrs.status);
      const category = node.attrs.statusCategory || node.attrs.status;
      const badge = document.createElement('span');
      badge.className = `ref-chip__badge ref-chip__badge--${category}`;
      badge.textContent = label;
      if (node.attrs.statusColor) {
        badge.style.backgroundColor = `${node.attrs.statusColor}20`;
        badge.style.color = node.attrs.statusColor;
      }
      badge.setAttribute('data-ref-badge', 'true');
      dom.appendChild(badge);

      // 클릭 시 미리보기 패널 이벤트 발행
      dom.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('canvas:ref_click', {
          detail: { type: 'task', data: { branchId: node.attrs.branchId, taskId: node.attrs.taskId } },
        }));
      });

      return {
        dom,
        selectNode() { dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
      };
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: taskRefPluginKey,
        state: {
          init() {
            return { active: false, mode: null, keyword: '', from: 0 };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(taskRefPluginKey);
            if (meta) return meta;
            if (tr.docChanged) return { active: false, mode: null, keyword: '', from: 0 };
            return prev;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const pluginState = taskRefPluginKey.getState(state);

            if (pluginState.active) {
              // 팝업 활성 상태에서 키워드 업데이트
              setTimeout(() => {
                const newState = taskRefPluginKey.getState(view.state);
                if (!newState.active) return;
                const $pos = view.state.doc.resolve(view.state.selection.from);
                const textBefore = $pos.parent.textBetween(
                  Math.max(0, newState.from - $pos.start()),
                  view.state.selection.from - $pos.start(),
                  null,
                  '\ufffc',
                );
                // 선택된 mode에 맞는 토큰만으로 키워드 추출 (스페이스 없어도 동작)
                const re = newState.mode === 'all' ? /^\/ta\s?(.*)$/ : /^\/t\s?(.*)$/;
                const m = textBefore.match(re);
                if (m) {
                  view.dispatch(view.state.tr.setMeta(taskRefPluginKey, {
                    active: true, mode: newState.mode, keyword: m[1], from: newState.from,
                  }));
                } else {
                  view.dispatch(view.state.tr.setMeta(taskRefPluginKey, {
                    active: false, mode: null, keyword: '', from: 0,
                  }));
                }
              }, 0);
              return false;
            }

            return false;
          },

          handleKeyDown(view, event) {
            const pluginState = taskRefPluginKey.getState(view.state);
            if (!pluginState.active) return false;

            if (event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(taskRefPluginKey, {
                active: false, mode: null, keyword: '', from: 0,
              }));
              return true;
            }

            // ArrowDown/ArrowUp/Enter는 팝업에서 처리
            if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
              return true;
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

            // 커서 위치에서 팝업 좌표 계산 (viewport 기준 fixed + body append →
            // 에디터 컨테이너 종류/overflow 클리핑과 무관하게 어디서든 정확히 뜬다)
            const coords = editorView.coordsAtPos(editorView.state.selection.from);

            popup = document.createElement('div');
            popup.style.position = 'fixed';
            // 우측 가장자리에서 화면 밖으로 넘치지 않게 left 클램프
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

            renderer = new ReactRenderer(TaskRefPopup, {
              editor,
              props: {
                keyword: pluginState.keyword,
                mode: pluginState.mode,
                onSelect: (task) => {
                  const { state } = editorView;
                  const pluginSt = taskRefPluginKey.getState(state);
                  // 슬래시 텍스트부터 현재 커서까지 교체
                  const tr = state.tr.replaceWith(
                    pluginSt.from,
                    state.selection.from,
                    state.schema.nodes.taskRef.create({
                      taskId: task.task_id,
                      branchId: task.branch_id,
                      displayId: task.display_id,
                      title: task.title,
                      status: task.status,
                      priority: task.priority,
                      statusLabel: task.status_label || null,
                      statusColor: task.status_color || null,
                      statusCategory: task.status_category || null,
                    }),
                  );
                  tr.setMeta(taskRefPluginKey, { active: false, mode: null, keyword: '', from: 0 });
                  editorView.dispatch(tr);
                  editorView.focus();
                },
                onClose: () => {
                  editorView.dispatch(
                    editorView.state.tr.setMeta(taskRefPluginKey, {
                      active: false, mode: null, keyword: '', from: 0,
                    }),
                  );
                },
              },
            });

            popup.appendChild(renderer.element);
          }

          return {
            update(view) {
              const pluginState = taskRefPluginKey.getState(view.state);
              if (pluginState.active) {
                if (renderer) {
                  renderer.updateProps({
                    keyword: pluginState.keyword,
                    mode: pluginState.mode,
                  });
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

export default TaskRefNode;
