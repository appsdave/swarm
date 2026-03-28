import { useState, useCallback } from 'react';
import useProjects from '../features/projects/hooks/useProjects';
import ProjectCard from '../features/projects/components/ProjectCard';
import ProjectForm from '../features/projects/components/ProjectForm';
import { createProject } from '../api/projects';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import './ProjectsPage.css';

export default function ProjectsPage() {
  const { data: projects, loading, execute: reload } = useProjects();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCreate = useCallback(async (values) => {
    setSaving(true);
    try {
      await createProject(values);
      setShowForm(false);
      reload();
    } catch { /* error handled by API client */ } finally {
      setSaving(false);
    }
  }, [reload]);

  if (loading) return <div className="center"><Spinner /></div>;

  return (
    <div className="projects-page">
      <div className="page-header">
        <h1>Projects</h1>
        <Button onClick={() => setShowForm(true)}>New Project</Button>
      </div>
      <div className="projects-grid">
        {projects?.map((p) => <ProjectCard key={p.id} project={p} />)}
        {projects?.length === 0 && <p className="empty">No projects yet.</p>}
      </div>
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Project">
        <ProjectForm onSubmit={handleCreate} loading={saving} />
      </Modal>
    </div>
  );
}
