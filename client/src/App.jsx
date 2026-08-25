import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ActionRequired from './pages/ActionRequired.jsx';
import Matrix from './pages/Matrix.jsx';
import EmployeeDetail from './pages/EmployeeDetail.jsx';
import ClientSettings from './pages/ClientSettings.jsx';
import ClientDetail from './pages/ClientDetail.jsx';
import Trainers from './pages/Trainers.jsx';
import Import from './pages/Import.jsx';
import Reports from './pages/Reports.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import Login from './pages/Login.jsx';
import Sessions from './pages/Sessions.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import TrainingTypes from './pages/TrainingTypes.jsx';
import TrainingTypeDetail from './pages/TrainingTypeDetail.jsx';
import PublicSignIn from './pages/PublicSignIn.jsx';
import { api } from './api';
import { AuthContext } from './authContext.jsx';

export default function App() {
  const location = useLocation();
  // A trainee scanning a session's QR code lands on /s/:token and never has (or needs) a
  // login - checked before anything else below, so it never flashes the Login screen first.
  const isPublicSignIn = location.pathname.startsWith('/s/');

  const [status, setStatus] = useState('loading'); // loading | signed-out | signed-in
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('user');

  useEffect(() => {
    if (isPublicSignIn) return;
    api.me()
      .then((res) => { setUsername(res.username); setRole(res.role || 'user'); setStatus('signed-in'); })
      .catch(() => setStatus('signed-out'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublicSignIn]);

  if (isPublicSignIn) {
    return (
      <Routes>
        <Route path="/s/:token" element={<PublicSignIn />} />
      </Routes>
    );
  }

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
              <Route path="/action-required" element={<ActionRequired />} />
              <Route path="/matrix" element={<Matrix />} />
              <Route path="/employees/:employeeId" element={<EmployeeDetail />} />
              <Route path="/clients" element={<ClientSettings />} />
              <Route path="/clients/:clientId" element={<ClientDetail />} />
              <Route path="/trainers" element={<Trainers />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/sessions/:id" element={<SessionDetail />} />
              <Route path="/training-types" element={<TrainingTypes />} />
              <Route path="/training-types/:id" element={<TrainingTypeDetail />} />
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
