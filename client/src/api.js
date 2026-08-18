const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    // Session expired/invalid - reload so the app re-checks auth and falls back to the login screen.
    window.location.reload();
    throw new Error('Your session expired. Reloading...');
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      /* ignore parse failure */
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Auth
  login: (username, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  // User management (Manage Users admin screen)
  listUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  resetUserPassword: (userId, password) => request(`/users/${userId}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  updateUserRole: (userId, role) => request(`/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  deleteUser: (userId) => request(`/users/${userId}`, { method: 'DELETE' }),

  // Clients
  listClients: () => request('/clients'),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Master Trainings
  listMasterTrainings: (activeOnly = false) => request(`/master-trainings${activeOnly ? '?activeOnly=true' : ''}`),
  getMasterTrainingsSummary: () => request('/master-trainings/summary'),
  getTrainingDetail: (id, clientId) => request(`/master-trainings/${id}/detail${clientId ? `?client_id=${clientId}` : ''}`),
  createMasterTraining: (data) => request('/master-trainings', { method: 'POST', body: JSON.stringify(data) }),
  updateMasterTraining: (id, data) => request(`/master-trainings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Employees
  listEmployees: (params = {}) => request(`/employees?${new URLSearchParams(params).toString()}`),
  getEmployee: (id) => request(`/employees/${id}`),
  getEmployeeFullDetail: (id) => request(`/employees/${id}/full-detail`),
  createEmployee: (data) => request('/employees', { method: 'POST', body: JSON.stringify(data) }),
  updateEmployee: (id, data) => request(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getEmployeeFacets: (clientId) => request(`/employees/facets/list${clientId ? `?client_id=${clientId}` : ''}`),

  // Training Requirements (Client Settings)
  getClientRequirements: (clientId) => request(`/training-requirements/client/${clientId}`),
  setClientRequirement: (clientId, trainingId, data) =>
    request(`/training-requirements/client/${clientId}/training/${trainingId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Training Records
  saveTrainingRecord: (data) => request('/training-records', { method: 'POST', body: JSON.stringify(data) }),
  deleteTrainingRecord: (id) => request(`/training-records/${id}`, { method: 'DELETE' }),
  resolveDuplicateRecord: (recordId) => request(`/training-records/${recordId}/resolve-duplicate`, { method: 'PUT' }),
  getRecordHistory: (employeeId, trainingId) => request(`/training-records/employee/${employeeId}/training/${trainingId}`),

  // Certificate of completion (optional, attachable at creation or later)
  uploadCertificate: (recordId, file) => {
    const formData = new FormData();
    formData.append('certificate', file);
    return fetch(`${BASE}/training-records/${recordId}/certificate`, { method: 'POST', body: formData, credentials: 'include' }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Certificate upload failed (${res.status})`);
      }
      return res.json();
    });
  },
  getCertificateUrl: (recordId) => `${BASE}/training-records/${recordId}/certificate`,

  // Matrix
  getMatrix: (params = {}) => request(`/matrix?${new URLSearchParams(params).toString()}`),

  // Dashboard
  getDashboard: (clientId) => request(`/dashboard${clientId ? `?client_id=${clientId}` : ''}`),

  // Import
  previewImport: (clientId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE}/import/${clientId}/preview`, { method: 'POST', body: formData, credentials: 'include' }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Import preview failed (${res.status})`);
      }
      return res.json();
    });
  },
  getImportBatch: (batchId) => request(`/import/batches/${batchId}`),
  resolveImportColumn: (batchId, mapId, data) =>
    request(`/import/batches/${batchId}/column-map/${mapId}`, { method: 'PUT', body: JSON.stringify(data) }),
  commitImport: (batchId) => request(`/import/batches/${batchId}/commit`, { method: 'POST' }),
  cancelImport: (batchId) => request(`/import/batches/${batchId}`, { method: 'DELETE' }),

  // Reports - single unified "trainings actually completed" report (2026-08-18 rebuild)
  getCompletedTrainingsReport: (params = {}) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const qs = new URLSearchParams(filtered).toString();
    return request(`/reports/completed-trainings${qs ? `?${qs}` : ''}`);
  },
};
