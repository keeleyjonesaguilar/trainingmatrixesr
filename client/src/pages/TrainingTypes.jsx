import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useIsAdmin } from '../authContext.jsx';

const EXPIRATION_OPTIONS = ['None', '1 Year', '2 Years', '3 Years', '5 Years'];
const TYPE_OPTIONS = ['Training', 'Fit Test', 'Certification', 'License', 'Orientation'];

// Merged from the old Master Trainings page (Keeley's request): the catalog editor and the
// session-count/roster lens over the same rows are now one page. Training ID is auto-generated
// server-side (repo.generateNextTrainingId) - no more manual TRN-### typing.
function AddTrainingForm({ onAdded, onCancel }) {
  const [form, setForm] = useState({ training_name: '', category: '', training_type: 'Training', default_expiration: 'None' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await api.createMasterTraining(form);
      onAdded(created);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
      <h2>Add a New Training</h2>
      <p className="page-subtitle">New trainings slot into the catalog immediately - the matrix, client settings, employee detail, and import mapping all pick them up automatically. Its Training ID is generated automatically and it's added to the end of the list.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="toolbar">
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
      <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
    </form>
  );
}

export default function TrainingTypes() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [trainings, setTrainings] = useState([]);
  const [custom, setCustom] = useState([]);
  const [summary, setSummary] = useState(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [addingOpen, setAddingOpen] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    api.getMasterTrainingsSummary().then(setSummary).catch((e) => setError(e.message));
    api.getTrainingSessionsSummaryByTraining().then((data) => {
      setTrainings(data.trainings);
      setCustom(data.custom);
    }).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const categories = ['All', ...(summary ? summary.categories.map((c) => c.category) : [])];
  const bySearchAndCategory = trainings.filter((t) => {
    if (activeCategory !== 'All' && t.category !== activeCategory) return false;
    if (search && !`${t.training_id} ${t.training_name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Training Types</h1>
          <p className="page-subtitle">Every training in the catalog — click into one to see who's completed it, its upcoming/past sessions, and its settings.</p>
        </div>
        {isAdmin && !addingOpen && (
          <div className="page-header-actions">
            <button onClick={() => setAddingOpen(true)}>+ Add Training</button>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      {addingOpen && (
        <AddTrainingForm
          onAdded={(created) => { setAddingOpen(false); navigate(`/training-types/${created.training_id}`); }}
          onCancel={() => setAddingOpen(false)}
        />
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <input placeholder="Search training types…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
      </div>

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
                <th>Training</th>
                <th>ID</th>
                <th>Category</th>
                <th>Type</th>
                <th>Default Expiration</th>
                <th>Active</th>
                <th>Completed Sessions</th>
              </tr>
            </thead>
            <tbody>
              {bySearchAndCategory.map((t) => (
                <tr key={t.training_id}>
                  <td><Link to={`/training-types/${t.training_id}`}>{t.training_name}</Link></td>
                  <td>{t.training_id}</td>
                  <td>{t.category}</td>
                  <td>{t.training_type}</td>
                  <td>{t.default_expiration}</td>
                  <td><span className={`badge ${t.active ? 'badge-current' : 'badge-notapplicable'}`}>{t.active ? 'Active' : 'Inactive'}</span></td>
                  <td>{t.completed_session_count}</td>
                </tr>
              ))}
              {bySearchAndCategory.length === 0 && (
                <tr><td colSpan={7} className="empty-state">No trainings in this category.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {custom.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 14 }}>Custom / Uncatalogued Training Labels</h3>
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Completed Sessions</th>
              </tr>
            </thead>
            <tbody>
              {custom.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td>{c.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
