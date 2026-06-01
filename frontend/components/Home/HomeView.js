import Launchpad from './Launchpad';
import QuickCreate from './QuickCreate';
import WidgetZone from './WidgetZone';

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

      <WidgetZone />
    </div>
  );
}
