// 색 리터럴 예외 레지스트리 — 다크모드 스윕의 **정본**.
//
// "리터럴 0건"을 목표로 삼지 않는다. 모든 색 출현이 정확히 하나의 분류를 갖고, 분류가 조치를
// 결정한다. theme-dependent가 **아닌** 것만 여기 등록한다.
// 분류 8종의 뜻·판별 규칙·항목 shape의 정본 정의는 계획 index 「색 분류 8종」에 있다. 여기서는 요약만 둔다:
//
//   file      frontend/ 기준 상대경로 ('frontend/' 접두·절대경로 금지)
//   selector  CSS/SCSS면 **컴파일된 CSS를 postcss로 파싱한** 셀렉터(그룹 셀렉터는 원문 그대로).
//             JS/JSX/HTML/JSON/SVG면 null.
//   prop      CSS면 선언 property. 비-CSS면 값 바로 앞의 최근접 식별자.
//   value     소스에 적힌 바이트 그대로. 정규화·대소문자 변환 금지.
//   category  COLOR_CATEGORIES 8종 중 하나. **theme-dependent는 등록할 수 없다.**
//   reason    **20자 이상.** "왜 토큰을 쓸 수 없는가". "고정색이라서" 같은 동어반복 금지.
//
// S5가 생성 → S6~S8이 자기 구획에 append → S9의 literalColorSweep이 consume-once 튜플 매칭으로
// 소비한다. 미소비 예외가 남아도 RED다(죽은 예외) — 리터럴을 지웠으면 여기서도 지워라.
// ⚠️ 튜플 유일성을 단정하지 않는다. 같은 튜플이 소스에 N번 나오면 여기도 N개다(= 소비 예산).

export const COLOR_CATEGORIES = [
  'theme-dependent',
  'fixed-on-color',
  'overlay-scrim',
  'print-paper',
  'palette-source',
  'stored-color',
  'third-party',
  'dead',
];

export const COLOR_EXCEPTIONS = [
  // ── S5 (sweep A: common/layout/home/branch/modal) ──────────────────────────
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Backdrop', prop: 'background', value: 'rgba(0, 0, 0, 0.85)',
    category: 'overlay-scrim',
    reason: '임의 이미지 위에 덮는 스크림이다. 다크에서 밝히면 사진 감상용 암전이 깨지고 라이트에서도 같은 값이 옳다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Zoombar', prop: 'background', value: 'rgba(0, 0, 0, 0.5)',
    category: 'overlay-scrim',
    reason: '스크림 위에 뜨는 줌 컨트롤 바다. 배경이 앱 표면이 아니라 암전된 이미지라 표면 토큰을 쓰면 대비가 무너진다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Topbar', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '0.85 알파 검은 스크림 위 텍스트다. 배경이 테마와 무관하게 고정이므로 텍스트도 고정 흰색이 정답이다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Error', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '검은 스크림 위 오류 문구다. 앱 표면 토큰을 쓰면 다크에서 회색이 되어 스크림 위에서 읽히지 않는다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__IconBtn, .Lightbox__ZoomBtn', prop: 'background', value: 'rgba(255, 255, 255, 0.12)',
    category: 'fixed-on-color',
    reason: '검은 스크림 위 컨트롤 배경이다. 흰색 알파가 스크림을 살짝 들어올리는 값이라 표면 토큰으로 대체 불가능하다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__IconBtn, .Lightbox__ZoomBtn', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '검은 스크림 위 컨트롤 아이콘 색이다. 배경이 테마 무관 고정이므로 대비색도 고정이어야 한다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__IconBtn:hover, .Lightbox__ZoomBtn:hover', prop: 'background', value: 'rgba(255, 255, 255, 0.24)',
    category: 'fixed-on-color',
    reason: '스크림 위 컨트롤의 hover 강조다. 기본값과 같은 흰색 알파 사다리를 유지해야 hover가 구분된다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Nav', prop: 'background', value: 'rgba(255, 255, 255, 0.12)',
    category: 'fixed-on-color',
    reason: '스크림 위 좌우 이동 버튼 배경이다. 앱 표면이 아니라 암전된 이미지 위라 표면 토큰이 의미를 갖지 않는다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Nav', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '스크림 위 이동 버튼 아이콘이다. 배경이 고정 흰알파라 아이콘도 고정 흰색이어야 대비가 유지된다.',
  },
  {
    file: 'styles/components/common/lightbox.scss',
    selector: '.Lightbox__Nav:hover', prop: 'background', value: 'rgba(255, 255, 255, 0.24)',
    category: 'fixed-on-color',
    reason: '스크림 위 이동 버튼 hover다. 기본 0.12과의 대비 차로 상태를 표현하므로 같은 축의 값이어야 한다.',
  },
  {
    file: 'styles/components/common/avatar.scss',
    selector: '.Avatar', prop: 'color', value: '#fff',
    category: 'fixed-on-color',
    reason: '배경이 library/userAvatar.js의 12색 팔레트를 JS 인라인 style로 칠한 고정색이다. 테마와 무관해 이니셜은 흰색이 정답이다.',
  },
  {
    file: 'styles/components/common/labelTagInput.scss',
    selector: '.LabelTagInput__OptionDot:hover', prop: 'border-color', value: 'rgba(0, 0, 0, 0.15)',
    category: 'fixed-on-color',
    reason: '스와치 자체가 프리셋 16색 또는 사용자 저장색이다. 임의 색 위 hover 윤곽이라 표면 토큰을 쓰면 밝은 스와치에서 사라진다.',
  },
];

export function findException(file, selector, prop, value) {
  return COLOR_EXCEPTIONS.find(
    (e) => e.file === file && e.selector === selector && e.prop === prop && e.value === value,
  );
}
