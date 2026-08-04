export const BASE = '81ad606';
export const FILES = { T: { rel: 'styles/components/track/track.scss', blob: 'dd2b8810a9ce3ef83660bbab91ea79bde810605b' },
  S: { rel: 'styles/components/track/trackSettings.scss', blob: 'aac357009553210d22e6becb6189599de1b94c6a' },
  X: { rel: 'styles/components/track/tracksIndex.scss', blob: 'bc54e5417c1f8afab658f963cfa9711414445509' } };
// ManageBranches(죽은 컴포넌트) 3건을 범위에서 제외한 결과. 예측 = 변환 -3 · changed -3 · residual +3
// · processed -3 · allow -3 이고 실측이 정확히 일치했다(actual에 맞춘 사후 갱신이 아니라 예측 검증).
// ManageBranches 범위 제외는 newDecls/newRules에 영향이 없었다 — override 줄을
// `.ManageBranches, .BulkAdd` → `.BulkAdd`로 좁혔을 뿐 규칙 수는 같았다.
// 이후 cascade 수정에서 `.TrackDetail__OriginLink:hover`가 추가돼 newDecls 28 / newRules 23이 됐다.
// raster 계약 정본 — "PNG 크기 == context.viewport" 자기정합만 보면 둘을 함께 2880x1800으로
// 바꿔도 통과한다. 고정 스모크 환경이므로 값을 여기에 못박고 parsed context·PNG IHDR·DPR·
// screenshotScale을 각각 **이 상수와** 대조한다.
// 측정 코드의 신원 — s4DomProbe.mjs의 PROBE_SOURCE 바이트 해시. 측정 방식이 바뀌면
// (예: parentElement를 재도록 고치면) 동결된 좌표의 의미가 달라지므로 fingerprint를 흔들어야 한다.
// 값은 s4-gen이 실제 소스에서 계산해 대조한다(여기에 하드코딩하지 않는다).
export const PROBE_CONTRACT = { module: 'library/s4DomProbe.mjs', export: 'PROBE_SOURCE' };
export const RASTER_CONTRACT = { width: 1440, height: 900, dpr: 1, screenshotScale: 'css' };
export const COUNTS = { conversions: 106, changedDecls: 100, newDecls: 28, newRules: 23, residual: 65, rawLiterals: 157, processedLiterals: 92, allowIds: 15 };
export const DARK_DECL_COUNTS = { T: 27, X: 1, S: 0 };   // 검수 §3
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
  C('T', 2216, 'lit', '#B45309', 'var(--color-warning-ink)', L('--color-warning-ink'), 'O'),
  C('T', 2450, 'lit', '#92400E', 'var(--color-warning-ink-deep)', L('--color-warning-ink-deep'), 'O'),
  C('T', 2451, 'lit', '#D97706', '$color-warning', L('--color-warning'), 'O'),
  C('T', 2452, 'lit', '#78350F', 'var(--color-warning-ink-strong)', L('--color-warning-ink-strong'), 'O'),
  ...[[984,7],[985,7],[2106,8],[2107,8]].map(([l, id]) => C('T', l, 'lit', 'rgba(0,0,0,0.025)', 'color-mix(in srgb, var(--color-text) 2.5%, transparent)', { t: 'allow', id }, 'P')),
  ...[[411,9],[2055,10]].map(([l, id]) => C('T', l, 'lit', 'rgba(0,0,0,0.04)', 'color-mix(in srgb, var(--color-text) 4%, transparent)', { t: 'allow', id }, 'Q')),
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
// coverage 정본 — 두 숫자를 **혼동하지 말 것**:
//   현재 target : 23 surfaces / coverage 54 / capture 23 (+ required elements 4 · actions 94 · allow IDs 15)
//   legacy      : `__fixtures__/s4-shots/base/`의 PNG 24개 = **promotion 전 legacy baseline**.
//                 현재 target이 아니고, 차이는 sourcepicker.png 1개다(canvas와 같은 화면이라 통합됨).
// 위 6개는 기계 확인값이며 themeTokens.test.js의 '계약 숫자' describe가 실행 값과 대조한다.
// ⚠️ token-identity 변환은 문자열 동일성으로 증명되므로 시각 증거 대상이 아니다 → coverage에 넣지 않는다.
// 런타임 전제(존재만 확인)는 requiredElements로 분리한다(오버라이드 branch + smoke-light/allow 변경 선언)를
// 빠짐없이 덮는다. 상태 의존 19종은 각각 그 상태를 만드는 action(provenBy)을 갖는다.
// coverage key 규칙: hover/focus는 `selector:state`, --on/--active/--open/--selected는 selector 자체.
// 라이트 픽셀 비교 마스크 — allow ID → { selector, paintOutsetPx } 정본.
//  · selector는 그 allow ID가 붙은 **변경 선언의 selector와 정확히 일치**해야 한다(validateMaskContract가 강제).
//  · paintOutsetPx = 변경되는 paint가 border box 밖으로 나가는 거리(CSS px, transform 적용 **전**).
//    background/color 변경은 박스 안이라 0. box-shadow spread 변경만 바깥으로 나간다.
//    실제 마스크 = borderRect 를 (paintOutsetPx × 그 시점 transform scale) 만큼 사방 확장한 rect.
//  · 여기 키 집합은 CONVERSIONS의 allow ID 집합과 **exact 일치**해야 한다(예외 개념 없음).
// s4PixelDiff.mjs가 이 상수를 import한다(단일 원천). specFingerprint에도 포함된다.
export const LIGHT_DIFF_MASKS = {
  1:  { selector: '.TrackNode__PrioFlag',              paintOutsetPx: 0  },
  2:  { selector: '.TrackTree__Priority--high',        paintOutsetPx: 0  },
  5:  { selector: '.SettingsBranches__Swatch--active', paintOutsetPx: 3  },  // box-shadow 0 0 0 3px
  6:  { selector: '.SettingsGeneral__Swatch--active',  paintOutsetPx: 3  },  // box-shadow 0 0 0 3px
  7:  { selector: '.TrackNode--restricted',            paintOutsetPx: 0  },
  8:  { selector: '.TrackTree__Row--restricted',       paintOutsetPx: 0  },
  9:  { selector: '.SourcePicker__BranchKey',          paintOutsetPx: 0  },
  10: { selector: '.TrackTree__GroupKey',              paintOutsetPx: 0  },
  12: { selector: '.CreateTrack__BranchKey',           paintOutsetPx: 0  },
  13: { selector: '.TrackNode__ParentChip',            paintOutsetPx: 0  },
  14: { selector: '.TrackNode__SubProgress',           paintOutsetPx: 0  },
  15: { selector: '.TrackTimeline__LaneParentChip',    paintOutsetPx: 0  },
  16: { selector: '.TrackTree__ParentChip',            paintOutsetPx: 0  },
  17: { selector: '.BulkAdd__TaskParentChip',          paintOutsetPx: 0  },
  18: { selector: '.TrackTree__Priority--low',         paintOutsetPx: 0  },
};


