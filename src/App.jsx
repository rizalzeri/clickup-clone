import { useState, useEffect, useRef, useMemo } from 'react';
import {
  getTeams,
  getSpaces,
  getAllTeamTasks,
  aggregateTasksByAssignee,
  getDefaultDateRange,
  formatDate,
  formatDateForInput,
  dateToTimestamp,
  dateToEndTimestamp,
  getStatusClass,
  getPriorityClass,
  getPriorityIcon,
  getInitials,
  formatRelativeTime,
  setApiToken,
  getApiToken,
  isCompletedStatus,
} from './clickupApi';
import LateTracker from './LateTracker';

// ====== CONSTANTS ======
const STORAGE_KEY = 'clickup_dashboard_token';
const SETTINGS_KEY = 'clickup_dashboard_settings';

// ====== COMPONENTS ======

// Toast notification
function Toast({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          <span>{toast.icon}</span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 16 }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// Avatar component
function Avatar({ person, size = 36 }) {
  const colorIndex = Math.abs(
    (person.name || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  ) % 8;

  if (person.profilePicture) {
    return (
      <div className={`avatar`} style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
        <img src={person.profilePicture} alt={person.name} onError={(e) => { e.target.style.display = 'none'; }} />
      </div>
    );
  }

  return (
    <div className={`avatar color-${colorIndex}`} style={{ width: size, height: size, fontSize: size * 0.35 }}>
      {getInitials(person.name)}
    </div>
  );
}

// Status badge
function StatusBadge({ status, statusColor }) {
  const cls = getStatusClass(status);
  return (
    <span className={`task-status ${cls}`}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: statusColor || 'currentColor',
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {status}
    </span>
  );
}

// Settings / Token Modal
function TokenModal({ onSave, initialToken }) {
  const [token, setToken] = useState(initialToken || 'pk_312657378_HGB5UJK9MRBWZF4YDVU89A1YAZ5I4NI9');

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">⚙️ Konfigurasi API</span>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">ClickUp API Token</label>
            <input
              className="form-control"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="pk_xxxxxxxx_xxxx..."
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Dapatkan token dari ClickUp Settings → Apps → API Token
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-primary" onClick={() => token.trim() && onSave(token.trim())}>
              💾 Simpan & Muat Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Stat Card
function StatCard({ icon, value, label, color, change }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className={`stat-icon ${color}`}>{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {change !== undefined && (
        <div className={`stat-change ${change >= 0 ? 'positive' : 'negative'}`}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
        </div>
      )}
    </div>
  );
}

// Chart Bar
function ChartBar({ label, value, maxValue, colorClass }) {
  const pct = maxValue > 0 ? Math.round((value / maxValue) * 100) : 0;
  const gradients = {
    purple: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
    blue: 'linear-gradient(135deg, #2563eb, #06b6d4)',
    emerald: 'linear-gradient(135deg, #059669, #0891b2)',
    amber: 'linear-gradient(135deg, #d97706, #ea580c)',
    rose: 'linear-gradient(135deg, #e11d48, #9333ea)',
    cyan: 'linear-gradient(135deg, #06b6d4, #059669)',
  };
  const colors = ['purple', 'blue', 'emerald', 'amber', 'rose', 'cyan'];
  const idx = Math.abs(label.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % colors.length;
  const gradient = gradients[colors[idx]];

  return (
    <div className="chart-bar-item">
      <div className="chart-bar-label" title={label}>{label}</div>
      <div className="chart-bar-track">
        <div
          className="chart-bar-fill"
          style={{ width: `${pct}%`, background: gradient }}
        >
          {pct > 15 && value}
        </div>
      </div>
      <div className="chart-bar-value">{value}</div>
    </div>
  );
}

// Person Detail Panel
function PersonDetailPanel({ person, onClose }) {
  if (!person) {
    return (
      <div className="person-detail-panel">
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-icon">👆</div>
            <div className="empty-title">Pilih Anggota Tim</div>
            <div className="empty-desc">Klik pada nama seseorang untuk melihat detail tugas mereka</div>
          </div>
        </div>
      </div>
    );
  }

  const allItems = [...(person.tasks || []), ...(person.subtasks || [])];
  const sortedItems = allItems.sort((a, b) => (b.dateUpdated || 0) - (a.dateUpdated || 0));

  // Gabungkan semua varian "complete*" menjadi satu entry "Complete"
  const rawStatusStats = Object.entries(person.statusBreakdown || {});
  const mergedStatusMap = {};
  for (const [status, count] of rawStatusStats) {
    const isComplete = status.toLowerCase().includes('complete') ||
      status.toLowerCase().includes('done') ||
      status.toLowerCase() === 'closed';
    const key = isComplete ? 'Complete ✅' : status;
    mergedStatusMap[key] = (mergedStatusMap[key] || 0) + count;
  }
  const statusStats = Object.entries(mergedStatusMap).sort((a, b) => b[1] - a[1]);

  const colorIndex = Math.abs(
    (person.name || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  ) % 8;

  const bgColors = [
    'linear-gradient(135deg, #7c3aed, #4f46e5)',
    'linear-gradient(135deg, #2563eb, #06b6d4)',
    'linear-gradient(135deg, #059669, #0891b2)',
    'linear-gradient(135deg, #d97706, #ea580c)',
    'linear-gradient(135deg, #e11d48, #9333ea)',
    'linear-gradient(135deg, #0891b2, #059669)',
    'linear-gradient(135deg, #9333ea, #e11d48)',
    'linear-gradient(135deg, #16a34a, #2563eb)',
  ];

  return (
    <div className="person-detail-panel">
      {/* Hero Card */}
      <div className="section-card">
        <div style={{ padding: 'var(--space-lg)', textAlign: 'center', position: 'relative' }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 70,
            background: bgColors[colorIndex], opacity: 0.12, borderRadius: '14px 14px 0 0'
          }} />

          <div className="person-hero-avatar" style={{ background: bgColors[colorIndex], margin: '0 auto 12px' }}>
            {person.profilePicture
              ? <img src={person.profilePicture} alt={person.name} />
              : <span style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>{getInitials(person.name)}</span>
            }
          </div>

          <div className="person-hero-name">{person.name}</div>
          <div className="person-hero-email">{person.email}</div>

          <div className="person-hero-stats">
            <div className="hero-stat">
              <div className="hero-stat-value" style={{ color: '#8b5cf6' }}>{person.totalItems}</div>
              <div className="hero-stat-label">Total Item</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value" style={{ color: '#10b981' }}>{person.completedSubtasks + person.completedTasks}</div>
              <div className="hero-stat-label">Selesai</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-value" style={{ color: '#f59e0b' }}>{person.completionRate}%</div>
              <div className="hero-stat-label">Rate</div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
              <span>Progress Keseluruhan</span>
              <span>{person.completionRate}%</span>
            </div>
            <div className="progress-bar-bg" style={{ height: 8 }}>
              <div
                className="progress-bar-fill purple"
                style={{ width: `${person.completionRate}%`, background: bgColors[colorIndex] }}
              />
            </div>
          </div>
        </div>

        {/* Status breakdown */}
        {statusStats.length > 0 && (
          <>
            <div className="divider" style={{ margin: 0 }} />
            <div style={{ padding: 'var(--space-md) var(--space-lg)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Status Breakdown
              </div>
              {statusStats.map(([status, count]) => (
                <div key={status} className="status-row">
                  <div className="status-info">
                    <div
                      className="status-dot-indicator"
                      style={{ background: getStatusColor(status) }}
                    />
                    <span className="status-name" style={{ textTransform: 'capitalize' }}>{status}</span>
                  </div>
                  <span className="status-count">{count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Task List */}
      <div className="task-list-card">
        <div className="section-header">
          <span className="section-title" style={{ fontSize: 15 }}>
            📋 Daftar Tugas
          </span>
          <span className="section-badge">{sortedItems.length}</span>
        </div>

        <div className="task-list-body">
          {sortedItems.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <div className="empty-icon">📭</div>
              <div className="empty-title">Tidak Ada Tugas</div>
              <div className="empty-desc">Tidak ada tugas dalam rentang tanggal ini</div>
            </div>
          ) : (
            sortedItems.map((task, idx) => (
              <div
                key={task.id || idx}
                className="task-item"
                onClick={() => task.url && window.open(task.url, '_blank')}
                style={{
                  animationDelay: `${idx * 0.03}s`,
                  borderLeft: task.isCompleted ? '3px solid var(--color-emerald-light)' : '3px solid transparent',
                }}
              >
                <div className="task-item-header">
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      {task.isSubtask && (
                        <span className="badge badge-subtask" style={{ flexShrink: 0, marginTop: 1 }}>
                          ⤷ Sub
                        </span>
                      )}
                      <div className="task-name" style={{ textDecoration: task.isCompleted ? 'line-through' : 'none', opacity: task.isCompleted ? 0.75 : 1 }}>
                        {task.name}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={task.status} statusColor={task.statusColor} />
                </div>

                <div className="task-meta">
                  {task.listName && (
                    <div className="task-meta-item">
                      📁 {task.listName}
                    </div>
                  )}
                  {task.dateDone && (
                    <div className="task-meta-item due-ok">
                      ✅ Selesai: {formatDate(task.dateDone)}
                    </div>
                  )}
                  {task.dueDate && !task.dateDone && (
                    <div className={`task-meta-item ${getDueDateClass(task.dueDate)}`}>
                      📅 {formatDate(task.dueDate)}
                    </div>
                  )}
                  {task.dateUpdated && (
                    <div className="task-meta-item">
                      🔄 {formatRelativeTime(task.dateUpdated)}
                    </div>
                  )}
                  {task.priority && (
                    <span className={`priority-badge ${getPriorityClass(task.priority)}`}>
                      {getPriorityIcon(task.priority)} {task.priority}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Helper functions
function getStatusColor(status) {
  const s = status?.toLowerCase() || '';
  if (s.includes('complete') || s.includes('done') || s.includes('closed')) return '#10b981';
  if (s.includes('progress') || s.includes('active')) return '#3b82f6';
  if (s.includes('review') || s.includes('testing')) return '#f59e0b';
  if (s.includes('block') || s.includes('stuck')) return '#f43f5e';
  return '#94a3b8';
}

function getDueDateClass(dueDate) {
  const now = Date.now();
  const diff = dueDate - now;
  if (diff < 0) return 'due-overdue';
  if (diff < 86400000 * 3) return 'due-soon';
  return 'due-ok';
}

const TARGET_DEVELOPER_EMAILS = [
  "dwi.luthfianto@mostrans.id",
  "tasya.aulia@mostrans.id",
  "alfitra.fadjri@mostrans.id",
  "mohammad.firmansyah@mostrans.id",
  "calvin.andrean@mostrans.id",
  "melda.nophia@mostrans.id",
  "imam.septa@mostrans.id",
  "gusti.kuswara@mostrans.id",
  "sarah.omega@mostrans.id"
];

const DEVELOPER_LIST = [
  { name: "Dwi Luthfianto", email: "dwi.luthfianto@mostrans.id" },
  { name: "Tasya Aulia", email: "tasya.aulia@mostrans.id" },
  { name: "Alfitra Fadjri", email: "alfitra.fadjri@mostrans.id" },
  { name: "Mohammad Firmansyah", email: "mohammad.firmansyah@mostrans.id" },
  { name: "Calvin Andrean", email: "calvin.andrean@mostrans.id" },
  { name: "Melda Nophia", email: "melda.nophia@mostrans.id" },
  { name: "Imam Septa", email: "imam.septa@mostrans.id" },
  { name: "Gusti Kuswara", email: "gusti.kuswara@mostrans.id" },
  { name: "Sarah Omega", email: "sarah.omega@mostrans.id" },
];

// ====== MAIN APP ======
export default function App() {
  // Navigation State
  const [currentPage, setCurrentPage] = useState('dashboard');
  
  // State
  const [apiToken, setApiTokenState] = useState('');
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [selectedSpace, setSelectedSpace] = useState('all');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState(null);
  const [allTasks, setAllTasks] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [filteredAssignees, setFilteredAssignees] = useState([]);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('totalSubtasks');
  const [sortDir, setSortDir] = useState('desc');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [initialized, setInitialized] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const toastIdRef = useRef(0);

  // Developer Checklist filter state (default: all 9 target developer emails)
  const [selectedDevEmails, setSelectedDevEmails] = useState(TARGET_DEVELOPER_EMAILS);
  const [onlyDevelopers, setOnlyDevelopers] = useState(true);

  // Date range
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);

  // Load token from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem(STORAGE_KEY);
    const savedSettings = localStorage.getItem(SETTINGS_KEY);

    if (savedToken) {
      setApiTokenState(savedToken);
      setApiToken(savedToken);
      initializeWorkspace(savedToken);
    } else {
      setShowTokenModal(true);
    }

    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        if (settings.startDate) setStartDate(settings.startDate);
        if (settings.endDate) setEndDate(settings.endDate);
      } catch (e) {}
    }
  }, []);

  // Initialize workspace
  const initializeWorkspace = async (token) => {
    try {
      setLoadingMessage('Menghubungkan ke ClickUp...');
      setLoading(true);
      setError(null);

      const teamList = await getTeams(token);
      setTeams(teamList);

      if (teamList.length > 0) {
        // Cek saved team di localStorage atau prioritaskan MOSTRANS-IT
        const savedTeamId = localStorage.getItem('clickup_selected_team_id');
        const defaultTeam = teamList.find(t => t.id === savedTeamId) ||
                            teamList.find(t => t.name.toLowerCase().includes('mostrans-it')) ||
                            teamList.find(t => t.name.toLowerCase().includes('mostrans')) ||
                            teamList[0];
        setSelectedTeam(defaultTeam);
        localStorage.setItem('clickup_selected_team_id', defaultTeam.id);

        // Get spaces
        const spaceList = await getSpaces(defaultTeam.id, token);
        setSpaces(spaceList);

        setInitialized(true);
        addToast('✅ Terhubung ke ClickUp!', 'success');

        // Auto-load data
        await loadDashboardData(defaultTeam.id, token, null, startDate, endDate);
      } else {
        setError('Tidak ada workspace yang ditemukan.');
      }
    } catch (err) {
      setError(err.message);
      addToast(`❌ ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Load dashboard data
  const loadDashboardData = async (teamId, token, spaceFilter, start, end) => {
    try {
      setLoadingMessage('Mengambil data tugas...');
      setLoading(true);
      setError(null);

      const startTs = dateToTimestamp(start);
      const endTs = dateToEndTimestamp(end);

      const tasks = await getAllTeamTasks(teamId, startTs, endTs, token);

      // Filter ketat di sisi client untuk memastikan tanggal selesai/update benar-benar di dalam rentang
      const filteredTasks = tasks.filter(task => {
        const dDone = task.date_done ? parseInt(task.date_done) : null;
        const dUpdate = task.date_updated ? parseInt(task.date_updated) : null;
        const dCreate = task.date_created ? parseInt(task.date_created) : null;

        // 1. Jika task sudah selesai, pastikan tanggal SELESAINYA berada di dalam range
        if (dDone) {
          if (startTs && dDone < startTs) return false;
          if (endTs && dDone > endTs) return false;
          return true;
        }

        // 2. Jika belum selesai (in progress/open), pastikan task tersebut AKTIF di rentang waktu tersebut
        if (startTs && dUpdate && dUpdate < startTs) return false;
        if (endTs && dCreate && dCreate > endTs) return false;

        return true;
      });

      setAllTasks(filteredTasks);
      processAndSetAssignees(filteredTasks);
      setLastUpdated(new Date());
      addToast(`✅ ${tasks.length} tugas berhasil dimuat`, 'success');
    } catch (err) {
      setError(err.message);
      addToast(`❌ Gagal memuat data: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const processAndSetAssignees = (tasks) => {
    const aggregated = aggregateTasksByAssignee(tasks);
    setAssignees(aggregated);
    setFilteredAssignees(aggregated);
  };

  // Apply filters
  useEffect(() => {
    let result = [...assignees];

    // Filter Developer Checklist
    if (onlyDevelopers) {
      result = result.filter(p => p.email && selectedDevEmails.includes(p.email.toLowerCase().trim()));
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q)
      );
    }

    // Specific person filter
    if (filterAssignee !== 'all') {
      result = result.filter(p => p.id === filterAssignee);
    }

    // Sort
    result.sort((a, b) => {
      let aVal = a[sortField] ?? 0;
      let bVal = b[sortField] ?? 0;
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (sortDir === 'asc') return aVal > bVal ? 1 : -1;
      return aVal < bVal ? 1 : -1;
    });

    setFilteredAssignees(result);
    if (selectedPerson && !result.some(p => p.id === selectedPerson.id)) {
      setSelectedPerson(null);
    }
  }, [assignees, searchQuery, filterAssignee, sortField, sortDir, onlyDevelopers, selectedDevEmails, selectedPerson]);

  // Toast helpers
  const addToast = (message, type = 'info') => {
    const id = ++toastIdRef.current;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    setToasts(prev => [...prev, { id, message, type, icon: icons[type] }]);
    setTimeout(() => removeToast(id), 4000);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Handle token save
  const handleTokenSave = (token) => {
    localStorage.setItem(STORAGE_KEY, token);
    setApiTokenState(token);
    setApiToken(token);
    setShowTokenModal(false);
    initializeWorkspace(token);
  };

  // Handle filter apply
  const handleApplyFilter = () => {
    if (selectedTeam && apiToken) {
      localStorage.setItem('clickup_selected_team_id', selectedTeam.id);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ startDate, endDate }));
      loadDashboardData(selectedTeam.id, apiToken, selectedSpace, startDate, endDate);
    }
  };

  // Quick date range setters
  const setQuickRange = (preset) => {
    const end = new Date();
    const start = new Date();

    switch (preset) {
      case '7d': start.setDate(start.getDate() - 7); break;
      case '1m': start.setMonth(start.getMonth() - 1); break;
      case '3m': start.setMonth(start.getMonth() - 3); break;
      case '6m': start.setMonth(start.getMonth() - 6); break;
      case '1y': start.setFullYear(start.getFullYear() - 1); break;
      case 'this_month':
        start.setDate(1);
        end.setMonth(end.getMonth() + 1, 0);
        break;
      default: break;
    }

    setStartDate(formatDateForInput(start));
    setEndDate(formatDateForInput(end));
  };

  // Handle sort
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Filtered tasks based on active assignee / developer filters
  const displayedTasks = useMemo(() => {
    if (filteredAssignees.length === 0) return [];

    // Jika filter developer dimatikan dan tidak ada filter anggota/pencarian khusus, gunakan allTasks
    if (!onlyDevelopers && filterAssignee === 'all' && !searchQuery.trim()) {
      return allTasks;
    }

    const memberIds = new Set(filteredAssignees.map(p => String(p.id)));
    const memberEmails = new Set(
      filteredAssignees
        .map(p => p.email?.toLowerCase().trim())
        .filter(Boolean)
    );

    return allTasks.filter(task => {
      if (!task.assignees || task.assignees.length === 0) return false;
      return task.assignees.some(a => {
        const idMatch = a.id && memberIds.has(String(a.id));
        const emailMatch = a.email && memberEmails.has(a.email.toLowerCase().trim());
        return idMatch || emailMatch;
      });
    });
  }, [allTasks, filteredAssignees, onlyDevelopers, filterAssignee, searchQuery]);

  // Compute stats based on displayedTasks
  const totalTasks = displayedTasks.filter(t => !t.parent).length;
  const totalSubtasks = displayedTasks.filter(t => !!t.parent).length;
  const totalCompleted = displayedTasks.filter(isCompletedStatus).length;
  const completionRate = displayedTasks.length > 0 ? Math.round((totalCompleted / displayedTasks.length) * 100) : 0;
  const maxSubtasks = Math.max(...filteredAssignees.map(p => p.totalSubtasks), 1);

  const activePreset = (() => {
    const end = new Date();
    const start7d = new Date(); start7d.setDate(start7d.getDate() - 7);
    const start1m = new Date(); start1m.setMonth(start1m.getMonth() - 1);
    const start3m = new Date(); start3m.setMonth(start3m.getMonth() - 3);

    if (startDate === formatDateForInput(start7d) && endDate === formatDateForInput(end)) return '7d';
    if (startDate === formatDateForInput(start1m) && endDate === formatDateForInput(end)) return '1m';
    if (startDate === formatDateForInput(start3m) && endDate === formatDateForInput(end)) return '3m';
    return null;
  })();

  return (
    <div className="app-wrapper">
      {/* Token Modal */}
      {showTokenModal && (
        <TokenModal onSave={handleTokenSave} initialToken={apiToken} />
      )}

      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="header-logo">
            <div className="logo-icon">📊</div>
            <div className="logo-text">
              <span className="logo-title">ClickUp Dashboard</span>
              <span className="logo-subtitle">
                {selectedTeam ? selectedTeam.name : 'Workspace Monitor'}
              </span>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              className={`btn ${currentPage === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setCurrentPage('dashboard')}
            >
              📊 Dashboard
            </button>
            <button 
              className={`btn ${currentPage === 'late_tracker' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setCurrentPage('late_tracker')}
            >
              ⏰ Late Tracker
            </button>
          </div>

          <div className="header-status">
            <div className={`status-dot ${loading ? 'loading' : error ? 'error' : 'online'}`} />
            {loading ? loadingMessage || 'Memuat...' :
              error ? 'Error' :
              lastUpdated ? `Diperbarui ${formatRelativeTime(lastUpdated?.getTime())}` :
              'Siap'}
          </div>

          <div className="header-actions">
            <button
              className="btn btn-secondary"
              onClick={() => handleApplyFilter()}
              disabled={loading}
              title="Refresh data"
            >
              {loading ? '⏳' : '🔄'} Refresh
            </button>
            <button
              className="btn btn-icon"
              onClick={() => setShowTokenModal(true)}
              data-tooltip="Pengaturan API"
            >
              ⚙️
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {currentPage === 'late_tracker' ? (
          <LateTracker apiToken={apiToken} selectedTeam={selectedTeam} addToast={addToast} />
        ) : (
          <div style={{ animation: 'fadeInUp 0.4s ease' }}>
        {/* Filter Section */}
        <div className="filter-section">
          <div className="filter-title">🔍 Filter & Rentang Tanggal</div>
          <div className="filter-grid">
            <div className="form-group">
              <label className="form-label">Tanggal Mulai</label>
              <input
                id="start-date"
                type="date"
                className="form-control"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                max={endDate}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Tanggal Selesai</label>
              <input
                id="end-date"
                type="date"
                className="form-control"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                min={startDate}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Filter Anggota</label>
              <select
                id="filter-assignee"
                className="form-control"
                value={filterAssignee}
                onChange={e => setFilterAssignee(e.target.value)}
              >
                <option value="all">Semua Anggota</option>
                {assignees.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Workspace</label>
              <select
                id="filter-team"
                className="form-control"
                value={selectedTeam?.id || ''}
                onChange={e => {
                  const team = teams.find(t => t.id === e.target.value);
                  if (team) {
                    setSelectedTeam(team);
                    localStorage.setItem('clickup_selected_team_id', team.id);
                  }
                }}
              >
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group filter-actions">
              <button
                id="apply-filter-btn"
                className="btn btn-primary"
                onClick={handleApplyFilter}
                disabled={loading || !apiToken}
                style={{ width: '100%' }}
              >
                {loading ? '⏳ Memuat...' : '🔍 Terapkan Filter'}
              </button>
            </div>
          </div>

          {/* Checklist Developer Filter */}
          <div style={{
            marginTop: 'var(--space-md)',
            paddingTop: 'var(--space-md)',
            borderTop: '1px solid var(--color-border-light)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 'var(--font-sm)',
                  color: 'var(--color-text-primary)'
                }}>
                  <input
                    type="checkbox"
                    checked={onlyDevelopers}
                    onChange={e => {
                      setOnlyDevelopers(e.target.checked);
                      if (e.target.checked && selectedDevEmails.length === 0) {
                        setSelectedDevEmails(TARGET_DEVELOPER_EMAILS);
                      }
                    }}
                    style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--color-purple-light)' }}
                  />
                  <span>👨‍💻 Filter Hanya Developer</span>
                </label>
                {onlyDevelopers && (
                  <span style={{
                    fontSize: '11px',
                    background: 'rgba(124, 58, 237, 0.15)',
                    color: 'var(--color-purple-light)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    fontWeight: 600,
                    border: '1px solid rgba(124, 58, 237, 0.3)'
                  }}>
                    {selectedDevEmails.length} dari {TARGET_DEVELOPER_EMAILS.length} Developer Terpilih
                  </span>
                )}
              </div>

              {onlyDevelopers && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSelectedDevEmails(TARGET_DEVELOPER_EMAILS)}
                    style={{ padding: '3px 10px', fontSize: '11px', borderRadius: '6px' }}
                  >
                    ✓ Pilih Semua
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSelectedDevEmails([])}
                    style={{ padding: '3px 10px', fontSize: '11px', borderRadius: '6px', opacity: 0.7 }}
                  >
                    ✕ Batal Semua
                  </button>
                </div>
              )}
            </div>

            {/* Checklist of Developer Members */}
            {onlyDevelopers && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                alignItems: 'center'
              }}>
                {DEVELOPER_LIST.map((dev) => {
                  const isChecked = selectedDevEmails.includes(dev.email);
                  const matchedPerson = assignees.find(a => a.email && a.email.toLowerCase() === dev.email.toLowerCase());
                  const displayName = matchedPerson?.name || dev.name;
                  const taskCount = matchedPerson?.totalSubtasks ?? 0;

                  return (
                    <label
                      key={dev.email}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: 'var(--font-xs)',
                        fontWeight: 500,
                        cursor: 'pointer',
                        userSelect: 'none',
                        transition: 'all 0.15s ease',
                        background: isChecked ? 'rgba(124, 58, 237, 0.2)' : 'var(--color-bg-input)',
                        border: isChecked ? '1px solid var(--color-purple-light)' : '1px solid var(--color-border)',
                        color: isChecked ? 'var(--color-purple-light)' : 'var(--color-text-secondary)',
                        boxShadow: isChecked ? '0 0 10px rgba(124, 58, 237, 0.2)' : 'none'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setSelectedDevEmails(prev =>
                            prev.includes(dev.email)
                              ? prev.filter(e => e !== dev.email)
                              : [...prev, dev.email]
                          );
                        }}
                        style={{ cursor: 'pointer', accentColor: 'var(--color-purple-light)' }}
                      />
                      <span>{displayName}</span>
                      {matchedPerson && (
                        <span style={{
                          fontSize: '10px',
                          opacity: 0.8,
                          background: isChecked ? 'rgba(124, 58, 237, 0.4)' : 'var(--color-bg-card)',
                          padding: '1px 5px',
                          borderRadius: '10px'
                        }}>
                          {taskCount} sub
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Stats Overview */}
        {!loading && allTasks.length > 0 && (
          <div className="stats-grid">
            <StatCard
              icon="👥"
              value={filteredAssignees.length}
              label="Total Anggota"
              color="purple"
            />
            <StatCard
              icon="📋"
              value={totalTasks}
              label="Total Task"
              color="blue"
            />
            <StatCard
              icon="⤷"
              value={totalSubtasks}
              label="Total Subtask"
              color="emerald"
            />
            <StatCard
              icon="✅"
              value={`${completionRate}%`}
              label="Completion Rate"
              color="amber"
            />
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="error-card" style={{ marginBottom: 'var(--space-xl)' }}>
            <div className="error-icon">⚠️</div>
            <div className="error-title">Gagal Memuat Data</div>
            <div className="error-message">{error}</div>
            <button
              className="btn btn-primary"
              onClick={() => setShowTokenModal(true)}
            >
              🔑 Periksa API Token
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="section-card" style={{ marginBottom: 'var(--space-xl)' }}>
            <div className="loading-overlay">
              <div className="spinner" />
              <div className="loading-text">{loadingMessage || 'Memuat data...'}</div>
              <div className="loading-subtext">Mengambil tugas dari ClickUp API...</div>
            </div>
          </div>
        )}

        {/* Not initialized */}
        {!loading && !error && allTasks.length === 0 && initialized && (
          <div className="section-card" style={{ marginBottom: 'var(--space-xl)' }}>
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <div className="empty-title">Tidak Ada Data</div>
              <div className="empty-desc">
                Tidak ada tugas ditemukan dalam rentang tanggal{' '}
                <strong>{startDate}</strong> hingga <strong>{endDate}</strong>.
                Coba ubah rentang tanggal atau filter.
              </div>
            </div>
          </div>
        )}

        {/* Main Dashboard */}
        {!loading && allTasks.length > 0 && (
          <>
            {/* Bar Chart - Full Width */}
            <div className="section-card" style={{ marginBottom: 'var(--space-xl)' }}>
              <div className="section-header">
                  <span className="section-title">
                    📊 Subtask per Anggota
                  </span>
                  <span className="section-badge">{filteredAssignees.length}</span>
                </div>
                <div className="chart-container">
                  {filteredAssignees.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">🔍</div>
                      <div className="empty-title">Tidak Ada Hasil</div>
                    </div>
                  ) : (
                    filteredAssignees.map(person => (
                      <ChartBar
                        key={person.id}
                        label={person.name}
                        value={person.totalSubtasks}
                        maxValue={maxSubtasks}
                      />
                    ))
                  )}
                </div>
              </div>

            <div className="dashboard-grid">
              {/* Left: People Table */}
              <div>
                <div className="section-card">
                  <div className="section-header">
                  <span className="section-title">
                    👥 Anggota Tim
                  </span>
                  <div className="search-bar">
                    <span className="search-icon">🔍</span>
                    <input
                      id="search-member"
                      type="text"
                      placeholder="Cari anggota..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="people-table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>
                          <span onClick={() => handleSort('name')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            Anggota
                            <span className={`sort-indicator ${sortField === 'name' ? 'sorted' : ''}`}>
                              {sortField === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                            </span>
                          </span>
                        </th>
                        <th>
                          <span onClick={() => handleSort('totalSubtasks')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            Subtask
                            <span className={`sort-indicator ${sortField === 'totalSubtasks' ? 'sorted' : ''}`}>
                              {sortField === 'totalSubtasks' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                            </span>
                          </span>
                        </th>
                        <th>
                          <span onClick={() => handleSort('totalTasks')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            Task
                            <span className={`sort-indicator ${sortField === 'totalTasks' ? 'sorted' : ''}`}>
                              {sortField === 'totalTasks' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                            </span>
                          </span>
                        </th>
                        <th>
                          <span onClick={() => handleSort('completionRate')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            Completion
                            <span className={`sort-indicator ${sortField === 'completionRate' ? 'sorted' : ''}`}>
                              {sortField === 'completionRate' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                            </span>
                          </span>
                        </th>
                        <th>Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssignees.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
                            Tidak ada anggota ditemukan
                          </td>
                        </tr>
                      ) : (
                        filteredAssignees.map((person, idx) => {
                          const rank = idx + 1;
                          const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
                          const colorClasses = ['purple', 'blue', 'emerald', 'amber', 'rose'];
                          const colorClass = colorClasses[idx % colorClasses.length];

                          return (
                            <tr
                              key={person.id}
                              className={`person-row ${selectedPerson?.id === person.id ? 'selected' : ''}`}
                              onClick={() => setSelectedPerson(prev => prev?.id === person.id ? null : person)}
                              style={{ animationDelay: `${idx * 0.05}s` }}
                            >
                              <td>
                                <span className={`rank-badge ${rankClass}`}>{rank}</span>
                              </td>
                              <td>
                                <div className="person-info">
                                  <Avatar person={person} size={36} />
                                  <div>
                                    <div className="person-name">{person.name}</div>
                                    <div className="person-email">{person.email}</div>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div className="metric-number" style={{ color: '#8b5cf6' }}>
                                  {person.totalSubtasks}
                                </div>
                                <div className="metric-label">
                                  {person.completedSubtasks} selesai
                                </div>
                              </td>
                              <td>
                                <div className="metric-number">{person.totalTasks}</div>
                                <div className="metric-label">{person.completedTasks} selesai</div>
                              </td>
                              <td>
                                <div className="metric-number" style={{ color: '#10b981' }}>
                                  {person.completionRate}%
                                </div>
                              </td>
                              <td>
                                <div className="progress-bar-wrapper">
                                  <div className="progress-bar-bg">
                                    <div
                                      className={`progress-bar-fill ${colorClass}`}
                                      style={{ width: `${person.completionRate}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right: Person Detail */}
            <PersonDetailPanel
              person={selectedPerson}
              onClose={() => setSelectedPerson(null)}
            />
          </div>
          </>
        )}
        </div>
        )}
      </main>

      {/* Toast */}
      <Toast toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
