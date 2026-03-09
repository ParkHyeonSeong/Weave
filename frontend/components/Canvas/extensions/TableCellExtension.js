import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

const cellAttributes = {
  backgroundColor: {
    default: null,
    parseHTML: (el) => el.style.backgroundColor || null,
    renderHTML: (attrs) => {
      const styles = [];
      if (attrs.backgroundColor) styles.push(`background-color: ${attrs.backgroundColor}`);
      if (attrs.verticalAlign) styles.push(`vertical-align: ${attrs.verticalAlign}`);
      return styles.length ? { style: styles.join('; ') } : {};
    },
  },
  verticalAlign: {
    default: null,
    parseHTML: (el) => el.style.verticalAlign || null,
    renderHTML: () => ({}),
  },
};

export const TableCellWithBgColor = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes };
  },
});

export const TableHeaderWithBgColor = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes };
  },
});