// (surface, selector)별 **실측** 유효 배율. selector 전역값이 아니다 —
// 같은 selector가 화면에 따라 다른 좌표계에 놓인다(캔버스 노드 0.5 vs 트리 행 1).
//
// 왜 이 표가 필요한가: 이전 판은 LIGHT_DIFF_MASKS에 selector당 하나의 `expectedScale`을 뒀고
// (그 필드는 지금 존재하지 않는다 — 현행 정본은 아래 ELEMENT_SCALES의 (surface, selector) 셀이고,
//  잔존 여부는 validateMaskContract의 MASK_EXPECTED_SCALE_OBSOLETE가 잡는다)
// 캔버스 4개 selector를 전부 `1`로 선언했다. 실측은 **0.5**다(committed probe로 24화면 측정).
// paintRect = borderRect ⊕ (outset × scale) 이므로 배율이 틀리면 outset>0인 마스크가 실제와
// 다른 크기로 확장된다. 게다가 selector 전역 선언은 "한 화면에서만 맞으면 통과"라 구조적으로
// 틀린 값을 감췄다.
//
// 0.5의 출처: 캔버스는 React Flow `fitView`(fitViewOptions maxZoom 1.1)를 쓰고, 합성 데이터셋의
// 그래프가 충분히 커서 fit 요구 배율이 React Flow 기본 `minZoom`(0.5)에 **클램프**된다.
// 즉 설계 상수가 아니라 (spec, 데이터셋) 공동의 산물이다. 데이터셋이 작아져 클램프가 풀리면
// 이 표가 깨지고 재동결을 요구한다 — 의도된 동작이다.
//
// 검증 계약(s4Evaluator.validateMaskContract):
//   - 이 표의 (surface, selector) 키 집합 == context에서 occurrence가 1건 이상인 셀 집합 (양방향)
//   - occurrence의 scale == 이 표의 값
//   - occurrence 내부에서 두 독립 파생(rect/borderBox vs transform 행렬 곱)이 서로 일치
// 이 표 자체는 오라클이 아니라 **동일성 고정(fingerprint)** 이다. 오라클은 세 번째 항목이다.
export const ELEMENT_SCALES = {
  'canvas': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'canvas-toolbar-active': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'canvas-matpill-on': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'sourcepicker-branch-hover': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'sourcepicker-group-hover': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'sourcepicker-task-hover': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'sourcepicker-unparticipate-hover': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'sourcepicker-search-focus': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'sourcepicker-addmenu-open': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'detail': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'detail-originlink-hover': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'detail-trackchip-hover': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5 },
  'timeline': { '.SourcePicker__BranchKey': 1, '.TrackTimeline__LaneParentChip': 1 },
  'timeline-lane-hover': { '.SourcePicker__BranchKey': 1, '.TrackTimeline__LaneParentChip': 1 },
  'timeline-lane-selected': { '.SourcePicker__BranchKey': 1, '.TrackTimeline__LaneParentChip': 1 },
  'tree': { '.TrackTree__Priority--high': 1, '.TrackTree__Row--restricted': 1, '.SourcePicker__BranchKey': 1, '.TrackTree__GroupKey': 1, '.TrackTree__ParentChip': 1, '.TrackTree__Priority--low': 1 },
  'tree-row-hover': { '.TrackTree__Priority--high': 1, '.TrackTree__Row--restricted': 1, '.SourcePicker__BranchKey': 1, '.TrackTree__GroupKey': 1, '.TrackTree__ParentChip': 1, '.TrackTree__Priority--low': 1 },
  'tree-row-selected': { '.TrackTree__Priority--high': 1, '.TrackTree__Row--restricted': 1, '.SourcePicker__BranchKey': 1, '.TrackTree__GroupKey': 1, '.TrackTree__ParentChip': 1, '.TrackTree__Priority--low': 1 },
  'bulkadd': { '.TrackNode__PrioFlag': 0.5, '.TrackNode--restricted': 0.5, '.SourcePicker__BranchKey': 1, '.TrackNode__ParentChip': 0.5, '.TrackNode__SubProgress': 0.5, '.BulkAdd__TaskParentChip': 1 },
  'createtrack': { '.CreateTrack__BranchKey': 1 },
  'createtrack-visopt-active': { '.CreateTrack__BranchKey': 1 },
  'settings-branches-edit': { '.SettingsBranches__Swatch--active': 1.08 },
  'settings-general-swatch': { '.SettingsGeneral__Swatch--active': 1.08 },
};


