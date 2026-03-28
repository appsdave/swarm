import { Link } from 'react-router-dom';
import StatusBadge from '../../../components/ui/StatusBadge';
import './ProjectCard.css';

export default function ProjectCard({ project }) {
  return (
    <Link to={`/projects/${project.id}`} className="project-card">
      <div className="project-card__header">
        <h3 className="project-card__name">{project.name}</h3>
        <StatusBadge status={project.status} />
      </div>
      {project.description && (
        <p className="project-card__desc">{project.description}</p>
      )}
    </Link>
  );
}
