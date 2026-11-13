import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import LiveSearchInput from './LiveSearchInput.jsx';
import { matchesSearch } from '../lib/search.js';
import { downloadCsv } from '../lib/csv';
import { downloadReportPdf } from '../lib/reportPdf';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}

const trainingsOf = (r) => [r.training_type_label, r.more_trainings].filter(Boolean).join(', ');

// The two lists, laid out once so the table, CSV and PDF always match.
const VIEWS = {
  // Trainees' notes on the training material - where they ask for more training since the Yes/No
  // question came off the form (2026-11-13). Old "Yes" answers are listed too, with the name they gave.
  requests: {
    tab: 'Feedback notes',
    report: 'Trainee Feedback Notes',
    blurb: 'Notes trainees left about the training material on class feedback forms (including requests for more training), newest class first.',
    empty: 'No feedback notes for these filters.',
    columns: [
      { key: 'note', label: 'Note', weight: 3 },
      { key: 'training', label: 'Training', weight: 1.8 },
      { key: 'client', label: 'Client', weight: 1.3 },
      { key: 'class_date', label: 'Class Date', weight: 0.85 },
      { key: 'trainer', label: 'Trainer', weight: 1.1 },
      { key: 'asked_on', label: 'Left On', weight: 0.85 },
    ],
    row: (r) => ({
      note: r.note || `Asked for additional training${r.name ? ` - ${r.name}` : ''} (old Yes/No question)`,
      training: trainingsOf(r),
      client: r.client_name,
      class_date: formatDate(r.session_date),
      trainer: r.trainer_name || '',
      asked_on: formatDate(r.submitted_at),
    }),
    search: (r) => [r.note, r.name, r.client_name, r.trainer_name, trainingsOf(r)].join(' '),
  },
  notes: {
    tab: 'Trainer notes',
    report: 'Trainer Notes',
    blurb: 'Every note a trainer left when closing out a class, or when signing off a day of a multi-day course, newest first.',
    empty: 'No trainer notes for these filters.',
    columns: [
      { key: 'date', label: 'Date', weight: 0.85 },
      { key: 'trainer', label: 'Trainer', weight: 1.1, bold: true },
      { key: 'client', label: 'Client', weight: 1.3 },
      { key: 'training', label: 'Training', weight: 1.8 },
      { key: 'note', label: 'Note', weight: 3 },
    ],
    row: (r) => ({
      date: formatDate(r.note_date),
      trainer: r.trainer || '',
      client: r.client_name,
      training: `${trainingsOf(r)}${r.day_number ? ` (Day ${r.day_number})` : ''}`,
      note: (r.note || '').trim(),
    }),
    search: (r) => [r.trainer, r.client_name, trainingsOf(r), r.note].join(' '),
  },
};

// Follow-ups (Keeley's request, 2026-11-10: "an option to see everyone who has requested
// additional training? Also trainers notes? I need to see those quickly") - server/routes/
// reports.js GET /follow-ups. Follows the page's Client filter; dates are optional (blank = all).
export default function FollowUpsReport({ clientId = '', clientName = '' }) {
  const [view, setView] = useState('requests');
  const [range, setRange] = useState({ from: '', to: '' });
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    setData(null);
    api.getFollowUpsReport({ client_id: clientId, from: range.from, to: range.to })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [clientId, range.from, range.to]);

  const v = VIEWS[view];
  const rows = useMemo(() => {
    const list = data ? data[view] : [];
    return search.trim() ? list.filter((r) => matchesSearch(v.search(r), search)) : list;
  }, [data, view, search, v]);

  const filterLine = [
    clientName ? `Client: ${clientName}` : 'All clients',
    (range.from || range.to) && `Class dates: ${range.from ? formatDate(range.from) : 'any'} to ${range.to ? formatDate(range.to) : 'any'}`,
    search.trim() && `Search: "${search.trim()}"`,
  ].filter(Boolean).join('  ·  ');
  const title = clientName ? `${clientName} - ${v.report}` : v.report;
  const fileRows = () => rows.map(v.row);

  const exportCsv = () => {
    const out = fileRows().map((r) => Object.fromEntries(v.columns.map((c) => [c.label, r[c.key]])));
    downloadCsv(`${v.report.toLowerCase().replace(/\s+/g, '-')}.csv`, out);
    api.logReportDownload(v.report, `${out.length} row(s)`).catch(() => {});
  };
  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      await downloadReportPdf({ report_name: v.report, title, sub_lines: [filterLine], columns: v.columns, rows: fileRows() });
    } catch (e) {
      setError(e.message);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Follow-ups</h2>
      <div className="tab-row" role="tablist" style={{ margin: '0 0 8px' }}>
        {Object.entries(VIEWS).map(([key, x]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
            {x.tab}{data ? ` (${data[key].length})` : ''}
          </button>
        ))}
      </div>
      <p className="page-subtitle" style={{ margin: '0 0 12px' }}>
        {v.blurb}{clientName ? ` Showing ${clientName} only (the Client filter below).` : ''}
      </p>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="field-row" style={{ margin: 0 }}>
          <label>Search</label>
          <LiveSearchInput placeholder={view === 'requests' ? 'Words in the note, client, trainer...' :'Trainer, client, words in the note...'} value={search} onSearch={setSearch} delay={150} />
        </div>
        <div className="field-row" style={{ margin: 0 }}>
          <label>Class from</label>
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div className="field-row" style={{ margin: 0 }}>
          <label>To</label>
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        {(range.from || range.to || search) && (
          <button type="button" className="secondary" onClick={() => { setRange({ from: '', to: '' }); setSearch(''); }}>All dates</button>
        )}
        <button type="button" className="secondary" disabled={!rows.length} onClick={exportCsv}>Export CSV</button>
        <button type="button" className="secondary" disabled={!rows.length || pdfBusy} onClick={exportPdf}>{pdfBusy ? 'Building PDF…' : 'Export PDF'}</button>
      </div>
      <div className="table-scroll" style={{ maxHeight: '50vh' }}>
        <table>
          <thead>
            <tr>
              {v.columns.map((c) => <th key={c.key}>{c.label}</th>)}
              <th>Class</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const shown = v.row(r);
              return (
                <tr key={r.feedback_id || r.note_id}>
                  {v.columns.map((c) => (
                    <td key={c.key} style={c.key === 'note' ? { whiteSpace: 'pre-wrap', minWidth: 260 } : undefined}>
                      {shown[c.key]}
                    </td>
                  ))}
                  <td><Link to={`/sessions/${r.session_id}`}>Open</Link></td>
                </tr>
              );
            })}
            {data && !rows.length && <tr><td colSpan={v.columns.length + 1} className="empty-state">{v.empty}</td></tr>}
          </tbody>
        </table>
        {!data && !error && <div className="empty-state">Loading...</div>}
      </div>
    </div>
  );
}