// selector별 **변환 전** border-box 크기 범위(실측). 배율과 좌표만으로는 "그 요소를 재었는지"를
// 가릴 수 없다 — 부모를 재도 자기정합적이고 배율도 같다(캔버스 노드와 그 안의 칩은 둘 다 0.5).
// 이 표는 그 치환을 크기로 잡는다: .TrackNode__PrioFlag는 16x16이고 부모 .TrackNode--restricted는
// 180x109.75이므로 대입 즉시 범위를 벗어난다.
//
// 계약: 모든 occurrence가 [min, max] 안에 있어야 하고, **양 극단이 실제로 도달돼야 한다**.
// 도달 조건이 없으면 max를 크게 적어 검사를 무력화할 수 있다(범위만 넓히면 전부 통과).
// 폭이 min!=max인 항목은 내용 길이에 따라 변하는 것들이다(.TrackTree__GroupKey 2건).
export const SELECTOR_SIZE_ENVELOPE = {
  '.TrackNode__PrioFlag': { minW: 16, maxW: 16, minH: 16, maxH: 16 },
  '.TrackTree__Priority--high': { minW: 39.171875, maxW: 39.171875, minH: 20.5, maxH: 20.5 },
  '.SettingsBranches__Swatch--active': { minW: 22, maxW: 22, minH: 22, maxH: 22 },
  '.SettingsGeneral__Swatch--active': { minW: 26, maxW: 26, minH: 26, maxH: 26 },
  '.TrackNode--restricted': { minW: 180, maxW: 180, minH: 109.75, maxH: 109.75 },
  '.TrackTree__Row--restricted': { minW: 748, maxW: 748, minH: 40, maxH: 40 },
  '.SourcePicker__BranchKey': { minW: 46.609375, maxW: 46.609375, minH: 19, maxH: 19 },
  '.TrackTree__GroupKey': { minW: 582.390625, maxW: 619.265625, minH: 16, maxH: 16 },
  '.CreateTrack__BranchKey': { minW: 46.234375, maxW: 46.234375, minH: 16.5, maxH: 16.5 },
  '.TrackNode__ParentChip': { minW: 187, maxW: 187, minH: 16.5, maxH: 16.5 },
  '.TrackNode__SubProgress': { minW: 26.609375, maxW: 26.609375, minH: 15, maxH: 15 },
  '.TrackTimeline__LaneParentChip': { minW: 52.984375, maxW: 52.984375, minH: 15, maxH: 15 },
  '.TrackTree__ParentChip': { minW: 58.265625, maxW: 58.265625, minH: 16.5, maxH: 16.5 },
  '.BulkAdd__TaskParentChip': { minW: 58.265625, maxW: 58.265625, minH: 16.5, maxH: 16.5 },
  '.TrackTree__Priority--low': { minW: 36.75, maxW: 36.75, minH: 20.5, maxH: 20.5 },
};

