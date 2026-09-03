import { Sun, Moon, Monitor } from 'lucide-react';

// 테마 모드별 아이콘 — Profile 라디오그룹과 Header 토글이 같은 맵을 쓴다.
// library/theme.js에 두지 않는 이유: 그 모듈은 부트스트랩 생성(esbuild 번들)에 들어가므로
// 아이콘 라이브러리를 끌어오지 않는다.
export const THEME_ICONS = Object.freeze({ light: Sun, dark: Moon, system: Monitor });
