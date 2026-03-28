import useForm from '../../../hooks/useForm';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

const RULES = {
  name: (v) => (!v?.trim() ? 'Name is required' : null),
  owner_id: (v) => (!v?.trim() ? 'Owner is required' : null),
};

export default function ProjectForm({ initial = {}, onSubmit, loading }) {
  const { values, errors, handleChange, validate } = useForm({
    name: initial.name || '',
    description: initial.description || '',
    owner_id: initial.owner_id || '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate(RULES)) onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="stack">
      <Input label="Name" id="name" name="name" value={values.name} onChange={handleChange} error={errors.name} />
      <Input label="Description" id="description" name="description" value={values.description} onChange={handleChange} />
      <Input label="Owner ID" id="owner_id" name="owner_id" value={values.owner_id} onChange={handleChange} error={errors.owner_id} />
      <Button type="submit" disabled={loading}>
        {loading ? 'Saving…' : initial.id ? 'Update Project' : 'Create Project'}
      </Button>
    </form>
  );
}
