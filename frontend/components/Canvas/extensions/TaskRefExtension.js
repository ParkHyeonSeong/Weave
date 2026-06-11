import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import TaskRefPopup from './TaskRefPopup';
import { createRefSuggestionPlugin } from './refSuggestion';

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
    return [
      createRefSuggestionPlugin({
        editor: this.editor,
        pluginKey: taskRefPluginKey,
        Popup: TaskRefPopup,
        buildProps: (st, { close, dismiss, backToMenu, insertRefNode }) => ({
          mode: st.mode,
          onClose: close,
          onDismiss: dismiss,
          onBack: backToMenu,
          onSelect: (task) => insertRefNode('taskRef', {
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
        }),
      }),
    ];
  },
});

export default TaskRefNode;
