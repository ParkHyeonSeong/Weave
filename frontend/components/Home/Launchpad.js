import { useRouter } from 'next/router';
import { GitBranch, FileEdit, Workflow, Compass } from 'lucide-react';
import { APP_HOME } from '@/library/appContext';
import { DEFAULT_COLORS } from '@/library/entityAppearance';

const APPS = [
  { key: 'branch', label: 'Branch', sub: '프로젝트·작업', Icon: GitBranch, color: DEFAULT_COLORS.branch, path: APP_HOME.branch },
  { key: 'canvas', label: 'Canvas', sub: '문서',         Icon: FileEdit,  color: DEFAULT_COLORS.canvas, path: APP_HOME.canvas },
  { key: 'track',  label: 'Track',  sub: '워크플로우',    Icon: Workflow,  color: DEFAULT_COLORS.track,  path: APP_HOME.track },
  { key: 'browse', label: '둘러보기', sub: '공개 브랜치', Icon: Compass, color: '#F59E0B', path: '/browse' },
];

export default function Launchpad() {
  const router = useRouter();
  return (
    <div className="Launchpad">
      {APPS.map((app) => {
        const Icon = app.Icon;
        return (
          <button key={app.key} className="Launchpad__Tile" onClick={() => router.push(app.path)}>
            <span className="Launchpad__Icon" style={{ background: app.color }}>
              {/* 배지 슬롯(향후): <span className="Launchpad__Badge" /> */}
              <Icon size={30} color="#fff" strokeWidth={2} />
            </span>
            <span className="Launchpad__Name">{app.label}</span>
            <span className="Launchpad__Sub">{app.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
