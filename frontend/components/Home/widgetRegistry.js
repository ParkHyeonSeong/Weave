import TaskSummary from './DashboardWidgets/TaskSummary';
import RecentItems from './DashboardWidgets/RecentItems';
import StarredItems from './DashboardWidgets/StarredItems';
import ActiveSprints from './DashboardWidgets/ActiveSprints';

// key → 위젯 메타. Component는 self-contained(자체 fetch, props 없음).
export const WIDGET_REGISTRY = {
  mytasks: { label: '내 작업', Component: TaskSummary },
  recent:  { label: '최근', Component: RecentItems },
  starred: { label: '즐겨찾기', Component: StarredItems },
  sprints: { label: '진행중 스프린트', Component: ActiveSprints },
};

// 카탈로그(편집 모드)에서 보여줄 순서
export const WIDGET_ORDER = ['mytasks', 'recent', 'starred', 'sprints'];

// 신규 사용자 기본 활성 위젯(순서대로)
export const DEFAULT_ENABLED = ['mytasks', 'recent', 'starred'];
