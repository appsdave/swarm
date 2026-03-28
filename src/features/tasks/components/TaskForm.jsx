import useForm from '../../../hooks/useForm';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

const RULES = {
  title: (v) => (!v?.trim() ? 'Title is required' : null),
  project_id: (v) => (!v?.trim() ? 'Project is required' : null),
};

export default function TaskForm({ initial = {}, onSubmit, loading }) {
  const { values, errors, handleChange, validate } = useForm({
    title: initial.title || '',
    description: initial.description || '',
    project_id: initial.project_id || '',
    assignee_id: initial.assignee_id || '',
    priority: String(initial.priority ?? 0),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate(RULES)) {
      onSubmit({ ...values, priority: Number(values.priority) });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="stack">
      <Input label="Title" id="title" name="title" value={values.title} onChange={handleChange} error={errors.title} />
      <Input label="Description" id="description" name="description" value={values.description} onChange={handleChange} />
      <Input label="Project ID" id="project_id" name="project_id" value={values.project_id} onChange={handleChange} error={errors.project_id} />
      <Input label="Assignee ID" id="assignee_id" name="assignee_id" value={values.assignee_id} onChange={handleChange} />
      <Input label="Priority (0–2)" id="priority" name="priority" type="number" min="0" max="2" value={values.priority} onChange={handleChange} />
      <Button type="submit" disabled={loading}>
        {loading ? 'Saving…' : initial.id ? 'Update Task' : 'Create Task'}
      </Button>
    </form>
  );
}