// surface별 마스크가 실제로 덮는 픽셀 수(겹침 반영, fillRects와 동일한 floor/ceil 규칙).
// paintOutsetPx/배율/좌표가 각각 계약을 지켜도 "마스크가 화면을 얼마나 먹는지"는 아무도 보지
// 않았다. 이 수는 그 총량을 못으로 박는다 — 넓히면 즉시 어긋난다.
// tree 계열 4.2%는 allow #8(.TrackTree__Row--restricted 748x40)과 #10(.TrackTree__GroupKey 2건)의
// 정직한 결과다. 가리는 면적이 큰 것 자체가 리뷰 대상이므로 숫자로 드러내 둔다.
export const MASK_PIXEL_BUDGET = {
  'canvas': 7057,                             // 0.545%
  'canvas-toolbar-active': 7057,              // 0.545%
  'canvas-matpill-on': 7057,                  // 0.545%
  'sourcepicker-branch-hover': 7057,          // 0.545%
  'sourcepicker-group-hover': 7057,           // 0.545%
  'sourcepicker-task-hover': 7057,            // 0.545%
  'sourcepicker-unparticipate-hover': 7057,   // 0.545%
  'sourcepicker-search-focus': 7057,          // 0.545%
  'sourcepicker-addmenu-open': 7057,          // 0.545%
  'detail': 7057,                             // 0.545%
  'detail-originlink-hover': 7057,            // 0.545%
  'detail-trackchip-hover': 7057,             // 0.545%
  'timeline': 1824,                           // 0.141%
  'timeline-lane-hover': 1824,                // 0.141%
  'timeline-lane-selected': 1824,             // 0.141%
  'tree': 54750,                              // 4.225%
  'tree-row-hover': 54750,                    // 4.225%
  'tree-row-selected': 54750,                 // 4.225%
  'bulkadd': 8077,                            // 0.623%
  'createtrack': 799,                         // 0.062%
  'createtrack-visopt-active': 799,           // 0.062%
  'settings-branches-edit': 992,              // 0.077%
  'settings-general-swatch': 1260,            // 0.097%
};


// ── provenance 경로 정본 ──────────────────────────────────────────────────────
// discovery/캡처 provenance가 신고하는 blob 경로의 **정본 집합**. 개수만 세면 임의의 실제
// repo 파일 9개를 올바른 OID와 함께 넣어도 통과한다(실증). 경로 집합을 exact로 잠근다.
// Git을 부르기 **전에** 이 집합의 멤버인지 확인하므로, 경로에 shell metacharacter가 섞여도
// Git 호출 자체가 일어나지 않는다.
export const PROVENANCE_BLOB_PATHS = [
  'frontend/library/cssColorLiterals.mjs',
  'frontend/library/s4Canonicalize.mjs',
  'frontend/library/s4CaptureRunner.mjs',
  'frontend/library/s4DomProbe.mjs',
  'frontend/library/s4Evaluator.mjs',
  'frontend/library/s4Promote.mjs',
  'frontend/library/s4Spec.mjs',
  'frontend/scripts/s4-capture.mjs',
  'frontend/scripts/s4-adapter.playwright.js',
];

