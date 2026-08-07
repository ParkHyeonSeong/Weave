import Link from '@tiptap/extension-link';
import { find } from 'linkifyjs'; // extension-link의 직접 의존(^4.3.2) — autolink와 동일 판정기
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { combineTransactionSteps, getChangedRanges, getMarkRange } from '@tiptap/core';
import { ySyncPluginKey } from 'y-prosemirror'; // 원격 판별 — 문자열 'y-sync$' 아님(8차 P1)
import { ReplaceStep } from '@tiptap/pm/transform'; // 삭제-only 판정(11차 P1)

// WEAVE-37: 업스트림 Link는 mark의 inclusive를 autolink 옵션에 묶어 둔다
// (@tiptap/extension-link@3.20.0 dist/index.js:229-231). inclusive만 false로 분리하고
// autolink는 유지한다. editorLink.js:82의 unsetMark('link')와 상보 — 둘 다 필요.
//
// 무결성 플러그인(D5=A "로컬 전용"): inclusive:false로도 못 막는 잔존 경로 3개를 로컬
// 편집 트랜잭션에서 막는다. 원격(y-sync) 트랜잭션은 정리하지 않는다 — 각 클라이언트가
// 자기 로컬 편집을 sync 전에 정리하므로 정상 상태에선 훼손이 전파되지 않는다(D5 근거).
// R1) 부분 삭제 잔존물 내부 타이핑은 $from.marks() textOffset 분기(prosemirror-model
//     dist:950-951)가 inclusive 무관하게 mark를 상속 → 잔존물 자체를 없애는 것이 근본 수정.
// R2) mark가 선택보다 넓게 걸친 marked 공백 → Rule A가 발생원 제거.
// R3) DOM-변이 삭제가 storedMarks에 link를 주입(prosemirror-view dist:5173-5176) → Rule C.

