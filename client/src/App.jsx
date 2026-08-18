import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Matrix from './pages/Matrix.jsx';
import EmployeeDetail from './pages/EmployeeDetail.jsx';
import TrainingDetail from './pages/TrainingDetail.jsx';
import ClientSettings from './pages/ClientSettings.jsx';
import ClientDetail from './pages/ClientDetail.jsx';
import MasterTrainings from './pages/MasterTrainings.jsx';
import Import from './pages/Import.jsx';
import Reports from './pages/Reports.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import Login from './pages/Login.jsx';
import { api } from './api';
import { AuthContext } from './authContext.jsx';

export default function App() {
  const [status, setStatus] = useState('loading'); // loading | signed-out | signed-in
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('user');

  useEffect(() => {
    api.me()
      .then((res) => { setUsername(res.username); setRole(res.role || 'user'); setStatus('signed-in'); })
      .catch(() => setStatus('signed-out'));
  }, []);

  if (status === 'loading') return null;

  if (status === 'signed-out') {
    return <Login onLogin={(name, userRole) => { setUsername(name); setRole(userRole || 'user'); setStatus('signed-in'); }} />;
  }

  const logout = async () => {
    try { await api.logout(); } catch { /* clear client state regardless */ }
    setStatus('signed-out');
    setUsername('');
    setRole('user');
  };

  return (
    <AuthContext.Provider value={{ username, role }}>
      <div className="shell">
        <Sidebar username={username} role={role} onLogout={logout} />
        <div className="main-content">
          <main className="app-body">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/matrix" element={<Matrix />} />
              <Route path="/employees/:employeeId" element={<EmployeeDetail />} />
              <Route path="/trainings/:trainingId" element={<TrainingDetail />} />
              <Route path="/clients" element={<ClientSettings />} />
              <Route path="/clients/:clientId" element={<ClientDetail />} />
              <Route path="/master-trainings" element={<MasterTrainings />} />
              <Route path="/import" element={<Import />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/admin/users" element={<AdminUsers currentUsername={username} />} />
            </Routes>
          </main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
