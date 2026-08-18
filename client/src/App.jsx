import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Matrix from './pages/Matrix.jsx';
import EmployeeDetail from './pages/EmployeeDetail.jsx';
import TrainingDetail from './pages/TrainingDetail.jsx';
import ClientSettings from './pages/ClientSettings.jsx';
import Import from './pages/Import.jsx';

export default function App() {
  return (
    <>
      <header className="app-header">
        <div className="brand">Safety Training Matrix</div>
        <nav className="app-nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/matrix">Training Matrix</NavLink>
          <NavLink to="/clients">Client Settings</NavLink>
          <NavLink to="/import">Import Data</NavLink>
        </nav>
      </header>
      <main className="app-body">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/matrix" element={<Matrix />} />
          <Route path="/employees/:employeeId" element={<EmployeeDetail />} />
          <Route path="/trainings/:trainingId" element={<TrainingDetail />} />
          <Route path="/clients" element={<ClientSettings />} />
          <Route path="/import" element={<Import />} />
        </Routes>
      </main>
    </>
  );
}