// 미러 판정 — autolink와 동일한 linkifyjs로 판정한다.
// 텍스트 전체가 단일 URL/이메일 매치이고 linkify 정규 href가 mark href와 일치할 때만 미러.
// email(user@x.com ↔ mailto:user@x.com)·www(→http:// 보강)는 미러로 잡히고,
// 스킴을 명시한 수동 라벨(텍스트 https://x.com, href http://x.com)은 미러가 아니다.
// 무스킴 텍스트(example.com)는 linkify 기본 http://, 툴바 applyLinkValue의 normalizeLinkHref는
// https://(editorLink.js:33 → :80-83) — 이 경우만 http/https 양쪽을 미러로 인정한다(2차 P1).
function isUrlMirror(text, href) {
  if (!text || !href) return false;
  const matches = find(text);
  if (matches.length !== 1) return false;
  const m = matches[0];
  if (m.start !== 0 || m.end !== text.length) return false;
  if (m.href === href) return true;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (hasScheme) return false;
  const strip = (s) => s.replace(/^https?:\/\//i, '');
  return /^https?:\/\//i.test(href) && /^https?:\/\//i.test(m.href) && strip(href) === strip(m.href);
}

const INTEGRITY_META = 'weaveLinkIntegrity'; // 자기 재진입 가드 — 이 플러그인이 만든 tr 표식

function linkIntegrityPlugin() {
  return new Plugin({
    key: new PluginKey('weaveLinkIntegrity'),
    appendTransaction: (transactions, oldState, newState) => {
      // 자기 자신이 만든 정리 트랜잭션에는 재반응하지 않는다(무한 append 방지).
      if (transactions.some((t) => t.getMeta(INTEGRITY_META))) return null;

      const linkType = newState.schema.marks.link;
      // Rule C: storedMarks에서 link만 제거하고 **나머지(bold 등)는 보존**. removeMark(addStep)가
      // tr.storedMarks를 null로 리셋하므로(실측: 실제 link removeMark 후 storedMarks===null),
      // setStoredMarks는 맨 마지막에 적용한다. **복원 조건은 storedLink 유무가 아니라
      // storedMarks 존재 자체**(14차 P1: storedMarks=[bold]·link 없음인데 Rule A/B가 문서 link를
      // 지우면 storedLink=null이라 복원 안 돼 bold까지 null로 소실됐다).
      const hadStoredMarks = newState.storedMarks !== null;
      const nextStored = hadStoredMarks
        ? newState.storedMarks.filter((m) => m.type !== linkType)
        : null;
      // link가 storedMarks에 실제로 있는가 — 이게 있거나 removals가 있을 때만 tr을 만든다.
      const storedHasLink = hadStoredMarks && nextStored.length !== newState.storedMarks.length;

      const docChanged = transactions.some((t) => t.docChanged) && !oldState.doc.eq(newState.doc);
      // D5=A: 원격(y-sync) 트랜잭션은 정리하지 않는다(발생 클라가 로컬에서 이미 정리).
      // 원격 판별은 sync-plugin이 심는 ySyncPluginKey 메타(sync-plugin.js:465) — 문자열 아님(8차 P1).
      const isRemote = transactions.some((t) => t.getMeta(ySyncPluginKey));

      const removals = [];
      if (docChanged && !isRemote) {
        // 로컬 증분: 위치 역매핑으로 정체성 정확.
        // preventAutolink(setLink/unsetLink 등, dist:340·354)는 Rule B만 스킵(팝오버 href 변경 보호).
        // Rule A는 무조건 — unsetLink 직후의 공백 잔존 정리가 필요.
        const intentionalLinkOp = transactions.some((t) => t.getMeta('preventAutolink'));
        const transform = combineTransactionSteps(oldState.doc, [...transactions]);
        const changes = getChangedRanges(transform);
        const invert = transform.mapping.invert();
        // 순수 삭제 트랜잭션인가 — ReplaceStep이면서 삽입 슬라이스가 비어 있어야 한다(11차 P1).
        // 부분수열만으론 '삭제만'을 증명 못 한다(example→e 교체도 부분수열) — 이 검사가 1차 계약.
        const isDeletionOnly = transform.steps.length > 0
          && transform.steps.every((st) => st instanceof ReplaceStep && st.slice.size === 0);
        const seen = new Set();
        changes.forEach(({ newRange }) => {
          const from = Math.max(0, newRange.from - 1);
          const to = Math.min(newState.doc.content.size, newRange.to + 1);
          newState.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isText) return;
            const mark = linkType.isInSet(node.marks);
            if (!mark) return;
            const range = getMarkRange(newState.doc.resolve(pos + 1), linkType, mark.attrs);
            if (!range) return;
            const rkey = `${range.from}:${range.to}`;
            if (seen.has(rkey)) return;
            seen.add(rkey);
            const text = newState.doc.textBetween(range.from, range.to);
            if (!text.trim()) { removals.push(range); return; }            // Rule A
            if (intentionalLinkOp) return;
            if (isUrlMirror(text, mark.attrs.href)) return;
            // Rule B: '단일 old 미러가 **삭제로** 깨져 비미러가 된' run만 해제(계약 D1).
            //  1차 = isDeletionOnly(트랜잭션이 순수 삭제 ReplaceStep만인가) — 삽입 포함 편집
            //        (타이핑·선택교체·인접 링크 삽입 병합)은 링크 유지.
            //  2차 = **역매핑 containment** — 삽입이 없으므로 새 run의 생존 문자는 모두 old doc에서
            //        왔다. 그 투영이 **하나의 old 미러 범위 안에 완전히 포함**될 때만 '그 미러의
            //        부분삭제'다. 병합(사이 공백/문자 삭제로 옆 라벨과 합쳐짐)은 투영이 미러를
            //        벗어나므로 배제 — 정당 라벨 보호(12차 P1: 부분수열 가드는 병합 결과가 우연히
            //        부분수열이면(예 ".com"+공백 삭제 → "https://examplecom") 옆 라벨까지 해제됨).
            if (!isDeletionOnly) return;
            const oldFrom = invert.map(range.from, 1);
            const oldTo = invert.map(range.to, -1);
            if (oldFrom < 0 || oldTo > oldState.doc.content.size || oldTo <= oldFrom) return;
            const oldRange = getMarkRange(oldState.doc.resolve(Math.min(oldFrom + 1, oldState.doc.content.size)), linkType, mark.attrs);
            if (!oldRange) return;                                          // 이전에 같은 링크 없음 → 불간섭
            if (oldFrom < oldRange.from || oldTo > oldRange.to) return;     // 병합 등 — 미러 범위 밖 → 불간섭
            if (isUrlMirror(oldState.doc.textBetween(oldRange.from, oldRange.to), mark.attrs.href)) {
              removals.push(range);
            }
          });
        });
      }

      // 할 일이 없으면 tr을 만들지 않는다(불필요한 트랜잭션·append 루프 방지):
      //  - removals 없음 AND storedMarks에 link 없음 → return null.
      // 그 외엔 tr을 만들고, storedMarks가 있었다면 nextStored로 복원한다 — removeMark(addStep)가
      // storedMarks를 null로 리셋하므로 removals가 있으면 bold 등 비링크분도 재적용해야 보존된다.
      if (!removals.length && !storedHasLink) return null;
      const tr = newState.tr.setMeta(INTEGRITY_META, true);
      removals.forEach(({ from, to }) => tr.removeMark(from, to, linkType));   // 문서 mark 제거 먼저
      if (hadStoredMarks) tr.setStoredMarks(nextStored);                       // link 제외분 복원(맨 마지막)
      return tr;
    },
  });
}

const WeaveLink = Link.extend({
  inclusive: false,
  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), linkIntegrityPlugin()];
  },
});

export default WeaveLink;
