import './Button.css';

const VARIANTS = ['primary', 'secondary', 'danger', 'ghost'];

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  onClick,
  className = '',
  ...rest
}) {
  const cls = [
    'btn',
    `btn--${VARIANTS.includes(variant) ? variant : 'primary'}`,
    `btn--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={cls}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
