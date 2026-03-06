import { Node, mergeAttributes } from '@tiptap/core';

// Confluence 스타일 정보/경고/성공/에러 패널
const CalloutExtension = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-callout') || 'info',
        renderHTML: (attrs) => ({ 'data-callout': attrs.type }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0];
  },

  addCommands() {
    return {
      setCallout: (type) => ({ commands }) => {
        return commands.wrapIn(this.name, { type });
      },
      toggleCallout: (type) => ({ commands, editor }) => {
        if (editor.isActive(this.name, { type })) {
          return commands.lift(this.name);
        }
        return commands.wrapIn(this.name, { type });
      },
    };
  },
});

export default CalloutExtension;
