export const BASE = '81ad606';
export const FILES = { T: { rel: 'styles/components/track/track.scss', blob: 'dd2b8810a9ce3ef83660bbab91ea79bde810605b' },
  S: { rel: 'styles/components/track/trackSettings.scss', blob: 'aac357009553210d22e6becb6189599de1b94c6a' },
  X: { rel: 'styles/components/track/tracksIndex.scss', blob: 'bc54e5417c1f8afab658f963cfa9711414445509' } };
export const COUNTS = { conversions: 109, changedDecls: 103, newDecls: 27, newRules: 22, residual: 62, rawLiterals: 157, processedLiterals: 95, allowIds: 18 };
export const DARK_DECL_COUNTS = { T: 26, X: 1, S: 0 };   // 검수 §3
export const GROUP_STAGE = { F:3,H:3,I:3,J:3,K:3,L:3,M:3,N:3,O:3,U:3, A:4,B:4,C:4,D:4,G:4,Q:4,R:4,S:4,T:4, E:5,P:5 };
const L = (token) => ({ t: 'lit', token });
const C = (f, l, k, from, to, ident, group) => ({ id: `${f}${l}`, f, l, k, from, to, group, stage: GROUP_STAGE[group],
  ident: ident.t === 'lit' ? { ...ident, literal: ident.literal ?? from } : ident });
