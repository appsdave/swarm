import { NavLink } from 'react-router-dom';
import './Header.css';

const LINKS = [
  { to: '/', label: 'Dashboard' },
  { to: '/projects', label: 'Projects' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/files', label: 'Files' },
];

export default function Header() {
  return (
    <header className="header">
      <span className="header__brand">Ambition</span>
      <nav className="header__nav">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end className={({ isActive }) => isActive ? 'header__link header__link--active' : 'header__link'}>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
