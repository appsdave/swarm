import { useState, useCallback } from 'react';
import useTasks from '../features/tasks/hooks/useTasks';
import TaskCard from '../features/tasks/components/TaskCard';
import TaskForm from '../features/tasks/components/TaskForm';
import { createTask } from '../api/tasks';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';

export default function TasksPage() {
  const { data: tasks, loading, execute: reload } = useTasks();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCreate = useCallback(async (values) => {
    setSaving(true);
    try {
      await createTask(values);
      setShowForm(false);
      reload();
    } catch { /* handled */ } finally {
      setSaving(false);
    }
  }, [reload]);

  if (loading) return <div className="center"><Spinner /></div>;

  return (
    <div className="tasks-page">
      <div className="page-header">
        <h1>Tasks</h1>
        <Button onClick={() => setShowForm(true)}>New Task</Button>
      </div>
      <div className="tasks-list stack">
        {tasks?.map((t) => <TaskCard key={t.id} task={t} />)}
        {tasks?.length === 0 && <p className="empty">No tasks yet.</p>}
      </div>
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Task">
        <TaskForm onSubmit={handleCreate} loading={saving} />
      </Modal>
    </div>
  );
}
