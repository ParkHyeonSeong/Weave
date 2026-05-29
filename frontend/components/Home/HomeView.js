import Launchpad from './Launchpad';
import QuickCreate from './QuickCreate';
import TaskSummary from './DashboardWidgets/TaskSummary';
import RecentItems from './DashboardWidgets/RecentItems';
import StarredItems from './DashboardWidgets/StarredItems';

export default function HomeView() {
  return (
    <div className="HomeView">
      <div className="HomeView__Top">
        <div className="HomeView__Greeting">
          <h2 className="HomeView__Hello">안녕하세요 👋</h2>
          <p className="HomeView__Sub">오늘도 좋은 하루 되세요.</p>
        </div>
        <QuickCreate />
      </div>

      <Launchpad />

      <div className="HomeView__Widgets">
        <div className="HomeView__WidgetFull">
          <TaskSummary />
        </div>
        <div className="HomeView__WidgetCol">
          <RecentItems />
        </div>
        <div className="HomeView__WidgetCol">
          <StarredItems />
        </div>
      </div>
    </div>
  );
}
