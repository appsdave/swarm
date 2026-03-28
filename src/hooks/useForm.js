import { useState, useCallback } from 'react';

export default function useForm(initialValues = {}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const setValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const reset = useCallback((vals = initialValues) => {
    setValues(vals);
    setErrors({});
  }, [initialValues]);

  const validate = useCallback((rules) => {
    const next = {};
    for (const [field, check] of Object.entries(rules)) {
      const msg = check(values[field], values);
      if (msg) next[field] = msg;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [values]);

  return { values, errors, setErrors, handleChange, setValue, reset, validate };
}
