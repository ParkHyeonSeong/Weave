import Link from '@tiptap/extension-link';

// WEAVE-37: 업스트림 Link는 mark의 inclusive를 autolink 옵션에 묶어 둔다
// (@tiptap/extension-link@3.20.0 dist/index.js:229-231 — inclusive() { return this.options.autolink; }).
// 그래서 autolink:true 표면에서는 링크 오른쪽 경계가 inclusive가 되어, 링크 끝 글자를
// 지우고 다시 타이핑하면 새 글자가 link mark를 상속한다(링크 잔존).
// 여기서 inclusive만 false로 분리하고 autolink(URL 타이핑 자동 링크)는 그대로 유지한다.
// mark 이름은 'link' 그대로 — editorLink.js·LinkHoverPopover 등 이름 기반 소비자 무영향.
// editorLink.js:82의 unsetMark('link')(삽입 트랜잭션의 stored mark 방어)와 상보적 — 둘 다 필요.
const WeaveLink = Link.extend({
  inclusive: false,
});

export default WeaveLink;