const CARD = 'var(--track-card)';
export const CONVERSIONS = [
  ...[267,481,611,618,635,746,927,953,1072,1100,1133,1569,1877,2063,2086,2397,2433].map((l) => C('T', l, 'lit', '#FFFFFF', CARD, L('--track-card'), 'A')),
  ...[901,1939,2301,2529].map((l) => C('T', l, 'lit', '#FFFFFF', CARD, L('--track-card'), 'B')), C('X', 44, 'lit', '#FFFFFF', CARD, L('--track-card'), 'B'),
  C('T', 318, 'lit', '#FFFFFF', '$color-input-bg', L('--color-input-bg'), 'C'),
  ...[28,119,167,227].map((l) => C('X', l, 'lit', '#FFFFFF', '$color-input-bg', L('--color-input-bg'), 'C')),
  C('T', 720, 'lit', 'rgba(255,255,255,0.86)', 'color-mix(in srgb, var(--track-card) 86%, transparent)', { t: 'smoke' }, 'D'),
  C('T', 1267, 'lit', 'rgba(255,255,255,0.5)', 'color-mix(in srgb, var(--track-card) 50%, transparent)', { t: 'smoke' }, 'D'),
  C('T', 989, 'lit', 'rgba(255,255,255,0.4)', 'color-mix(in srgb, var(--track-card) 40%, transparent)', { t: 'smoke' }, 'E'),
  C('T', 1916, 'lit', '#FFFFFF', CARD, L('--track-card'), 'E'), C('T', 2111, 'lit', '#FFFFFF', CARD, L('--track-card'), 'E'),
  C('T', 2379, 'lit', '#FFFFFF', CARD, L('--track-card'), 'F'), C('T', 2382, 'lit', '#FFFFFF', CARD, L('--track-card'), 'F'), C('X', 219, 'lit', '#FFFFFF', CARD, L('--track-card'), 'F'),
  ...[1421,1830,2501,2735].map((l) => C('T', l, 'lit', '#FFFFFF', '$color-text-inverse', L('--color-text-inverse'), 'G')),
  C('X', 288, 'lit', '#FFFFFF', '$color-text-inverse', L('--color-text-inverse'), 'G'),
  C('S', 254, 'lit', '#fff', '$color-text-inverse', L('--color-text-inverse'), 'G'),
  ...[[847,13],[858,14],[1768,15],[2170,16],[2707,17]].map(([l, id]) => C('T', l, 'txt', 'var(--text-tertiary, #9ca3af)', 'var(--color-text-tertiary)', { t: 'allow', id }, 'H')),
  C('T', 1207, 'txt', 'var(--text-secondary, #6b7280)', 'var(--color-text-secondary)', { t: 'lit', literal: '#6b7280', token: '--color-text-secondary' }, 'H'),
  ...[2312,2539].map((l) => C('T', l, 'lit', 'rgba(28,28,28,0.32)', 'var(--color-backdrop)', L('--color-backdrop'), 'I')),
  C('X', 55, 'lit', 'rgba(28,28,28,0.32)', 'var(--color-backdrop)', L('--color-backdrop'), 'I'),
  C('T', 586, 'tint', '94,106,210', 'color-mix(in srgb, var(--color-primary) {P}%, transparent)', { t: 'smoke' }, 'J'),
  C('T', 602, 'tint', '28,28,28', 'color-mix(in srgb, var(--color-text) {P}%, transparent)', { t: 'smoke' }, 'J'),
  ...[327,666,708,1080,1330,1383,1557,1740,2089,2092,2219].map((l) => C('T', l, 'tint', '94,106,210', 'color-mix(in srgb, var(--color-primary) {P}%, transparent)', { t: 'smoke' }, 'K')),
  C('X', 178, 'tint', '94,106,210', 'color-mix(in srgb, var(--color-primary) {P}%, transparent)', { t: 'smoke' }, 'K'),
  C('T', 434, 'lit', '#5E6AD2', '$color-primary', L('--color-primary'), 'L'),
  ...[741,1870].map((l) => C('T', l, 'lit', '#5E6AD2', 'var(--color-primary)', L('--color-primary'), 'L')), C('X', 206, 'lit', '#5E6AD2', 'var(--color-primary)', L('--color-primary'), 'L'),
  ...[386,2211,1911,1912].map((l) => C('T', l, 'tint', '220,38,38', 'color-mix(in srgb, var(--color-error) {P}%, transparent)', { t: 'smoke' }, 'M')),
  C('T', 824, 'lit', '#FEE2E2', '$color-error-bg', { t: 'allow', id: 1 }, 'M'), C('T', 825, 'lit', '#DC2626', '$color-error', L('--color-error'), 'M'),
  C('T', 454, 'lit', '#16A34A', '$color-success', L('--color-success'), 'N'), C('T', 2473, 'lit', '#16A34A', '$color-success', L('--color-success'), 'N'),
  C('T', 455, 'tint', '22,163,74', 'color-mix(in srgb, var(--color-success) {P}%, transparent)', { t: 'smoke' }, 'N'),
  C('T', 2215, 'lit', 'rgba(245,158,11,0.1)', '$color-warning-bg', { t: 'allow', id: 2 }, 'O'),
  C('T', 2442, 'lit', 'rgba(245,158,11,0.08)', '$color-warning-bg', { t: 'allow', id: 3 }, 'O'),
  C('T', 2443, 'tint', '245,158,11', 'color-mix(in srgb, var(--color-warning) {P}%, transparent)', { t: 'allow', id: 4 }, 'O'),
  C('T', 2216, 'lit', '#B45309', 'var(--color-warning-ink)', L('--color-warning-ink'), 'O'),
  C('T', 2450, 'lit', '#92400E', 'var(--color-warning-ink-deep)', L('--color-warning-ink-deep'), 'O'),
  C('T', 2451, 'lit', '#D97706', '$color-warning', L('--color-warning'), 'O'),
  C('T', 2452, 'lit', '#78350F', 'var(--color-warning-ink-strong)', L('--color-warning-ink-strong'), 'O'),
  ...[[984,7],[985,7],[2106,8],[2107,8]].map(([l, id]) => C('T', l, 'lit', 'rgba(0,0,0,0.025)', 'color-mix(in srgb, var(--color-text) 2.5%, transparent)', { t: 'allow', id }, 'P')),
  ...[[411,9],[2055,10],[2426,11]].map(([l, id]) => C('T', l, 'lit', 'rgba(0,0,0,0.04)', 'color-mix(in srgb, var(--color-text) 4%, transparent)', { t: 'allow', id }, 'Q')),
  C('X', 247, 'lit', 'rgba(0,0,0,0.04)', 'color-mix(in srgb, var(--color-text) 4%, transparent)', { t: 'allow', id: 12 }, 'Q'),
  C('S', 216, 'lit', 'rgba(0,0,0,0.12)', '$color-input-border', { t: 'allow', id: 5 }, 'R'),
  C('S', 309, 'lit', 'rgba(0,0,0,0.12)', '$color-input-border', { t: 'allow', id: 6 }, 'R'),
  ...[319,549,612,636,929,1102,1411,1519,2396,2491,2728].map((l) => C('T', l, 'txt', '$track-border', '$color-input-border', { t: 'alias', from: '--track-border', token: '--color-input-border' }, 'S')),
  ...[410,2054,2425].map((l) => C('T', l, 'txt', '$track-ink-mute', '$color-text-secondary', { t: 'alias', from: '--track-ink-mute', token: '--color-text-secondary' }, 'T')),
  // U. 우선순위 '낮음' 뱃지 — 형제 3종(urgent/high/medium)과 같은 규칙으로 통일(사용자 결정).
  //    글자색은 이미 $track-ink-soft 토큰이므로 배경 틴트도 같은 계열로: 라이트 #9CA3AF@16% → #4B5563@16%(allow #18)
  C('T', 2223, 'lit', 'rgba(156,163,175,0.16)', 'color-mix(in srgb, var(--track-ink-soft) 16%, transparent)', { t: 'allow', id: 18 }, 'U'),
];
export const ANNOTATIONS = [   // 검수 §1: 고유 marker + BASE 원문 줄 exact anchor
  { f: 'T', l: 201,  marker: '[S4:T201]',  anchor: 'rgba(255,255,255,0.96)',
    text: '  // [S4:T201] on-accent 고정(런타임 데이터색 배경 — 테마 불변. S7 dynamic on-color 접근성 부채)' },
  { f: 'T', l: 2399, marker: '[S4:T2399]', anchor: '#FFFFFF',
    text: '  // [S4:T2399] on-accent 고정(런타임 데이터색 배경 — 테마 불변. S7 dynamic on-color 접근성 부채)' },
  { f: 'X', l: 147,  marker: '[S4:X147]',  anchor: '#FFFFFF',
    text: '  // [S4:X147] on-accent 고정(고정 preset accent 배경 — 테마 불변. S7 dynamic on-color 접근성 부채)' },
  { f: 'X', l: 228,  marker: '[S4:X228]',  anchor: '#FFFFFF',
    text: '  // [S4:X228] on-accent 고정(런타임 데이터색 배경 — 테마 불변. S7 dynamic on-color 접근성 부채)' },
];
// 검수 §4: 정적 smoke manifest — Task 0가 관측값을 채우기 전에 이름·필수 selector·액션·허용 영역이 먼저 고정된다.
// bundle 엔드포인트는 추정하지 않고 Task 0가 실제 관측한 요청 집합을 context에 동결(검수 §5).
// coverage 정본: 23 surface가 커버 대상 53 selector(= NEW branch ∪ smoke-light/allow CHANGED).
// ⚠️ token-identity 변환은 문자열 동일성으로 증명되므로 시각 증거 대상이 아니다 → coverage에 넣지 않는다.
// 런타임 전제(존재만 확인)는 requiredElements로 분리한다(오버라이드 branch + smoke-light/allow 변경 선언, dead 3종 제외)를
// 빠짐없이 덮는다. 상태 의존 19종은 각각 그 상태를 만드는 action(provenBy)을 갖는다.
// coverage key 규칙: hover/focus는 `selector:state`, --on/--active/--open/--selected는 selector 자체.
// 라이트 픽셀 비교 마스크 — allow ID → paint 영역 selector(dead #3·#4·#6·#11은 화면에 없어 제외).
// s4PixelDiff.mjs가 이 상수를 import한다(단일 원천). specFingerprint에도 포함된다.
export const LIGHT_DIFF_MASKS = {
  1: '.TrackNode__PrioFlag', 2: '.TrackTree__Priority--high', 5: '.SettingsBranches__Swatch--active',
  7: '.TrackNode--restricted', 8: '.TrackTree__Row--restricted', 9: '.SourcePicker__BranchKey',
  10: '.TrackTree__GroupKey', 12: '.CreateTrack__BranchKey', 13: '.TrackNode__ParentChip',
  14: '.TrackNode__SubProgress', 15: '.TrackTimeline__LaneParentChip', 16: '.TrackTree__ParentChip',
  17: '.BulkAdd__TaskParentChip', 18: '.TrackTree__Priority--low',
};
export const REQUIRED_SMOKE_SURFACES = [
  { name: "canvas", captureName: "canvas.png",
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "waitFor", selector: ".TrackNode--restricted", state: "visible" }],
    requiredElements: [".TrackNode"],
    coverageSelectors: [{ selector: ".TrackCanvas" }, { selector: ".TrackNode--restricted" }, { selector: ".TrackCanvas__Vignette" }, { selector: ".Track::before", locator: { selector: ".Track", pseudo: "::before" } }, { selector: ".TrackCanvas__Legend" }, { selector: ".TrackNode__ParentChip" }, { selector: ".TrackNode__SubProgress" }, { selector: ".TrackNode__PrioFlag" }, { selector: ".TrackEdgeLabel__Badge" }, { selector: ".TrackEdgeLabel__Badge--draft" }, { selector: ".TrackEdgeLabel__Badge--rel" }, { selector: ".TrackHeader__WeaveBar" }, { selector: ".TrackHeader__ViewBtn--active", state: "selected", provenBy: 0 }],
    darkReviewSelectors: [".TrackCanvas__Vignette", ".Track::before", ".TrackNode--restricted"] },   // 다크 육안 검토 대상(비교 baseline 없음)
  // 실측: edgeType 기본값 flow_to → nth:0 버튼이 진입 시 이미 --active. nth:0 클릭은 무전이라 항상 통과(위양성).
  //   실제 전이를 만들도록 title로 대상을 지정한다. 전환 후 MatToggle이 disabled가 되므로 mat surface와 분리 유지.
  { name: "canvas-toolbar-active", captureName: "canvas-toolbar-active.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "click", selector: ".TrackCanvas__ToolbarBtn[title='Relates to']", nth: 0 },
      { op: "expectPresent", selector: ".TrackCanvas__ToolbarBtn--active[title='Relates to']" }],
    coverageSelectors: [{ selector: ".TrackCanvas__ToolbarBtn--active", state: "selected", provenBy: 2,
      produces: ".TrackCanvas__ToolbarBtn--active[title='Relates to']" }],
    darkReviewSelectors: [".TrackCanvas__ToolbarBtn--active"] },
  // 실측: materializeOnCreate 기본값이 true(TrackDetail.js:79)이고 영속화되지 않는다 → 진입 시 이미 --on.
  //   클릭 1회는 ON→OFF라 캡처 시 --on이 0건이 된다. 왕복(OFF→ON)으로 전이를 증명하면서 --on을 남긴다.
  { name: "canvas-matpill-on", captureName: "canvas-matpill-on.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "expectPresent", selector: ".TrackCanvas__MatPill--on" },          // 진입 시 이미 ON
      { op: "click", selector: ".TrackCanvas__MatToggle", nth: 0 },
      { op: "expectAbsent", selector: ".TrackCanvas__MatPill--on" },           // 중간 OFF 단정(클릭 무효 검출)
      { op: "click", selector: ".TrackCanvas__MatToggle", nth: 0 },
      { op: "expectPresent", selector: ".TrackCanvas__MatPill--on" }],
    coverageSelectors: [{ selector: ".TrackCanvas__MatPill--on", state: "selected", provenBy: 5,
      produces: ".TrackCanvas__MatPill--on" }],
    darkReviewSelectors: [".TrackCanvas__MatPill--on"] },
  { name: "sourcepicker", captureName: "sourcepicker.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "waitFor", selector: ".SourcePicker__BranchRow", state: "visible" }],
    coverageSelectors: [{ selector: ".SourcePicker__BranchKey" }, { selector: ".SourcePicker__Group" }, { selector: ".SourcePicker__GroupHint" }],
    darkReviewSelectors: [".SourcePicker__BranchKey", ".SourcePicker__GroupHint"] },
  { name: "sourcepicker-branch-hover", captureName: "sourcepicker-branch-hover.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "hover", selector: ".SourcePicker__BranchRow", nth: 0 }],
    coverageSelectors: [{ selector: ".SourcePicker__BranchRow", state: "hover", provenBy: 2 }],
    darkReviewSelectors: [".SourcePicker__BranchRow"] },
  { name: "sourcepicker-group-hover", captureName: "sourcepicker-group-hover.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "hover", selector: ".SourcePicker__GroupRow", nth: 0 }],
    coverageSelectors: [{ selector: ".SourcePicker__GroupRow", state: "hover", provenBy: 2 }],
    darkReviewSelectors: [".SourcePicker__GroupRow"] },
  { name: "sourcepicker-task-hover", captureName: "sourcepicker-task-hover.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "hover", selector: ".SourcePicker__Task", nth: 0 }],
    coverageSelectors: [{ selector: ".SourcePicker__Task", state: "hover", provenBy: 2 }],
    darkReviewSelectors: [".SourcePicker__Task"] },
  { name: "sourcepicker-unparticipate-hover", captureName: "sourcepicker-unparticipate-hover.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "hover", selector: ".SourcePicker__BranchRow", nth: 0 },
      { op: "hover", selector: ".SourcePicker__BranchUnparticipate", nth: 0 }],
    coverageSelectors: [{ selector: ".SourcePicker__BranchUnparticipate", state: "hover", provenBy: 3 }],
    darkReviewSelectors: [".SourcePicker__BranchUnparticipate"] },
  { name: "sourcepicker-search-focus", captureName: "sourcepicker-search-focus.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "click", selector: ".SourcePicker__SearchInput", nth: 0 }],
    coverageSelectors: [{ selector: ".SourcePicker__SearchInput", state: "focus", provenBy: 2 }],
    darkReviewSelectors: [".SourcePicker__SearchInput"] },
  { name: "sourcepicker-addmenu-open", captureName: "sourcepicker-addmenu-open.png",
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "hover", selector: ".SourcePicker__AddBtn", nth: 0 },
      { op: "click", selector: ".SourcePicker__AddBtn", nth: 0 }],
    coverageSelectors: [{ selector: ".SourcePicker__AddBtn", state: "hover", provenBy: 2 }, { selector: ".SourcePicker__AddBtn--open", state: "selected", provenBy: 3 }],
    requiredElements: [".SourcePicker__AddMenu"],
    darkReviewSelectors: [".SourcePicker__AddMenu", ".SourcePicker__AddBtn--open"] },
  { name: "detail", captureName: "detail.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "click", selector: ".TrackNode", hasText: "{normalItemTitle}" },
      { op: "waitFor", selector: ".TrackDetail__OriginLink", state: "visible" }],
    coverageSelectors: [{ selector: ".TrackDetail__PrioPill" }, { selector: ".TrackDetail__OriginLink" }],
    darkReviewSelectors: [".TrackDetail__PrioPill"] },
  { name: "detail-originlink-hover", captureName: "detail-originlink-hover.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "click", selector: ".TrackNode", hasText: "{normalItemTitle}" },
      { op: "hover", selector: ".TrackDetail__OriginLink", nth: 0 }],
    coverageSelectors: [{ selector: ".TrackDetail__OriginLink", state: "hover", provenBy: 3 }],
    darkReviewSelectors: [".TrackDetail__OriginLink"] },
  { name: "detail-trackchip-hover", captureName: "detail-trackchip-hover.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "click", selector: ".TrackNode", hasText: "{normalItemTitle}" },
      { op: "hover", selector: ".TrackDetail__TrackChip", nth: 0 }],
    coverageSelectors: [{ selector: ".TrackDetail__TrackChip", state: "hover", provenBy: 3 }],
    darkReviewSelectors: [".TrackDetail__TrackChip"] },
  { name: "timeline", captureName: "timeline.png",
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "timeline" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "waitFor", selector: ".TrackTimeline__Bar--blocked", state: "visible" }],
    requiredElements: [".TrackTimeline__Bar"],
    coverageSelectors: [{ selector: ".TrackTimeline__Bar--blocked" }, { selector: ".TrackTimeline__Link" }, { selector: ".TrackTimeline__Link--mat" }, { selector: ".TrackTimeline__Link--rel" }, { selector: ".TrackTimeline__Links" }, { selector: ".TrackTimeline__LaneGroupCount" }, { selector: ".TrackTimeline__LaneParentChip" }],
    darkReviewSelectors: [".TrackTimeline__Bar--blocked"] },
  { name: "timeline-lane-hover", captureName: "timeline-lane-hover.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "timeline" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "hover", selector: ".TrackTimeline__LaneRow", nth: 0 }],
    coverageSelectors: [{ selector: ".TrackTimeline__LaneRow", state: "hover", provenBy: 2 }],
    darkReviewSelectors: [".TrackTimeline__LaneRow"] },
  { name: "timeline-lane-selected", captureName: "timeline-lane-selected.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "timeline" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "click", selector: ".TrackTimeline__LaneRow", nth: 0 }],
    coverageSelectors: [{ selector: ".TrackTimeline__LaneRow--selected", state: "selected", provenBy: 2 }],
    darkReviewSelectors: [".TrackTimeline__LaneRow--selected"] },
  { name: "tree", captureName: "tree.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "tree" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "waitFor", selector: ".TrackTree__Row--restricted", state: "visible" }],
    coverageSelectors: [{ selector: ".TrackTree__GroupKey" }, { selector: ".TrackTree__ParentChip" }, { selector: ".TrackTree__Priority--urgent" }, { selector: ".TrackTree__Priority--high" }, { selector: ".TrackTree__Priority--medium" }, { selector: ".TrackTree__Priority--low" }, { selector: ".TrackTree__Row--restricted" }],
    darkReviewSelectors: [".TrackTree__Row--restricted", ".TrackTree__GroupKey"] },
  { name: "tree-row-hover", captureName: "tree-row-hover.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "tree" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "hover", selector: ".TrackTree__Row", nth: 0 }],
    coverageSelectors: [{ selector: ".TrackTree__Row", state: "hover", provenBy: 2 }],
    darkReviewSelectors: [".TrackTree__Row"] },
  { name: "tree-row-selected", captureName: "tree-row-selected.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "tree" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "click", selector: ".TrackTree__Row", nth: 0 }],
    coverageSelectors: [{ selector: ".TrackTree__Row--selected", state: "selected", provenBy: 2 }],
    darkReviewSelectors: [".TrackTree__Row--selected"] },
  { name: "bulkadd", captureName: "bulkadd.png",
    requiredElements: [],
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "click", selector: ".SourcePicker__AddBtn", nth: 0 },
      { op: "click", selector: ".SourcePicker__AddMenuItem", hasText: "{addMenuEpicLabel}" },
      { op: "click", selector: ".BulkAdd__SelectControl .CustomSelect__Trigger", nth: 0 },
      { op: "click", selector: ".CustomSelect__Option", hasText: "{branchName}" },
      { op: "click", selector: ".BulkAdd__SelectControl .CustomSelect__Trigger", nth: 1 },
      { op: "click", selector: ".CustomSelect__Option", hasText: "{epicName}" },
      { op: "waitFor", selector: ".BulkAdd__Task", state: "visible" }],
    coverageSelectors: [{ selector: ".BulkAdd" }, { selector: ".BulkAdd__TaskParentChip" }],
    darkReviewSelectors: [] },
  { name: "createtrack", captureName: "createtrack.png",
    requiredElements: [],
    actions: [{ op: "goto", url: "/tracks" },
      { op: "click", selector: ".HBtn.HBtn--pri.HBtn--sm", hasText: "＋ 새 트랙" },
      { op: "waitFor", selector: ".CreateTrack__Branch", state: "visible" }],
    coverageSelectors: [{ selector: ".CreateTrack" }, { selector: ".CreateTrack__BranchKey" }],
    darkReviewSelectors: [".CreateTrack__BranchKey"] },
  { name: "createtrack-visopt-active", captureName: "createtrack-visopt-active.png",
    requiredElements: [],
    actions: [{ op: "goto", url: "/tracks" },
      { op: "click", selector: ".HBtn.HBtn--pri.HBtn--sm", hasText: "＋ 새 트랙" },
      { op: "waitFor", selector: ".CreateTrack__VisOpt", state: "visible" },
      // CreateTrack은 항상 private 상태로 마운트되므로(신규 모달) 두 번째(public) 옵션이 확정적으로 비활성이다
      { op: "expectAbsent", selector: ".CreateTrack__VisOpt:nth-of-type(2).CreateTrack__VisOpt--active" },
      { op: "click", selector: ".CreateTrack__VisOpt", nth: 1 },
      { op: "expectPresent", selector: ".CreateTrack__VisOpt:nth-of-type(2).CreateTrack__VisOpt--active" }],
    coverageSelectors: [{ selector: ".CreateTrack__VisOpt--active", state: "selected", provenBy: 4,
      produces: ".CreateTrack__VisOpt:nth-of-type(2).CreateTrack__VisOpt--active" }],
    darkReviewSelectors: [".CreateTrack__VisOpt--active"] },
  { name: "settings-branches-edit", captureName: "settings-branches-edit.png",
    requiredElements: [],
    actions: [{ op: "goto", url: "/tracks/{id}/settings" },
      { op: "click", selector: ".TrackSettings__SubTab", hasText: "Branches" },
      // 실측: .SettingsBranches__IconBtn은 Edit와 Remove(--danger)를 모두 포함한다 → title로 Edit만 좁힌다
      { op: "click", selector: ".SettingsBranches__IconBtn[title='Edit display name / color']", nth: "{editBranchIndex}" },
      // preset 인덱스를 고정 가정하지 않는다 — Task 2 preflight가 **실제 비활성 preset**을 골라 context에 동결한다
      // 실측: swatch에 aria-label={preset hex}가 있다 → nth 순번 대신 값으로 정확히 지정한다
      { op: "expectAbsent", selector: ".SettingsBranches__Swatch[aria-label='{inactivePresetValue}'].SettingsBranches__Swatch--active" },
      { op: "click", selector: ".SettingsBranches__Swatch[aria-label='{inactivePresetValue}']" },
      { op: "expectPresent", selector: ".SettingsBranches__Swatch[aria-label='{inactivePresetValue}'].SettingsBranches__Swatch--active" }],
    coverageSelectors: [{ selector: ".SettingsBranches__Swatch--active", state: "selected", provenBy: 4,
      produces: ".SettingsBranches__Swatch[aria-label='{inactivePresetValue}'].SettingsBranches__Swatch--active" }],
    darkReviewSelectors: [".SettingsBranches__Swatch--active"] },
  // allow #6(.SettingsGeneral__Swatch--active 링)의 유일한 실화면. trackSettings.scss는 _app.js에서
  // 전역 import되고 이 클래스는 Scrum 설정에서만 렌더된다 — track 설정의 .SettingsBranches__Swatch--active
  // 와는 다른 selector라 기존 surface로 대체되지 않는다(리뷰 실측, 이전 DEAD 오분류 교정).
  { name: "settings-general-swatch", captureName: "settings-general-swatch.png",
    requiredElements: [".SettingsGeneral__Swatches"],
    actions: [{ op: "goto", url: "/scrum/{scrumBoardId}/settings" },
      { op: "waitFor", selector: ".SettingsGeneral__Swatch", state: "visible" },
      { op: "expectAbsent", selector: ".SettingsGeneral__Swatch[aria-label='color {scrumInactivePreset}'].SettingsGeneral__Swatch--active" },
      { op: "click", selector: ".SettingsGeneral__Swatch[aria-label='color {scrumInactivePreset}']" },
      { op: "expectPresent", selector: ".SettingsGeneral__Swatch[aria-label='color {scrumInactivePreset}'].SettingsGeneral__Swatch--active" }],
    coverageSelectors: [{ selector: ".SettingsGeneral__Swatch--active", state: "selected", provenBy: 3,
      produces: ".SettingsGeneral__Swatch[aria-label='color {scrumInactivePreset}'].SettingsGeneral__Swatch--active" }],
    darkReviewSelectors: [".SettingsGeneral__Swatch--active"] }
];
export const OVERRIDES = {
  T: `// === 다크 오버라이드 (S4) ===
html[data-theme='dark'] {
  .Track::before {
    mix-blend-mode: screen;
    opacity: 0.3;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.9 0 0 0 0 0.9 0 0 0 0 0.9 0 0 0 0.04 0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .TrackTimeline__Links { color: rgba(148, 157, 173, 0.72); }
  .TrackTimeline__Link { stroke: rgba(148, 157, 173, 0.62); color: rgba(148, 157, 173, 0.72); }
  .TrackTimeline__Link--mat { stroke: rgba(124, 138, 234, 0.75); color: rgba(124, 138, 234, 0.85); }
  .TrackTimeline__Link--rel { stroke: rgba(148, 157, 173, 0.62); color: rgba(148, 157, 173, 0.72); }
  .ManageBranches, .BulkAdd { box-shadow: 0 0 0 1px var(--color-input-border), 0 24px 60px -16px rgba(0, 0, 0, 0.75), 0 4px 12px rgba(0, 0, 0, 0.5); }
  .TrackHeader__ViewBtn--active { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 0 0 1px var(--color-input-border-hover); }
  .SourcePicker__Task:hover { box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(255, 255, 255, 0.14); }
  .TrackEdgeLabel__Badge--draft { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22), 0 1px 2px rgba(0, 0, 0, 0.06); }
  .TrackEdgeLabel__Badge--rel { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22), 0 1px 2px rgba(0, 0, 0, 0.06); }
  .TrackNode--restricted { background: repeating-linear-gradient(135deg, rgba(230, 232, 235, 0.07) 0, rgba(230, 232, 235, 0.07) 6px, transparent 6px, transparent 12px), color-mix(in srgb, var(--track-card) 40%, transparent); }
  .TrackTree__Row--restricted { background: repeating-linear-gradient(135deg, rgba(230, 232, 235, 0.07) 0, rgba(230, 232, 235, 0.07) 4px, transparent 4px, transparent 10px), var(--track-card); }
  .TrackTimeline__Bar--blocked { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-error) 14%, transparent) 0, color-mix(in srgb, var(--color-error) 14%, transparent) 4px, transparent 4px, transparent 9px), var(--track-card); }
  .TrackHeader__WeaveBar { border-color: rgba(255, 255, 255, 0.06); }
  .SourcePicker__BranchRow:hover { background: rgba(255, 255, 255, 0.04); }
  .SourcePicker__Group { border-left-color: rgba(255, 255, 255, 0.10); }
  .SourcePicker__GroupRow:hover { background: rgba(255, 255, 255, 0.04); }
  .TrackDetail__OriginLink { background: rgba(255, 255, 255, 0.04); }
  .SourcePicker__AddBtn:hover { background: rgba(255, 255, 255, 0.05); }
  .TrackTimeline__LaneGroupCount { background: rgba(255, 255, 255, 0.05); }
  .TrackTimeline__LaneRow:hover { background: rgba(255, 255, 255, 0.03); }
}`,
  X: `// === 다크 오버라이드 (S4) ===
html[data-theme='dark'] {
  .CreateTrack { box-shadow: 0 0 0 1px var(--color-input-border), 0 24px 60px -16px rgba(0, 0, 0, 0.75), 0 4px 12px rgba(0, 0, 0, 0.5); }
}`,
};
// 실제 CSS 스택(실측). expect 하드코딩 없음 — Task 2가 계산해 fixture에 동결, 계약은 min.
// 참고치(외부 검수 측정): Source 6.184/5.513 · Tree 6.607/6.883 · Create 6.031/5.810 · Manage(dead) 6.031/4.792
export const CONTRAST_CASES = [
  { name: 'SourcePicker BranchKey normal', text: '--color-text-secondary', min: 4.5,
    stack: [{ gradient: ['--track-paper-raised-05', '--track-paper'] }, { mix: '--color-text', pct: 4 }] },
  { name: 'SourcePicker BranchKey hover', text: '--color-text-secondary', min: 4.5,
    stack: [{ gradient: ['--track-paper-raised-05', '--track-paper'] }, { raw: 'rgba(255,255,255,0.04)' }, { mix: '--color-text', pct: 4 }] },
  { name: 'TrackTree GroupKey normal', text: '--color-text-secondary', min: 4.5,
    stack: [{ token: '--track-paper-sunken-1' }, { mix: '--color-text', pct: 4 }] },
  { name: 'TrackTree GroupKey hover', text: '--color-text-secondary', min: 4.5,
    stack: [{ token: '--track-paper-sunken-2' }, { mix: '--color-text', pct: 4 }] },
  { name: 'CreateTrack BranchKey normal', text: '--color-text-secondary', min: 4.5,
    stack: [{ token: '--track-card' }, { mix: '--color-text', pct: 4 }] },
  { name: 'CreateTrack BranchKey hover', text: '--color-text-secondary', min: 4.5,
    stack: [{ token: '--track-card' }, { token: '--color-surface-hover' }, { mix: '--color-text', pct: 4 }] },
  { name: 'ManageBranches BranchKey normal', text: '--color-text-secondary', min: 4.5, dead: true,
    stack: [{ token: '--track-card' }, { mix: '--color-text', pct: 4 }] },
  { name: 'ManageBranches BranchKey hover', text: '--color-text-secondary', min: 4.5, dead: true,
    stack: [{ token: '--track-card' }, { token: '--track-border-soft' }, { mix: '--color-text', pct: 4 }] },
];