// ── 시나리오 정본 ─────────────────────────────────────────────────────────────
// **dataset identity에 필요한 값의 단일 원천.** 캡처 스크립트는 이것을 소비하고,
// candidate context의 같은 필드는 여기와 exact 대조된다.
// 두 곳에 적으면 URL이 가리키는 대상과 화면이 클릭하는 대상이 갈릴 수 있다.
// plain JSON만 담는다 — specFingerprint 입력이므로 함수·getter가 들어가면 안 된다.
export const SCENARIO_CANON = {
  apiOrigin: 'http://localhost:10001/api',
  appOrigin: 'http://localhost:10000',
  trackId: 5,
  bulkBranchId: 13,
  branchName: '- Alpha',
  bulkEpicId: 7,
  epicName: 'Alpha Epic',
  scrumBoardId: 10,
};
// context와 exact 대조할 필드. 늘리면 계약이 강해지고, 줄이면 약해진다.
export const SCENARIO_CANON_KEYS = Object.keys(SCENARIO_CANON);

// **사람이 승인하는 명시적 trust root다. 기계적으로 독립 증명되는 오라클이 아니다.**
// "이 응답이 픽셀에 영향을 주는가"는 코드를 읽고 내린 사람의 판단이고, raw 증거로는
// 도출되지 않는다. 이 표가 하는 일은 그 판단을 한곳에 못박아 manifest category와 exact
// 대조하는 것뿐이다 — 둘 중 하나만 바꾸면 RED가 되므로 **조용한 재분류**를 막는다.
// 이 표 자체의 정당성은 사람의 재검수로만 갱신된다. 이를 보완한다며 또 다른 자기파생
// 오라클을 만들면 그 순간 근거가 순환한다.
// 키는 urlTemplate, 값은 category. 2026-08-03 검수 기준.
export const REVIEWED_CLASSIFICATION = {
  '{apiOrigin}/branches': 'dataset',
  '{apiOrigin}/branches/{bulkBranchId}/epics': 'dataset',
  '{apiOrigin}/chat': 'dataset',
  '{apiOrigin}/notifications/unread-count': 'dataset',
  '{apiOrigin}/notifications?limit=30': 'ambient',
  '{apiOrigin}/profile/ui-prefs': 'dataset',
  '{apiOrigin}/scrum': 'dataset',
  '{apiOrigin}/scrum/{scrumBoardId}': 'dataset',
  '{apiOrigin}/setup/status': 'dataset',
  '{apiOrigin}/tracks': 'dataset',
  '{apiOrigin}/tracks/home-stats': 'dataset',
  '{apiOrigin}/tracks/{trackId}': 'dataset',
  '{apiOrigin}/tracks/{trackId}/branches': 'dataset',
  '{apiOrigin}/tracks/{trackId}/items': 'dataset',
  '{apiOrigin}/tracks/{trackId}/links': 'dataset',
  '{apiOrigin}/tracks/{trackId}/members': 'dataset',
  '{apiOrigin}/tracks/{trackId}/sidebar-tree': 'dataset',
  '{apiOrigin}/tracks/{trackId}/sources?limit=200&include_non_participating=true&branch_id={bulkBranchId}&epic_id={bulkEpicId}&exclude_done=true': 'dataset',
  '{appOrigin}/_next/static/development/_devMiddlewareManifest.json': 'dev',
  '{appOrigin}/_next/static/development/_devPagesManifest.json': 'dev',
};

