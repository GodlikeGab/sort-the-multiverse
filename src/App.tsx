import { Link, NavLink, Route, Routes } from 'react-router-dom';
import BackupPage from './pages/BackupPage';
import BadPage from './pages/BadPage';
import HelpPage from './pages/HelpPage';
import Home from './pages/Home';
import NewProject from './pages/NewProject';
import ProjectPage from './pages/ProjectPage';
import RoundPage from './pages/RoundPage';
import Swipe from './pages/Swipe';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="./favicon.svg" alt="" />
          <span>Sort the Multiverse</span>
        </Link>
        <nav className="nav">
          <NavLink to="/" end>Projects</NavLink>
          <NavLink to="/bad">Bad cards</NavLink>
          <NavLink to="/data">Data</NavLink>
          <NavLink to="/help">Help</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewProject />} />
        <Route path="/bad" element={<BadPage />} />
        <Route path="/data" element={<BackupPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/projects/:id/swipe" element={<Swipe />} />
        <Route path="/projects/:id/rounds/:n" element={<RoundPage />} />
        <Route path="*" element={<main className="page"><h1>Not found</h1><Link to="/">Go home</Link></main>} />
      </Routes>
    </div>
  );
}
