import { Link } from 'react-router-dom';
import useProjects from '../features/projects/hooks/useProjects';
import useTasks from '../features/tasks/hooks/useTasks';
import Spinner from '../components/ui/Spinner';
import PromptBox from '../features/prompt/components/PromptBox';
import './DashboardPage.css';

export default function DashboardPage() {
  const { data: projects, loading: pLoading } = useProjects();
  const { data: tasks, loading: tLoading } = useTasks();

  if (pLoading || tLoading) return <div className="center"><Spinner /></div>;

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      <section className="dashboard__prompt">
        <PromptBox />
      </section>

      <div className="dashboard__cards">
        <Link to="/projects" className="dashboard__stat">
          <span className="dashboard__stat-value">{projects?.length ?? 0}</span>
          <span className="dashboard__stat-label">Projects</span>
        </Link>
        <Link to="/tasks" className="dashboard__stat">
          <span className="dashboard__stat-value">{tasks?.length ?? 0}</span>
          <span className="dashboard__stat-label">Tasks</span>
        </Link>
        <Link to="/files" className="dashboard__stat">
          <span className="dashboard__stat-value">📁</span>
          <span className="dashboard__stat-label">File Manager</span>
        </Link>
      </div>
    </div>
  );
}
