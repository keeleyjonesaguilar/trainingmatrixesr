// Trainer Type (migration 077, Keeley's request, 2026-10-07): each trainer is Internal (one of
// ESR's own) or External (an outside/client trainer), set on their profile. Not set yet, it falls
// back to where the profile lives: the internal trainers client or Evolution Safety Resources is
// Internal, anywhere else External.
const { dbGet } = require('../db');
const { INTERNAL_CLIENT_ID } = require('./repo');

// For a query joining employees `e` to clients `c`.
const TRAINER_TYPE_SQL = `COALESCE(e.trainer_type, CASE WHEN c.client_id = '${INTERNAL_CLIENT_ID}' OR c.is_internal = 1
  OR LOWER(c.client_name) = 'evolution safety resources' THEN 'internal' ELSE 'external' END)`;

async function trainerType(employeeId) {
  if (!employeeId) return null;
  const row = await dbGet(
    `SELECT ${TRAINER_TYPE_SQL} AS type FROM employees e JOIN clients c ON c.client_id = e.client_id WHERE e.employee_id = ?`,
    [employeeId]
  );
  return row ? row.type : null;
}

module.exports = { TRAINER_TYPE_SQL, trainerType };
