const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  // The employee/trainer portal has its own sign-in and handles its own 401s (pages/Portal.jsx).
  if (res.status === 401 && !path.startsWith('/auth/') && !path.startsWith('/public/') && !path.startsWith('/portal/')) {
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
  login: (username, password, rememberMe = true) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password, rememberMe }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  // Two-factor authentication (self-service enrollment + the second login step)
  verifyMfaLogin: (mfaToken, code, trustDevice = true) => request('/auth/mfa/verify-login', { method: 'POST', body: JSON.stringify({ mfaToken, code, trustDevice }) }),
  getMfaStatus: () => request('/auth/mfa/status'),
  startMfaSetup: () => request('/auth/mfa/setup', { method: 'POST' }),
  enableMfa: (setupToken, code) => request('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ setupToken, code }) }),
  disableMfa: (password) => request('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ password }) }),

  // Self-service email (needed on file for "forgot password" to work) + the forgot/reset flow
  getMyEmail: () => request('/auth/email'),
  updateMyEmail: (email) => request('/auth/email', { method: 'PUT', body: JSON.stringify({ email }) }),
  forgotPassword: (username) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ username }) }),
  checkResetToken: (token) => request(`/auth/reset-password/check?token=${encodeURIComponent(token)}`),
  resetPassword: (token, newPassword, username) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword, username }) }),

  // User management (Manage Users admin screen)
  listUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  resetUserPassword: (userId, password) => request(`/users/${userId}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  resendInvite: (userId) => request(`/users/${userId}/resend-invite`, { method: 'POST' }),
  updateUserRole: (userId, role) => request(`/users/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  deleteUser: (userId) => request(`/users/${userId}`, { method: 'DELETE' }),
  adminDisableMfa: (userId) => request(`/users/${userId}/mfa`, { method: 'DELETE' }),
  adminUpdateUserEmail: (userId, email) => request(`/users/${userId}/email`, { method: 'PUT', body: JSON.stringify({ email }) }),
  adminUpdateUserFullName: (userId, full_name) => request(`/users/${userId}/full-name`, { method: 'PUT', body: JSON.stringify({ full_name }) }),

  // Security / login audit (Super Admin only screen)
  getLoginAttempts: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/audit/login-attempts${suffix}`);
  },
  getAccountChanges: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/audit/account-changes${suffix}`);
  },
  getAccessRoster: () => request('/audit/access-roster'),
  getActivityLog: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/audit/activity-log${suffix}`);
  },

  // Clients
  listClients: () => request('/clients'),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  uploadClientLogo: (id, dataUrl) => request(`/clients/${id}/logo`, { method: 'PUT', body: JSON.stringify({ data_url: dataUrl }) }),
  removeClientLogo: (id) => request(`/clients/${id}/logo`, { method: 'DELETE' }),
  deleteClient: (id) => request(`/clients/${id}`, { method: 'DELETE' }),
  getPossibleDuplicateClients: () => request('/clients/duplicates'),
  mergeClients: (winnerId, loserIds) => request('/clients/merge', { method: 'POST', body: JSON.stringify({ winner_id: winnerId, loser_ids: loserIds }) }),
  ignoreDuplicateClients: (memberIds) => request('/clients/duplicates/ignore', { method: 'POST', body: JSON.stringify({ member_ids: memberIds }) }),

  // Trainers (tracked separately from client employees)
  listTrainers: () => request('/trainers'),
  getPossibleDuplicateTrainers: () => request('/trainers/duplicates'),
  createTrainer: (data) => request('/trainers', { method: 'POST', body: JSON.stringify(data) }),
  ignoreDuplicateTrainers: (memberIds) => request('/trainers/duplicates/ignore', { method: 'POST', body: JSON.stringify({ member_ids: memberIds }) }),
  getTrainerEmployeeCrossMatches: () => request('/trainers/cross-matches'),
  ignoreTrainerEmployeeCrossMatch: (trainerId, employeeId) =>
    request('/trainers/cross-matches/ignore', { method: 'POST', body: JSON.stringify({ trainer_id: trainerId, employee_id: employeeId }) }),

  // Master Trainings
  listMasterTrainings: (activeOnly = false) => request(`/master-trainings${activeOnly ? '?activeOnly=true' : ''}`),
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
  searchAnyEmployee: (q, excludeId) => request(`/employees/search-any?${new URLSearchParams({ q, ...(excludeId ? { exclude_id: excludeId } : {}) }).toString()}`),

  // General supporting documents on an employee's own record (Keeley's request, 2026-09-22) -
  // an existing OSHA/CPR card, a medical eval, etc., not tied to one specific training record.
  listEmployeeDocuments: (employeeId) => request(`/employees/${employeeId}/documents`),
  uploadEmployeeDocument: (employeeId, file, label, trainingId) => {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('label', label);
    if (trainingId) formData.append('training_id', trainingId);
    return fetch(`${BASE}/employees/${employeeId}/documents`, { method: 'POST', body: formData, credentials: 'include' }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Document upload failed (${res.status})`);
      }
      return res.json();
    });
  },
  getEmployeeDocumentUrl: (employeeId, documentId) => `${BASE}/employees/${employeeId}/documents/${documentId}`,
  deleteEmployeeDocument: (employeeId, documentId) => request(`/employees/${employeeId}/documents/${documentId}`, { method: 'DELETE' }),

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

  // Several attendee documents at once from a session page - `items`: [{ file, attendee_id, label }].
  uploadAttendeeDocuments: (sessionId, items) => {
    const formData = new FormData();
    items.forEach((it) => formData.append('documents', it.file));
    formData.append('assignments', JSON.stringify(items.map(({ attendee_id, label }) => ({ attendee_id, label }))));
    return fetch(`${BASE}/training-sessions/${sessionId}/attendee-documents`, { method: 'POST', body: formData, credentials: 'include' }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
      return body;
    });
  },

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
  resolveImportEmployeeMatch: (batchId, matchId, decision) =>
    request(`/import/batches/${batchId}/employee-matches/${matchId}`, { method: 'PUT', body: JSON.stringify({ decision }) }),
  commitImport: (batchId) => request(`/import/batches/${batchId}/commit`, { method: 'POST' }),
  cancelImport: (batchId) => request(`/import/batches/${batchId}`, { method: 'DELETE' }),

  // Reports - single unified "trainings actually completed" report (2026-08-18 rebuild)
  getCompletedTrainingsReport: (params = {}) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const qs = new URLSearchParams(filtered).toString();
    return request(`/reports/completed-trainings${qs ? `?${qs}` : ''}`);
  },
  logReportDownload: (report_name, details) => request('/reports/log-download', { method: 'POST', body: JSON.stringify({ report_name, details }) }),

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
  updateSessionFulfillment: (id, payload) =>
    request(`/training-sessions/${id}/fulfillment`, { method: 'PATCH', body: JSON.stringify(payload) }),
  logSessionLinkCopied: (id, linkType) => request(`/training-sessions/${id}/log-link-copied`, { method: 'POST', body: JSON.stringify({ link_type: linkType }) }),
  // Manually add a missed attendee - works whether the session is open or already closed
  // (Keeley's request, 2026-09-22); when closed, immediately generates their certificate/
  // training record and regenerates the roster the same way close-out itself does.
  addSessionAttendee: (sessionId, payload) =>
    request(`/training-sessions/${sessionId}/attendees`, { method: 'POST', body: JSON.stringify(payload) }),
  updateSessionAttendee: (sessionId, attendeeId, payload) =>
    request(`/training-sessions/${sessionId}/attendees/${attendeeId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  // Works on a closed session too (Keeley's request, 2026-09-24) - also deletes the certificate and
  // training record that sign-in produced, and rebuilds the rosters.
  deleteSessionAttendee: (sessionId, attendeeId) =>
    request(`/training-sessions/${sessionId}/attendees/${attendeeId}`, { method: 'DELETE' }),
  markAttendanceDay: (sessionId, attendeeId, day) =>
    request(`/training-sessions/${sessionId}/attendees/${attendeeId}/days/${day}`, { method: 'POST' }),
  unmarkAttendanceDay: (sessionId, attendeeId, day) =>
    request(`/training-sessions/${sessionId}/attendees/${attendeeId}/days/${day}`, { method: 'DELETE' }),
  getSessionEditLink: (sessionId) => request(`/training-sessions/${sessionId}/edit-link`, { method: 'POST' }),
  rebuildSessionRosters: (sessionId) => request(`/training-sessions/${sessionId}/rebuild-rosters`, { method: 'POST' }),
  retryAttendeeProcessing: (sessionId, attendeeId) =>
    request(`/training-sessions/${sessionId}/attendees/${attendeeId}/process`, { method: 'POST' }),
  advanceSessionDay: (sessionId) => request(`/training-sessions/${sessionId}/advance-day`, { method: 'POST' }),
  previousSessionDay: (sessionId) => request(`/training-sessions/${sessionId}/previous-day`, { method: 'POST' }),
  getTrainingSessionsSummaryByTraining: () => request('/training-sessions/summary-by-training'),
  getSessionsByTraining: (trainingId, params = {}) => {
    const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const qs = new URLSearchParams(filtered).toString();
    return request(`/training-sessions/by-training/${trainingId}${qs ? `?${qs}` : ''}`);
  },

  // Public sign-in (no auth) - reached only via a session's QR code at /s/:token.
  publicSessionInfo: (token) => request(`/public/${token}`),
  // Employee/trainer portal (its own email + code sign-in) - /portal.
  portalRequestCode: (email) => request('/portal/request-code', { method: 'POST', body: JSON.stringify({ email }) }),
  portalVerify: (email, code) => request('/portal/verify', { method: 'POST', body: JSON.stringify({ email, code }) }),
  portalMe: () => request('/portal/me'),
  portalLogout: () => request('/portal/logout', { method: 'POST' }),
  portalUpdatePhone: (employeeId, phone) => request(`/portal/profiles/${employeeId}/phone`, { method: 'PUT', body: JSON.stringify({ phone }) }),
  portalRequestEmailChange: (newEmail) => request('/portal/email-change', { method: 'POST', body: JSON.stringify({ new_email: newEmail }) }),
  portalConfirmEmailChange: (code) => request('/portal/email-change/confirm', { method: 'POST', body: JSON.stringify({ code }) }),
  // Office side: invite someone to the portal, or remove their access.
  invitePortal: (employeeId) => request(`/employees/${employeeId}/portal-invite`, { method: 'POST' }),
  removePortal: (employeeId) => request(`/employees/${employeeId}/portal-invite`, { method: 'DELETE' }),
  // An employee's QR-code training record (no login) - /r/:token.
  publicRecord: (token) => request(`/public-record/${token}`),
  getEmployeeRecordLink: (employeeId) => request(`/employees/${employeeId}/record-link`),
  resetEmployeeRecordToken: (employeeId) => request(`/employees/${employeeId}/record-token/reset`, { method: 'POST' }),
  publicSignIn: (token, payload) => request(`/public/${token}/attendees`, { method: 'POST', body: JSON.stringify(payload) }),
  publicCloseSession: (token, payload) => request(`/public/${token}/close`, { method: 'POST', body: JSON.stringify(payload) }),
  // A multi-day session's trainer signs off their day (no certificates until the final day closes).
  publicSignOffDay: (token, day, payload) => request(`/public/${token}/days/${day}/signoff`, { method: 'POST', body: JSON.stringify(payload) }),
  // Multi Training Day: the trainer opens the next training for check-in (PIN only).
  publicNextTraining: (token, payload) => request(`/public/${token}/next-training`, { method: 'POST', body: JSON.stringify(payload) }),
  // "Find your name" returning-attendee check-in on a multi-day session (Keeley's request,
  // 2026-09-21/22) - no auth, same as the rest of the public sign-in surface.
  publicSearchAttendees: (token, q) => request(`/public/${token}/attendees/search?q=${encodeURIComponent(q)}`),
  publicCheckinAttendee: (token, attendeeId, payload) =>
    request(`/public/${token}/attendees/${attendeeId}/checkin`, { method: 'POST', body: JSON.stringify(payload) }),

  // Trainer's post-close edit page (no login, PIN-gated) - reached from the close-out email's
  // link at /session-edit/:editToken.
  sessionEditInfo: (editToken) => request(`/session-edit/${editToken}`),
  sessionEditUnlock: (editToken, pin) => request(`/session-edit/${editToken}/unlock`, { method: 'POST', body: JSON.stringify({ pin }) }),
  sessionEditSave: (editToken, payload) => request(`/session-edit/${editToken}/save`, { method: 'POST', body: JSON.stringify(payload) }),

  // Public post-training feedback (no auth) - reached only via a closed session's second QR
  // code at /feedback/:token.
  publicFeedbackInfo: (token) => request(`/public/${token}/feedback`),
  publicSubmitFeedback: (token, payload) => request(`/public/${token}/feedback`, { method: 'POST', body: JSON.stringify(payload) }),

  // Feedback form question text, admin-editable, shared by every session's feedback form.
  getFeedbackSettings: () => request('/feedback-settings'),
  updateFeedbackSettings: (data) => request('/feedback-settings', { method: 'PUT', body: JSON.stringify(data) }),
  getTrainerClosePinSettings: () => request('/trainer-close-pin-settings'),
  setUserSessionEmails: (userId, enabled) => request(`/users/${userId}/session-emails`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  // Session prep emails on/off per user: setting is 'prep_requests' or 'prep_review' (2026-10-07).
  setUserPrepEmails: (userId, setting, enabled) => request(`/users/${userId}/prep-emails`, { method: 'PUT', body: JSON.stringify({ setting, enabled }) }),
  // Session prep (2026-10-07): the class details, the trainer summary, and asking for prep by hand.
  saveSessionPrep: (sessionId, payload) => request(`/training-sessions/${sessionId}/prep`, { method: 'PUT', body: JSON.stringify(payload) }),
  sendSessionPrepSummary: (sessionId) => request(`/training-sessions/${sessionId}/prep/send`, { method: 'POST' }),
  startSessionPrep: (sessionId) => request(`/training-sessions/${sessionId}/prep/start`, { method: 'POST' }),
  updateTrainerClosePinSettings: (data) => request('/trainer-close-pin-settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Notification bell (top bar) - broadcast to every account, e.g. when a training session closes.
  listNotifications: () => request('/notifications'),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request('/notifications/mark-all-read', { method: 'POST' }),
};
