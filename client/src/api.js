const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (res.status === 401 && !path.startsWith('/auth/') && !path.startsWith('/public/')) {
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
  deleteClient: (id) => request(`/clients/${id}`, { method: 'DELETE' }),
  getPossibleDuplicateClients: () => request('/clients/duplicates'),
  mergeClients: (winnerId, loserIds) => request('/clients/merge', { method: 'POST', body: JSON.stringify({ winner_id: winnerId, loser_ids: loserIds }) }),
  ignoreDuplicateClients: (memberIds) => request('/clients/duplicates/ignore', { method: 'POST', body: JSON.stringify({ member_ids: memberIds }) }),

  // Trainers (tracked separately from client employees)
  listTrainers: () => request('/trainers'),
  getPossibleDuplicateTrainers: () => request('/trainers/duplicates'),
  createTrainer: (data) => request('/trainers', { method: 'POST', body: JSON.stringify(data) }),
  ignoreDuplicateTrainers: (memberIds) => request('/trainers/duplicates/ignore', { method: 'POST', body: JSON.stringify({ member_ids: memberIds }) }),

  // Master Trainings
  listMasterTrainings: (activeOnly = false) => request(`/master-trainings${activeOnly ? '?activeOnly=true' : ''}`),
  getMasterTrainingsSummary: () => request('/master-trainings/summary'),
  getTrainingDetail: (id, clientId) => request(`/master-trainings/${id}/detail${clientId ? `?client_id=${clientId}` : ''}`),
  createMasterTraining: (data) => request('/master-trainings', { method: 'POST', body: JSON.stringify(data) }),
  updateMasterTraining: (id, data) => request(`/master-trainings/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMasterTraining: (id) => request(`/master-trainings/${id}`, { method: 'DELETE' }),

  // Employees
  listEmployees: (params = {}) => request(`/employees?${new URLSearchParams(params).toString()}`),
  getEmployee: (id) => request(`/employees/${id}`),
  getEmployeeFullDetail: (id) => request(`/employees/${id}/full-detail`),
  createEmployee: (data) => request('/employees', { method: 'POST', body: JSON.stringify(data) }),
  updateEmployee: (id, data) => request(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmployee: (id) => request(`/employees/${id}`, { method: 'DELETE' }),
  getPossibleDuplicateEmployees: () => request('/employees/duplicates'),
  mergeEmployees: (winnerId, loserIds) => request('/employees/merge', { method: 'POST', body: JSON.stringify({ winner_id: winnerId, loser_ids: loserIds }) }),
  ignoreDuplicateEmployees: (memberIds) => request('/employees/duplicates/ignore', { method: 'POST', body: JSON.stringify({ member_ids: memberIds }) }),
  getEmployeeFacets: (clientId) => request(`/employees/facets/list${clientId ? `?client_id=${clientId}` : ''}`),

  // Training Requirements (Client Settings)
  getClientRequirements: (clientId) => request(`/training-requirements/client/${clientId}`),
  setClientRequirement: (clientId, trainingId, data) =>
    request(`/training-requirements/client/${clientId}/training/${trainingId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Training Records
  saveTrainingRecord: (data) => request('/training-records', { method: 'POST', body: JSON.stringify(data) }),
  deleteTrainingRecord: (id) => request(`/training-records/${id}`, { method: 'DELETE' }),
  setRecordInactive: (recordId, isInactive) =>
    request(`/training-records/${recordId}/inactive`, { method: 'PUT', body: JSON.stringify({ is_inactive: isInactive }) }),
  getInactiveRecords: (employeeId) => request(`/training-records/employee/${employeeId}/inactive`),

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
  getActionItems: (clientId) => request(`/dashboard/action-items?client_id=${clientId}`),
  ignoreComplianceGap: (employeeId, trainingId) =>
    request('/dashboard/action-items/ignore', { method: 'POST', body: JSON.stringify({ employee_id: employeeId, training_id: trainingId }) }),
  getIgnoredActionItems: (clientId) => request(`/dashboard/action-items/ignored?client_id=${clientId}`),

  // Import
  importTemplateUrl: `${BASE}/import/template.csv`,
  previewImport: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE}/import/preview`, { method: 'POST', body: formData, credentials: 'include' }).then(async (res) => {
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
  resolveImportClient: (batchId, data) =>
    request(`/import/batches/${batchId}/resolve-client`, { method: 'PUT', body: JSON.stringify(data) }),
  commitImport: (batchId) => request(`/import/batches/${batchId}/commit`, { method: 'POST' }),
  cancelImport: (batchId) => request(`/import/batches/${batchId}`, { method: 'DELETE' }),

  // Reports - single unified "trainings actually completed" report (2026-08-18 rebuild)
  getCompletedTrainingsReport: (params = {}) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const qs = new URLSearchParams(filtered).toString();
    return request(`/reports/completed-trainings${qs ? `?${qs}` : ''}`);
  },

  // Training Sessions (merged in from the Training Sign-In app, 2026-08-19) - admin/staff side,
  // same login as everything else above.
  listTrainingSessions: (params = {}) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const qs = new URLSearchParams(filtered).toString();
    return request(`/training-sessions${qs ? `?${qs}` : ''}`);
  },
  getTrainingSession: (id) => request(`/training-sessions/${id}`),
  createTrainingSession: (payload) => request('/training-sessions', { method: 'POST', body: JSON.stringify(payload) }),
  updateTrainingSession: (id, payload) => request(`/training-sessions/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteTrainingSession: (id) => request(`/training-sessions/${id}`, { method: 'DELETE' }),
  updateSessionAttendee: (sessionId, attendeeId, payload) =>
    request(`/training-sessions/${sessionId}/attendees/${attendeeId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSessionAttendee: (sessionId, attendeeId) =>
    request(`/training-sessions/${sessionId}/attendees/${attendeeId}`, { method: 'DELETE' }),
  retryAttendeeProcessing: (sessionId, attendeeId) =>
    request(`/training-sessions/${sessionId}/attendees/${attendeeId}/process`, { method: 'POST' }),
  getTrainingSessionsSummaryByTraining: () => request('/training-sessions/summary-by-training'),
  getSessionsByTraining: (trainingId, params = {}) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const qs = new URLSearchParams(filtered).toString();
    return request(`/training-sessions/by-training/${trainingId}${qs ? `?${qs}` : ''}`);
  },

  // Public sign-in (no auth) - reached only via a session's QR code at /s/:token.
  publicSessionInfo: (token) => request(`/public/${token}`),
  publicSignIn: (token, payload) => request(`/public/${token}/attendees`, { method: 'POST', body: JSON.stringify(payload) }),
  publicCloseSession: (token, payload) => request(`/public/${token}/close`, { method: 'POST', body: JSON.stringify(payload) }),

  // Public post-training feedback (no auth) - reached only via a closed session's second QR
  // code at /feedback/:token.
  publicFeedbackInfo: (token) => request(`/public/${token}/feedback`),
  publicSubmitFeedback: (token, payload) => request(`/public/${token}/feedback`, { method: 'POST', body: JSON.stringify(payload) }),
};
