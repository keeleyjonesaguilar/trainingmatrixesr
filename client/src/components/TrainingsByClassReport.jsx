import { useState } from 'react';
import { easternToday } from '../lib/dates.js';

function monthRange(offset) {
  const [y, m] = easternToday().split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

// Trainings by Class report (Keeley's requests, 2026-10-27/28): for any From/To dates, each
// training class with its date, trainer and number of trainees, then every trainee's name and
// whether their certificate is on file - server/lib/monthlyClientReport.js. Blank clientId = all
// clients. Starts on last month, the usual one to send.
export default function TrainingsByClassReport({ clientId = '', clientName = '' }) {
  const [range, setRange] = useState(() => monthRange(-1));
  const valid = range.from && range.to && range.from <= range.to;
  const href = (format) => `/api/reports/monthly-client.${format}?${new URLSearchParams({
    ...(clientId ? { client_id: clientId } : {}), from: range.from, to: range.to,
  })}`;
  return (
    <div className="card">
      <h2>Trainings by Class</h2>
      <p className="page-subtitle" style={{ margin: '0 0 12px' }}>
        Every training completed between two dates{clientName ? ` for ${clientName}` : clientId ? '' : ' across all clients'} - each class
        with its date, trainer and number of trainees, then the trainees' names and whether their certificate is on file.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field-row" style={{ margin: 0 }}>
          <label>From</label>
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div className="field-row" style={{ margin: 0 }}>
          <label>To</label>
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <button type="button" className="secondary" onClick={() => setRange(monthRange(-1))}>Last month</button>
        <button type="button" className="secondary" onClick={() => setRange(monthRange(0))}>This month</button>
        <a className="btn" href={valid ? href('pdf') : undefined} aria-disabled={!valid} download>Download PDF</a>
        <a className="btn btn-secondary" href={valid ? href('csv') : undefined} aria-disabled={!valid} download>Download CSV</a>
      </div>
      {!valid && <p className="page-subtitle" style={{ margin: '8px 0 0' }}>Pick a From date on or before the To date.</p>}
    </div>
  );
}
