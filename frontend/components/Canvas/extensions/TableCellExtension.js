import { TableCell } from '@tiptap/extension-table-cell';

export const TableCellWithBgColor = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
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
  },
});
