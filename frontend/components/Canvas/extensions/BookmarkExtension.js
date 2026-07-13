import { Node, mergeAttributes } from '@tiptap/core';
import { escapeLinkText, encodeMarkdownUrl } from './refMarkdown';

// URL Bookmark 블록 노드 (Notion 스타일 bookmark 카드)
const BookmarkNode = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
      favicon: { default: '' },
      ogImage: { default: '' },
      domain: { default: '' },
      loading: { default: false },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-bookmark]',
      getAttrs: (el) => ({
        url: el.getAttribute('data-url') || '',
        title: el.getAttribute('data-title') || '',
        description: el.getAttribute('data-description') || '',
        favicon: el.getAttribute('data-favicon') || '',
        ogImage: el.getAttribute('data-og-image') || '',
        domain: el.getAttribute('data-domain') || '',
      }),
    }];
  },

  // md 직렬화: URL 링크 한 줄 강등 — 복원 없음, 붙여넣기 시 BookmarkPaste가 카드화 (스펙 §3.2)
  renderMarkdown(node) {
    const url = node.attrs?.url || '';
    return `[${escapeLinkText(node.attrs?.title || url)}](${encodeMarkdownUrl(url)})`;
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, {
      'data-bookmark': 'true',
      'data-url': node.attrs.url,
      'data-title': node.attrs.title,
      'data-description': node.attrs.description,
      'data-favicon': node.attrs.favicon,
      'data-og-image': node.attrs.ogImage,
      'data-domain': node.attrs.domain,
      class: 'bookmark-card',
    });

    const children = [
      ['div', { class: 'bookmark-card__content' },
        ['span', { class: 'bookmark-card__title' }, node.attrs.title || node.attrs.url],
        ...(node.attrs.description
          ? [['span', { class: 'bookmark-card__description' }, node.attrs.description]]
          : []),
        ['div', { class: 'bookmark-card__meta' },
          ...(node.attrs.favicon
            ? [['img', { class: 'bookmark-card__favicon', src: node.attrs.favicon, alt: '' }]]
            : []),
          ['span', { class: 'bookmark-card__domain' }, node.attrs.domain],
        ],
      ],
    ];

    if (node.attrs.ogImage) {
      children.push(['img', { class: 'bookmark-card__image', src: node.attrs.ogImage, alt: '' }]);
    }

    return ['div', attrs, ...children];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = `bookmark-card${node.attrs.loading ? ' bookmark-card--loading' : ''}`;
      dom.contentEditable = 'false';

      const link = document.createElement('a');
      link.href = node.attrs.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'bookmark-card__link';
      link.addEventListener('click', (e) => e.stopPropagation());

      // 콘텐츠 영역
      const content = document.createElement('div');
      content.className = 'bookmark-card__content';

      const title = document.createElement('span');
      title.className = 'bookmark-card__title';
      title.textContent = node.attrs.title || node.attrs.url;
      content.appendChild(title);

      if (node.attrs.description) {
        const desc = document.createElement('span');
        desc.className = 'bookmark-card__description';
        desc.textContent = node.attrs.description;
        content.appendChild(desc);
      }

      const meta = document.createElement('div');
      meta.className = 'bookmark-card__meta';

      if (node.attrs.favicon) {
        const favicon = document.createElement('img');
        favicon.className = 'bookmark-card__favicon';
        favicon.src = node.attrs.favicon;
        favicon.alt = '';
        favicon.onerror = () => { favicon.style.display = 'none'; };
        meta.appendChild(favicon);
      }

      const domain = document.createElement('span');
      domain.className = 'bookmark-card__domain';
      domain.textContent = node.attrs.domain;
      meta.appendChild(domain);

      content.appendChild(meta);
      link.appendChild(content);

      // OG 이미지
      if (node.attrs.ogImage) {
        const img = document.createElement('img');
        img.className = 'bookmark-card__image';
        img.src = node.attrs.ogImage;
        img.alt = '';
        img.onerror = () => { img.style.display = 'none'; };
        link.appendChild(img);
      }

      dom.appendChild(link);

      return {
        dom,
        selectNode() { dom.classList.add('ProseMirror-selectednode'); },
        deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
      };
    };
  },
});

export default BookmarkNode;
