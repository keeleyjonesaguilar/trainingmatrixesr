const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
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
  // Clients
  listClients: () => request('/clients'),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Master Trainings
  listMasterTrainings: (activeOnly = false) => request(`/master-trainings${activeOnly ? '?activeOnly=true' : ''}`),
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

  // Matrix
  getMatrix: (params = {}) => request(`/matrix?${new URLSearchParams(params).toString()}`),

  // Dashboard
  getDashboard: (clientId) => request(`/dashboard${clientId ? `?client_id=${clientId}` : ''}`),

  // Import
  previewImport: (clientId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE}/import/${clientId}/preview`, { method: 'POST', body: formData }).then(async (res) => {
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
};