// ── dataset 정본 ──────────────────────────────────────────────────────────────
// **단일 원천.** 2026-08-03 discovery 2회(Run A/B, 재현성 확인 완료)를 사람이 검수해 동결했다.
// 관찰된 backend 고유 URL 18종 + Next dev 런타임 2종을 셋으로 분류한다.
//
//  dataset — 캡처 픽셀에 영향을 주는 응답. light/dark가 **같은 데이터**에서 찍혔음을
//            증명하는 digest의 입력이다.
//  ambient — 관찰은 됐지만 이번 S4 픽셀에 영향을 주지 않는 요청. raw discovery 원문에는
//            남기되 dataset identity에서는 뺀다. **unknown과 구분하기 위해** 명시한다.
//  dev     — Next.js 개발 런타임 산출물. backend 데이터가 아니다.
//
// urlTemplate은 반드시 {apiOrigin}/{appOrigin}으로 시작하는 **절대 URL**이다.
// 상대 '/api/...'는 금지한다 — origin이 빠지면 어느 서버의 응답인지가 계약에서 사라진다.
// 각 category 배열은 urlTemplate lexical order로 고정한다(검증기가 강제).
//
// observedSurfaceCount / observedRequestCount는 Run A(=Run B, drift 0)의 실측값이다.
export const EXPECTED_DATASET_MANIFEST = {
  schemaVersion: 1,
  evidence: {
    observedHead: '21920546e8e33567b7c13e8cbaf219e93d7d69a8',
    observedSpecFingerprint: '5c8b9d0eabfd6ced5212eedde09ef2c911197ca6760228ccd25f223f1185d471',
    discoveryDigest: 'a5db9acd13eaf03277c099a2fba9c7b79db1b1e2379978a540ad7bd626b550d2',
    // **8파일 전부**를 결속한다. 이전 판은 out×2 + adapter 3개만 묶어서 err/code는
    // 1바이트를 바꿔도 통과했다(실증). 파일 집합도 exact 8로 본다.
    files: {
      'runA.out': 'cee40bad53677c6a76d9ebf1c5cfaef36a1f718276841b3d86245d0b5259794d',
      'runA.err': 'ad992b4de37c29e60575864d49d5253b8cf8bdeb3328d08db033d3053fc4a61b',
      'runA.code': '9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa',
      'runA.adapter.json': '6afbf76dde71598ff5af428d525fb8c021c8c63669e4cdf079e2f8fd711b6d38',
      'runB.out': '35a462760411404459e736bb24b804a6ff7ffca0c33f4a145a395b3c4195342a',
      'runB.err': 'ad992b4de37c29e60575864d49d5253b8cf8bdeb3328d08db033d3053fc4a61b',
      'runB.code': '9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa',
      'runB.adapter.json': '6afbf76dde71598ff5af428d525fb8c021c8c63669e4cdf079e2f8fd711b6d38',
    },
    surfaceCount: 23,
    semanticTupleCount: 307,
    backendTupleCount: 261,
    backendUniqueUrlCount: 18,
  },
  dataset: [
    { method: 'GET', urlTemplate: '{apiOrigin}/branches',
      reason: '브랜치 키·색·이름 — TrackNode/SourcePicker/사이드바 렌더에 쓰인다',
      observedSurfaceCount: 21, observedRequestCount: 21 },
    { method: 'GET', urlTemplate: '{apiOrigin}/branches/{bulkBranchId}/epics',
      reason: 'BulkAdd 에픽 드롭다운 항목',
      observedSurfaceCount: 1, observedRequestCount: 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/chat',
      reason: '헤더 채팅 unread 뱃지 숫자 — 픽셀에 직접 나온다',
      observedSurfaceCount: 23, observedRequestCount: 46 },
    { method: 'GET', urlTemplate: '{apiOrigin}/notifications/unread-count',
      reason: '헤더 알림 뱃지 숫자 — 픽셀에 직접 나온다',
      observedSurfaceCount: 23, observedRequestCount: 46 },
    { method: 'GET', urlTemplate: '{apiOrigin}/profile/ui-prefs',
      reason: 'theme/sidebar/home view 상태 — 화면 구성을 바꾼다',
      observedSurfaceCount: 23, observedRequestCount: 23 },
    { method: 'GET', urlTemplate: '{apiOrigin}/scrum',
      reason: '사이드바 스크럼 목록',
      observedSurfaceCount: 1, observedRequestCount: 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/scrum/{scrumBoardId}',
      reason: '스크럼 설정 화면의 보드명·색 스와치 선택 상태',
      observedSurfaceCount: 1, observedRequestCount: 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/setup/status',
      reason: 'Header workspace 이름과 setup gate 배너',
      observedSurfaceCount: 23, observedRequestCount: 23 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks',
      reason: '사이드바 트랙 목록·TrackHome 카드',
      observedSurfaceCount: 22, observedRequestCount: 24 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/home-stats',
      reason: 'TrackHome 통계 카드 숫자',
      observedSurfaceCount: 2, observedRequestCount: 2 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}',
      reason: '트랙 이름·설정 — 헤더와 캔버스 전반',
      observedSurfaceCount: 20, observedRequestCount: 20 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}/branches',
      reason: '트랙 설정 Branches 탭의 행·스와치',
      observedSurfaceCount: 1, observedRequestCount: 1 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}/items',
      reason: '캔버스 노드 전부 — 가장 큰 픽셀 기여',
      observedSurfaceCount: 19, observedRequestCount: 19 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}/links',
      reason: '엣지와 엣지 라벨 배지',
      observedSurfaceCount: 19, observedRequestCount: 19 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}/members',
      reason: '멤버 아바타 이니셜·색',
      observedSurfaceCount: 19, observedRequestCount: 19 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}/sidebar-tree',
      reason: 'SourcePicker 트리 전체',
      observedSurfaceCount: 19, observedRequestCount: 19 },
    { method: 'GET', urlTemplate: '{apiOrigin}/tracks/{trackId}/sources?limit=200&include_non_participating=true&branch_id={bulkBranchId}&epic_id={bulkEpicId}&exclude_done=true',
      reason: 'BulkAdd 소스 목록 — query가 화면 내용을 결정하므로 통째로 정본이다',
      observedSurfaceCount: 1, observedRequestCount: 1 },
  ],
  ambient: [
    { method: 'GET', urlTemplate: '{apiOrigin}/notifications?limit=30',
      reason: '알림 **목록**. 23 surface 중 알림 메뉴를 여는 화면이 없고, 뱃지 숫자는 별도 '
        + 'unread-count가 결정한다. 따라서 이번 S4 픽셀 identity에서 제외한다.',
      observedSurfaceCount: 23, observedRequestCount: 46 },
  ],
  dev: [
    { method: 'GET', urlTemplate: '{appOrigin}/_next/static/development/_devMiddlewareManifest.json',
      reason: 'Next.js 개발 런타임이 dev 서버에서 받는 정적 manifest. backend 데이터가 아니다.',
      observedSurfaceCount: 23, observedRequestCount: 23 },
    { method: 'GET', urlTemplate: '{appOrigin}/_next/static/development/_devPagesManifest.json',
      reason: 'Next.js 개발 런타임이 dev 서버에서 받는 정적 manifest. backend 데이터가 아니다.',
      observedSurfaceCount: 23, observedRequestCount: 23 },
  ],
};

