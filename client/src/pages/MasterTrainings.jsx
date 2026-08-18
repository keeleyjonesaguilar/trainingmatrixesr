import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

const EXPIRATION_OPTIONS = ['None', '1 Year', '2 Years', '3 Years', '5 Years'];
const TYPE_OPTIONS = ['Training', 'Fit Test', 'Certification', 'License', 'Orientation'];

function TrainingRow({ row, onSaved, isAdmin }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(row);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setForm(row), [row]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.updateMasterTraining(row.training_id, form);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <tr>
        <td><Link to={`/trainings/${row.training_id}`}>{row.training_id}</Link></td>
        <td>{row.training_name}</td>
        <td>{row.category}</td>
        <td>{row.training_type}</td>
        <td>{row.default_expiration}</td>
        <td><span className={`badge ${row.active ? 'badge-current' : 'badge-notapplicable'}`}>{row.active ? 'Active' : 'Inactive'}</span></td>
        {isAdmin && <td><button className="secondary" onClick={() => setEditing(true)}>Edit</button></td>}
      </tr>
    );
  }

  return (
    <tr>
      <td>{row.training_id}</td>
      <td><input type="text" value={form.training_name} onChange={(e) => setForm({ ...form, training_name: e.target.value })} /></td>
      <td><input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></td>
      <td>
        <select value={form.training_type} onChange={(e) => setForm({ ...form, training_type: e.target.value })}>
          {TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      <td>
        <select value={form.default_expiration} onChange={(e) => setForm({ ...form, default_expiration: e.target.value })}>
          {EXPIRATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
      <td>
        <select value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
          <option value="1">Active</option>
          <option value="0">Inactive</option>
        </select>
      </td>
      <td>
        <button disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</button>{' '}
        <button className="secondary" onClick={() => { setEditing(false); setForm(row); }}>Cancel</button>
        {error && <div className="error-banner">{error}</div>}
      </td>
    </tr>
  );
}

function AddTrainingForm({ nextOrder, onAdded }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    training_id: '', training_name: '', category: '', training_type: 'Training', default_expiration: 'None', display_order: nextOrder,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.createMasterTraining(form);
      setForm({ training_id: '', training_name: '', category: '', training_type: 'Training', default_expiration: 'None', display_order: nextOrder + 1 });
      setOpen(false);
      onAdded();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return <button onClick={() => setOpen(true)}>+ Add Training</button>;
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Add a New Master Training</h2>
      <p className="page-subtitle">New trainings slot into the catalog immediately - the matrix, client settings, employee detail, and import mapping all pick them up automatically (spec section 29). No rebuild required.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="toolbar">
        <div className="field-row">
          <label>Training ID</label>
          <input type="text" placeholder="TRN-053" value={form.training_id} onChange={(e) => setForm({ ...form, training_id: e.target.value.toUpperCase() })} required />
        </div>
        <div className="field-row">
          <label>Training Name</label>
          <input type="text" value={form.training_name} onChange={(e) => setForm({ ...form, training_name: e.target.value })} required />
        </div>
        <div className="field-row">
          <label>Category</label>
          <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required />
        </div>
        <div className="field-row">
          <label>Training Type</label>
          <select value={form.training_type} onChange={(e) => setForm({ ...form, training_type: e.target.value })}>
            {TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label>Default Expiration</label>
          <select value={form.default_expiration} onChange={(e) => setForm({ ...form, default_expiration: e.target.value })}>
            {EXPIRATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>
      <button type="submit" disabled={saving}>{saving ? 'Adding...' : 'Add Training'}</button>{' '}
      <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

export default function MasterTrainings() {
  const isAdmin = useIsAdmin();
  const [summary, setSummary] = useState(null);
  const [trainings, setTrainings] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [error, setError] = useState('');

  const load = () => {
    api.getMasterTrainingsSummary().then(setSummary).catch((e) => setError(e.message));
    api.listMasterTrainings(false).then(setTrainings).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const categories = ['All', ...(summary ? summary.categories.map((c) => c.category) : [])];
  const visible = activeCategory === 'All' ? trainings : trainings.filter((t) => t.category === activeCategory);
  const maxOrder = trainings.reduce((m, t) => Math.max(m, t.display_order || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Master Training Catalog</h1>
          <p className="page-subtitle">The standardized source of truth for every training. Clients don&apos;t define their own trainings here &mdash; they configure requirements and overrides on the Clients page.</p>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}

      {summary && (
        <div className="stat-grid">
          <div className="stat-tile">
            <div className="stat-label">Master Modules</div>
            <div className="value">{summary.masterModules}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-label">Client Coverage</div>
            <div className="value">{summary.clientCoverage}</div>
            <span className="caption">Active client accounts</span>
          </div>
        </div>
      )}

      <div className="tab-row">
        {categories.map((c) => (
          <button key={c} type="button" className={activeCategory === c ? 'active' : ''} onClick={() => setActiveCategory(c)}>{c}</button>
        ))}
      </div>

      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Training ID</th>
                <th>Training Name</th>
                <th>Category</th>
                <th>Type</th>
                <th>Default Expiration</th>
                <th>Active</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => <TrainingRow key={row.training_id} row={row} isAdmin={isAdmin} onSaved={load} />)}
              {visible.length === 0 && <tr><td colSpan={isAdmin ? 7 : 6} className="empty-state">No trainings in this category.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin && (
        <div style={{ marginBottom: 16 }}>
          <AddTrainingForm nextOrder={maxOrder + 1} onAdded={load} />
        </div>
      )}
    </div>
  );
}
