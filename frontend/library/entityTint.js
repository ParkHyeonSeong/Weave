// 저장색 → 인라인 CSS 변수 4벌. SCSS가 테마에 맞는 쪽을 고른다. 저장 데이터는 바꾸지 않는다.
import { inkFor, normalizeStoredColor, tintFor } from './colorContrast.js';

// 배지가 놓이는 기준 표면 원장. **역할마다 부모가 달라서 프로파일로 갈린다.**
//
// 규칙: 각 값은 그 프로파일의 배지가 실제로 얹히는 부모 중 **대비가 가장 불리한 쪽**이다.
//   라이트 — 틴트가 부모보다 어둡다 → 가장 **어두운** 부모가 최악
//   다크   — 틴트가 부모보다 밝다   → 가장 **밝은** 부모가 최악
// 최악값 하나를 만족하면 같은 프로파일의 나머지 부모는 자동으로 만족한다.
//
//   default    — 일반 배지. 양 테마의 --color-surface.
//   track-card — TrackTree 상태 배지. 행은 4상태이고 hover·selected는 --color-primary를
//                --track-paper 위에 합성해 행 배경을 **대체**한다. 그래서 라이트에서는
//                그 합성색이 가장 어둡고 다크에서는 가장 밝다 — 양 테마 모두 **selected(6%)가 최악**이다.
//                default로 계산하면 다크 기본 행에서 17/31, 라이트 selected 행에서 31/31이 미달이었다.
//   task-ref   — Task ref 칩 **안쪽** 배지. 부모가 페이지 표면이 아니라 칩 자신의 배경,
//                즉 --color-primary-subtle(반투명)을 그 아래 표면에 합성한 색이다.
//                default로 계산하면 라이트·다크 모두 31/31 미달이었다.
//                ⚠️ **표 셀 안에서는 칩 배경을 불투명으로 굳혀** 셀 임의색을 차단한다
//                (canvasEditor·canvasPageView·canvasOverview의 `th, td .task-ref`).
//                그 불투명값이 이 프로파일이 이미 덮는 부모와 같은 색이라 프로파일은 안 늘어난다 —
//                ⛔ 셀색마다 프로파일을 추가하지 마라. entitySurfaceStates.test.js가 이 경계를 건다.
//   surface-overlay
//              — 떠 있는 표면(--color-surface-overlay) 위의 배지. 메신저 Task 검색 팝업의
//                **선택 안 한** 항목이 여기다. hover·active일 때만 --color-surface로 내려온다.
//                다크에서 overlay(밝음)가 최악 — default로 계산하면 idle에서 17/31 미달이었다.
//   track-header
//              — Track 헤더 참여 칩. 헤더 배경이 단색이 아니라
//                --track-paper → --track-paper-raised **세로 그라데이션**이다.
//                칩의 세로 위치는 설명문 길이·칩 줄바꿈에 따라 움직이므로 구간 양 끝을 모두 덮는다.
//                다크 최악은 아래쪽 끝(raised) — default로 계산하면 17/31 미달이었다.
//                ⚠️ 종전 계약은 위쪽 끝(paper)만 보고 "부모 = --color-surface"라 적어 결함을 놓쳤다.
//   task-list-raised
//              — TaskListRow 중 **행이 자기 배경을 칠하는** 상태의 라벨 배지:
//                selected(--color-primary-subtle 워시) · subtask(--color-surface-raised).
//                normal·hover는 행에 배경이 없어 목록 표면이 그대로 보이므로 default를 쓴다.
//                그래서 이 프로파일은 `surface`가 아니라 `raisedSurface`로 들어가고,
//                산출은 --et-*-raised로 따로 실린다(정상 행 외관 불변). 양 테마 모두 selected가 최악.
//
// ⛔ 이 값들은 **토큰(과 그 합성)의 JS 복제본**이다. 프로즈에 hex를 더 적지 마라 —
//    literalColorSweep이 주석의 hex도 hit로 잡아 colorExceptions 등록을 요구한다.
// ⛔ 값이 같다는 이유로 프로파일을 합치지 마라. surface-overlay와 track-header는 오늘 값이 같지만
//    역할이 달라 토큰이 갈리면 따로 움직여야 한다.
// 전 값은 `entityTint.test.js`가 _themes.scss를 읽어 토큰·합성식과 동치인지 고정한다.
export const ENTITY_SURFACE_PROFILES = {
  default: { light: '#F9FAFB', dark: '#17181C' },
  'track-card': { light: '#F0F1F9', dark: '#1D1F28' },
  'task-ref': { light: '#EDEEF8', dark: '#232632' },
  'surface-overlay': { light: '#F9FAFB', dark: '#1B1D22' },
  'track-header': { light: '#F9FAFB', dark: '#1B1D22' },
  'task-list-raised': { light: '#EDEEF8', dark: '#1F212C' },
};

// 기존 이름 유지 — default 프로파일이 곧 종전 상수다(호출부 호환).
export const ENTITY_SURFACES = ENTITY_SURFACE_PROFILES.default;

// ⛔ 모르는 프로파일 이름은 조용히 default로 접지 않는다. 오타가 그대로 계약 위반이 되기 때문이다.
function surfaceProfile(name) {
  const p = ENTITY_SURFACE_PROFILES[name];
  if (!p) throw new Error(`unknown entity surface profile: ${name}`);
  return p;
}

