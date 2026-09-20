import * as XLSX from 'xlsx';

/**
 * Categorize task based on its title prefix:
 * - Starts with "HOTFIX" -> "Hotfix"
 * - Starts with "OOS" -> "OOS"
 * - Starts with "CHECK" -> "Need Check"
 * - Otherwise -> "No Category"
 *
 * @param {string} taskName
 * @returns {'Hotfix' | 'OOS' | 'Need Check' | 'No Category'}
 */
export const categorizeHotfixTask = (taskName) => {
  if (!taskName || typeof taskName !== 'string') return 'No Category';
  const trimmed = taskName.trim().toLowerCase();
  if (trimmed.startsWith('hotfix')) return 'Hotfix';
  if (trimmed.startsWith('oos')) return 'OOS';
  if (trimmed.startsWith('check')) return 'Need Check';
  return 'No Category';
};

/**
 * Format timestamp (ms) into formatted readable date string: YYYY-MM-DD HH:mm:ss
 * @param {number|string|null} timestamp
 * @returns {string}
 */
export const formatExcelDateTime = (timestamp) => {
  if (!timestamp) return '-';
  const num = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
  if (isNaN(num) || num <= 0) return '-';

  const d = new Date(num);
  if (isNaN(d.getTime())) return '-';

  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

/**
 * Check if a task belongs to the "COMPLETE HOTFIX" status
 * @param {object} task
 * @returns {boolean}
 */
export const isCompleteHotfixTask = (task) => {
  if (!task) return false;
  const statusStr = (task.status?.status || task.status || '').toLowerCase().trim();
  return statusStr === 'complete hotfix';
};

/**
 * Resolve effective task completion timestamp to prevent ClickUp duplication bug
 * where cloned tasks retain an outdated date_done that is older than date_created.
 *
 * Fallback priority:
 * 1. date_done if valid (>= date_created)
 * 2. date_closed if valid (>= date_created)
 * 3. Latest comment date at or after date_created (e.g. MR link submission / done confirmation)
 * 4. date_created (if task was created directly into COMPLETE HOTFIX status)
 *
 * @param {object} task - Task object
 * @param {Array} [comments] - Optional comments array
 * @returns {number|null} Timestamp in ms
 */
export const getEffectiveDoneTimestamp = (task, comments = []) => {
  const created = task.date_created || task.dateCreated ? parseInt(task.date_created || task.dateCreated, 10) : null;
  const done = task.date_done || task.dateDone ? parseInt(task.date_done || task.dateDone, 10) : null;
  const closed = task.date_closed || task.dateClosed ? parseInt(task.date_closed || task.dateClosed, 10) : null;

  // 1. Valid date_done (>= date_created)
  if (done && (!created || done >= created)) {
    return done;
  }

  // 2. Valid date_closed (>= date_created)
  if (closed && (!created || closed >= created)) {
    return closed;
  }

  // 3. Latest comment at or after task creation
  if (comments && comments.length > 0 && created) {
    const validComments = comments
      .map(c => parseInt(c.date, 10))
      .filter(ts => !isNaN(ts) && ts >= created)
      .sort((a, b) => b - a);

    if (validComments.length > 0) {
      return validComments[0];
    }
  }

  // 4. Fallback: task was created already in COMPLETE HOTFIX status
  if (created) {
    return created;
  }

  return done || null;
};

/**
 * Export filtered COMPLETE HOTFIX tasks into an Excel (.xlsx) file
 * 
 * Columns:
 * 1. Kategori (Hotfix, OOS, Need Check, No Category)
 * 2. Nama Task
 * 3. Status
 * 4. Tanggal Dibuat
 * 5. Tanggal Selesai
 * 6. Assignee / PIC
 * 7. List / Project
 * 8. Link ClickUp
 *
 * @param {Array} tasks - List of ClickUp tasks
 * @param {object} [options] - Additional options
 * @param {string} [options.customFilename] - Custom filename without extension
 * @param {string} [options.apiToken] - ClickUp API token to fetch task comments if needed
 * @returns {Promise<{ count: number, filename: string }>}
 */
export const exportCompleteHotfixToExcel = async (tasks = [], options = {}) => {
  // 1. Filter only rows with status "COMPLETE HOTFIX"
  const hotfixTasks = tasks.filter(isCompleteHotfixTask);

  if (hotfixTasks.length === 0) {
    throw new Error('Tidak ada task dengan status "COMPLETE HOTFIX" yang ditemukan.');
  }

  // 2. Check for anomalous tasks where date_done < date_created
  const anomalousTasks = hotfixTasks.filter(t => {
    const c = t.date_created || t.dateCreated ? parseInt(t.date_created || t.dateCreated, 10) : null;
    const d = t.date_done || t.dateDone ? parseInt(t.date_done || t.dateDone, 10) : null;
    return d && c && d < c;
  });

  // 3. Fetch comments for anomalous tasks if apiToken is provided
  const commentsMap = {};
  if (anomalousTasks.length > 0 && options.apiToken) {
    await Promise.all(
      anomalousTasks.map(async (t) => {
        try {
          const res = await fetch(`https://api.clickup.com/api/v2/task/${t.id}/comment`, {
            headers: { Authorization: options.apiToken }
          });
          if (res.ok) {
            const data = await res.json();
            commentsMap[t.id] = data.comments || [];
          }
        } catch (e) {
          console.warn(`Could not fetch comments for task ${t.id}:`, e);
        }
      })
    );
  }

  // 4. Map tasks to Excel row objects with requested column structure
  const rows = hotfixTasks.map((t, index) => {
    const category = categorizeHotfixTask(t.name);
    const dateCreatedRaw = t.date_created || t.dateCreated;
    const dateCreated = formatExcelDateTime(dateCreatedRaw);

    // Resolve effective completion date to avoid ClickUp clone bug
    const taskComments = commentsMap[t.id] || t.comments || [];
    const effectiveDoneTimestamp = getEffectiveDoneTimestamp(t, taskComments);
    const dateDone = formatExcelDateTime(effectiveDoneTimestamp);

    const assignees = (t.assignees || [])
      .map(a => a.username || a.name || a.email)
      .filter(Boolean)
      .join(', ') || '-';

    const listName = t.list?.name || t.listName || '-';

    return {
      'No': index + 1,
      'Kategori': category,
      'Nama Task': t.name || '-',
      'Status': (t.status?.status || t.status || 'COMPLETE HOTFIX').toUpperCase(),
      'Tanggal Dibuat': dateCreated,
      'Tanggal Selesai': dateDone,
      'Assignee (PIC)': assignees,
      'List / Project': listName,
      'Link Task': t.url || '-'
    };
  });

  // 5. Build XLSX worksheet and workbook
  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Set explicit column widths for better visual readability in Excel
  worksheet['!cols'] = [
    { wch: 6 },  // No
    { wch: 16 }, // Kategori (Kolom 1)
    { wch: 55 }, // Nama Task
    { wch: 20 }, // Status
    { wch: 22 }, // Tanggal Dibuat
    { wch: 22 }, // Tanggal Selesai
    { wch: 30 }, // Assignee (PIC)
    { wch: 25 }, // List / Project
    { wch: 45 }  // Link Task
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'COMPLETE HOTFIX');

  // 6. Generate file name
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = (options.customFilename || `Export_COMPLETE_HOTFIX_${dateStr}`) + '.xlsx';

  // 7. Trigger download
  XLSX.writeFile(workbook, filename);

  return {
    count: hotfixTasks.length,
    filename
  };
};
