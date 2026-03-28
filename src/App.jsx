import { Routes, Route } from 'react-router-dom';
import Header from './components/layout/Header';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import TasksPage from './pages/TasksPage';
import FilesPage from './pages/FilesPage';
import './App.css';

export default function App() {
  return (
    <>
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/files" element={<FilesPage />} />
        </Routes>
      </main>
    </>
  );
}