// 23개 surface가 실제로 소비하는 데이터 원천. light/dark가 **같은 데이터**에서 찍혔음을
// 증명하기 위해 캡처 때 수집하고, 검증기가 원본 응답에서 digest를 재계산한다.
// (URL의 {trackId} 등은 buildActionContext로 해석된다.)
//
// **manifest에서 기계 파생한다.** 두 번째 수기 배열을 두면 둘이 갈라지고, 그때 어느 쪽이
// 정본인지가 사라진다 — 손으로 고칠 수 있는 경로 자체를 만들지 않는다.
export const DATASET_ENDPOINTS = EXPECTED_DATASET_MANIFEST.dataset.map((entry) => entry.urlTemplate);

// digest에서 제거할 **비시각·휘발** 필드. 화면을 바꾸지 않는 값만 넣는다 —
// 넓히면 데이터 동일성 증명이 약해지므로 항목마다 이유를 적는다.
// endpoint별로 좁힌다. 전역 이름 기준으로 지우면 어떤 화면에서는 렌더에 쓰이는 필드까지 사라진다.
// '*'는 모든 endpoint 공통이고, 나머지 키는 endpoint URL이다.
// **0개에서 시작한다.** `updated_at`은 화면 정렬에 영향을 줄 수 있어 전역 제거가 위험하다.
// 꼭 필요한 항목만 endpoint + JSON pointer exact로 열되, 그때 이유를 함께 적는다.
export const DATASET_VOLATILE_FIELDS = {};

