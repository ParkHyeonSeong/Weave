import { useRouter } from 'next/router';
import { GitBranch, BookOpen } from 'lucide-react';

const apps = [
  {
    id: 'branch',
    name: 'Branch',
    description: 'Project management, tasks, boards and sprints',
    icon: GitBranch,
    color: '#5E6AD2',
    href: '/branch',
  },
  {
    id: 'canvas',
    name: 'Canvas',
    description: 'Documents, knowledge base and team notes',
    icon: BookOpen,
    color: '#16A34A',
    href: '/canvas',
  },
];

export default function Launchpad() {
  const router = useRouter();

  return (
    <div className="Launchpad">
      <div className="Launchpad__Header">
        <h1 className="Launchpad__Title">Weave</h1>
        <p className="Launchpad__Subtitle">Choose an app to get started</p>
      </div>
      <div className="Launchpad__Grid">
        {apps.map((app) => (
          <button
            key={app.id}
            className="Launchpad__Card"
            onClick={() => router.push(app.href)}
          >
            <div
              className="Launchpad__IconWrap"
              style={{ backgroundColor: `${app.color}14` }}
            >
              <app.icon size={32} style={{ color: app.color }} />
            </div>
            <span className="Launchpad__AppName">{app.name}</span>
            <span className="Launchpad__AppDesc">{app.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
