import { useThemePreference, nextCycleMode, THEME_OPTIONS } from '@/library/theme';
import { THEME_ICONS } from '@/components/common/themeIcons';

const LABEL = Object.fromEntries(THEME_OPTIONS.map((o) => [o.value, o.label]));

// 헤더의 빠른 토글. Profile 라디오그룹이 정식 설정이고 이건 단축키 성격이라
// 세 모드를 한 버튼으로 순환한다: light → dark → system → light.
//
// 아이콘은 resolved가 아니라 mode를 그린다. system인데 해가 떠 있으면 사용자는
// "라이트를 골랐다"고 오해한다 — 고른 것과 보이는 것은 다르다.
//
// 저장 중에는 DOM disabled 대신 aria-disabled + 클릭 가드 — disabled는 포커스를 blur해
// 키보드 사용자의 위치를 잃게 한다(AppearanceSection과 같은 이유).
export default function ThemeToggleButton() {
  const { enabled, mode, choose, pending, error } = useThemePreference();
  if (!enabled) return null;

  const next = nextCycleMode(mode);
  const Icon = THEME_ICONS[mode] || THEME_ICONS.light;

  return (
    <button
      type="button"
      className="Header__IconBtn Header__ThemeToggle"
      data-mode={mode}
      aria-disabled={pending || undefined}
      aria-label={`테마: ${LABEL[mode]}. 누르면 ${LABEL[next]}로 바뀝니다.`}
      title={error || `테마: ${LABEL[mode]} → ${LABEL[next]}`}
      onClick={() => { if (!pending) choose(next); }}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