// 기존 hex-alpha 접미 → 사다리 "진입점". 고정값이 아니다 — 분리가 모자라면 위로 올라간다.
export const LEGACY_ALPHA_ENTRY = { 14: 8, 15: 8, 20: 12, 33: 20, 40: 25 };

// 값이 아예 없던 자리(오늘도 선언이 안 나간다) → undefined. 짝 클래스도 안 붙는다.
// 지원 밖 저장색 → `--et-*` 없이 오늘의 선언만. 짝 클래스를 붙이지 않아 다크에서도 오늘과 같다.
// 판정은 `--et-on` 하나로 통일한다(S7 계획 「저장색 입력 계약」).
const isBlank = (v) => typeof v !== 'string' || v.trim() === '';

// `surface` = 배지가 놓이는 부모의 역할 이름(ENTITY_SURFACE_PROFILES 키).
// 생략하면 default — 일반 배지의 기존 동작이 그대로 유지된다.
//
// `raisedSurface` = **같은 배지가 다른 상태에서 다른 부모 위에 놓일 때**의 두 번째 프로파일.
//   호출부 하나가 상태마다 다른 부모를 갖는데(TaskListRow: 정상 행은 목록 표면, 선택·하위 행은
//   행 자신의 배경) 인라인 style은 한 벌뿐이라, 최악값 하나로 접으면 **정상 행 외관까지** 바뀐다
//   (코퍼스 31/31, RGB 거리 최대 27.5 — 실측). 그래서 두 벌을 같이 실어 보내고
//   `storedColor.scss`가 행 상태로 고른다. 라이트/다크를 --et-*-dark로 가르는 것과 같은 구조다.
//   생략하면 --et-*-raised가 아예 안 나가고, SCSS 폴백이 기본값을 그대로 쓴다.
export function entityTintStyle(color, { from = 12, alpha = '20', surface = 'default', raisedSurface } = {}) {
  const s = surfaceProfile(surface);   // blank·passthrough보다 먼저: 오타는 입력과 무관하게 실패해야 한다
  const r = raisedSurface === undefined ? null : surfaceProfile(raisedSurface);
  if (isBlank(color)) return undefined;
  const c = normalizeStoredColor(color);
  if (!c) return { background: `${color}${alpha}`, color };   // passthrough — var() 금지
  const bgL = tintFor(c, s.light, from);
  const bgD = tintFor(c, s.dark, from);
  // ⛔ raised 값을 passthrough·blank 결과에 섞지 마라. 저 두 경로는 `--et-*`가 하나도 없어야
  //    짝 클래스(.EntityTint)가 안 붙고, 그래야 다크 규칙이 오늘 살아 있는 색을 지우지 않는다.
  const raised = r ? (() => {
    const rL = tintFor(c, r.light, from);
    const rD = tintFor(c, r.dark, from);
    return {
      '--et-bg-raised': rL,
      '--et-fg-raised': inkFor(c, rL),
      '--et-bg-raised-dark': rD,
      '--et-fg-raised-dark': inkFor(c, rD),
    };
  })() : null;
  return {
    '--et-on': '1',
    '--et-bg': bgL,
    '--et-fg': inkFor(c, bgL),
    '--et-bg-dark': bgD,
    '--et-fg-dark': inkFor(c, bgD),
    ...raised,
    background: 'var(--et-bg)',
    color: 'var(--et-fg)',
  };
}

export function entityInkStyle(color) {
  if (isBlank(color)) return undefined;
  const c = normalizeStoredColor(color);
  if (!c) return { color };
  return {
    '--et-on': '1',
    '--et-fg': inkFor(c, ENTITY_SURFACES.light),
    '--et-fg-dark': inkFor(c, ENTITY_SURFACES.dark),
    color: 'var(--et-fg)',
  };
}

export function entityBorderStyle(color, { from, alpha } = {}) {
  if (isBlank(color)) return undefined;
  const c = normalizeStoredColor(color);
  if (!c) return { borderColor: alpha ? `${color}${alpha}` : color };
  // 판정은 truthiness가 아니라 **생략 여부**다 — `from: 0`은 사다리 최하단을 요구한 것이지
  // "원색 테두리"가 아니다. truthiness로 재면 0이 조용히 bare 경로로 접힌다.
  const bare = from == null;
  return {
    '--et-on': '1',
    // from 생략 = 기존에 원색 테두리를 쓰던 자리. 라이트는 그대로 두고 다크만 들어올린다.
    '--et-bd': bare ? c : tintFor(c, ENTITY_SURFACES.light, from),
    '--et-bd-dark': bare ? inkFor(c, ENTITY_SURFACES.dark) : tintFor(c, ENTITY_SURFACES.dark, from),
    borderColor: 'var(--et-bd)',
  };
}

export function entitySolidStyle(color) {
  if (isBlank(color)) return undefined;
  const c = normalizeStoredColor(color);
  if (!c) return { background: color };
  return {
    '--et-on': '1',
    '--et-solid': c,
    '--et-solid-dark': inkFor(c, ENTITY_SURFACES.dark),
    background: 'var(--et-solid)',
  };
}