// **순서가 의미 없는** 배열만 여기 적는다(`<url><jsonPath>[]` 형태). 나머지는 순서를 보존한다 —
// UI 정렬은 화면을 바꾸므로 digest가 그 변화를 봐야 한다.
// 지금은 비어 있다: 실제 응답을 관찰해 "순서 무관"임을 확인한 것만 추가한다.
export const DATASET_UNORDERED_PATHS = [];

// dead 예외는 삭제했다. `DEAD_ALLOW_IDS`/`DEAD_SELECTORS`는 자기신고 우회였다 —
// mask에서 ID를 지우고 dead에 등록하고 surface를 빼면 allow #6 false-green을 그대로 재개통할 수 있었다.
// S4는 죽은 `.ManageBranches` 관련 변환(구 allow #3·#4·#11)과 그 다크 override를 **범위에서 제외**하고
// 원문을 그대로 둔다. dead CSS 정리는 S5 부채. 그 결과 allow ID 전부가 live이고 예외 목록이 필요 없다.

export const REQUIRED_SMOKE_SURFACES = [
  { name: "canvas", captureName: "canvas.png",
    actions: [{ op: "setStorage", key: "track:{id}:lastView", value: "flow" },
      { op: "goto", url: "/tracks/{id}" },
      { op: "waitFor", selector: ".TrackNode--restricted", state: "visible" },
      // SourcePicker는 같은 Track__Body에 동시에 렌더된다(실측: 두 요소가 한 화면에 함께 visible).
      // 그래서 별도 sourcepicker base surface는 같은 픽셀을 두 번 찍을 뿐이었다 — 통합했다.
      { op: "waitFor", selector: ".SourcePicker__BranchRow", state: "visible" }],
    requiredElements: [".TrackNode"],
    coverageSelectors: [{ selector: ".TrackCanvas" }, { selector: ".TrackNode--restricted" }, { selector: ".TrackCanvas__Vignette" }, { selector: ".Track::before", locator: { selector: ".Track", pseudo: "::before" } }, { selector: ".TrackCanvas__Legend" }, { selector: ".TrackNode__ParentChip" }, { selector: ".TrackNode__SubProgress" }, { selector: ".TrackNode__PrioFlag" }, { selector: ".TrackEdgeLabel__Badge" }, { selector: ".TrackEdgeLabel__Badge--draft" }, { selector: ".TrackEdgeLabel__Badge--rel" }, { selector: ".TrackHeader__WeaveBar" }, { selector: ".TrackHeader__ViewBtn--active", state: "selected", provenBy: 1 }, { selector: ".SourcePicker__BranchKey" }, { selector: ".SourcePicker__Group" }, { selector: ".SourcePicker__GroupHint" }],
    darkReviewSelectors: [".TrackCanvas__Vignette", ".Track::before", ".TrackNode--restricted",
      ".SourcePicker__BranchKey", ".SourcePicker__GroupHint"] },   // 다크 육안 검토 대상(비교 baseline 없음)
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
  .BulkAdd { box-shadow: 0 0 0 1px var(--color-input-border), 0 24px 60px -16px rgba(0, 0, 0, 0.75), 0 4px 12px rgba(0, 0, 0, 0.5); }
  .TrackHeader__ViewBtn--active { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 0 0 1px var(--color-input-border-hover); }
  .SourcePicker__Task:not(.SourcePicker__Task--used):hover { box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(255, 255, 255, 0.14); }
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
  .TrackDetail__OriginLink:hover { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
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
// 참고치(외부 검수 측정): Source 6.184/5.513 · Tree 6.607/6.883 · Create 6.031/5.810
// (구 Manage 2건은 dead 우회였다 — `dead:true`가 대비 실패를 무조건 통과시켰고, T2426 제거 후엔 배경 stack 자체가 stale이라 삭제)
// 대비 참고치 정본 — generator 지역 상수로 두면 case/reference 어느 쪽을 지워도 검사가 조용히 사라진다.
// 이름 집합이 CONTRAST_CASES와 exact 일치해야 하고 specFingerprint에도 포함된다.
export const CONTRAST_REFERENCE = {
  'SourcePicker BranchKey normal': 6.184, 'SourcePicker BranchKey hover': 5.513,
  'TrackTree GroupKey normal': 6.607, 'TrackTree GroupKey hover': 6.883,
  'CreateTrack BranchKey normal': 6.031, 'CreateTrack BranchKey hover': 5.810,
};
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
];
