// ClickUp API Service
const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';

let cachedTeamData = null;
let cachedSpaces = null;
let cachedToken = null;

export const setApiToken = (token) => {
  cachedToken = token;
  cachedTeamData = null;
  cachedSpaces = null;
};

export const getApiToken = () => cachedToken;

const fetchWithAuth = async (url, token) => {
  const authToken = token || cachedToken;
  if (!authToken) throw new Error('API Token tidak ditemukan. Silakan masukkan API token Anda.');

  const response = await fetch(`${CLICKUP_API_BASE}${url}`, {
    headers: {
      'Authorization': authToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.err || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
};

// Get all teams/workspaces
export const getTeams = async (token) => {
  const data = await fetchWithAuth('/team', token);
  return data.teams || [];
};

// Get spaces in a team
export const getSpaces = async (teamId, token) => {
  const data = await fetchWithAuth(`/team/${teamId}/space?archived=false`, token);
  return data.spaces || [];
};

// Get folders in a space
export const getFolders = async (spaceId, token) => {
  const data = await fetchWithAuth(`/space/${spaceId}/folder?archived=false`, token);
  return data.folders || [];
};

// Get lists in a folder
export const getListsInFolder = async (folderId, token) => {
  const data = await fetchWithAuth(`/folder/${folderId}/list?archived=false`, token);
  return data.lists || [];
};

// Get folderless lists in space
export const getFolderlessLists = async (spaceId, token) => {
  const data = await fetchWithAuth(`/space/${spaceId}/list?archived=false`, token);
  return data.lists || [];
};

// Get ALL lists in workspace recursively
export const getAllLists = async (teamId, token) => {
  const allLists = [];

  const spaces = await getSpaces(teamId, token);

  for (const space of spaces) {
    // Get folders in each space
    const folders = await getFolders(space.id, token);
    for (const folder of folders) {
      const lists = await getListsInFolder(folder.id, token);
      lists.forEach(l => allLists.push({ ...l, spaceName: space.name, folderName: folder.name }));
    }

    // Get folderless lists
    const folderlessLists = await getFolderlessLists(space.id, token);
    folderlessLists.forEach(l => allLists.push({ ...l, spaceName: space.name, folderName: null }));
  }

  return allLists;
};

// Get tasks in a list with date filter
export const getTasksInList = async (listId, startDate, endDate, token, includeSubtasks = true) => {
  const params = new URLSearchParams({
    archived: 'false',
    include_closed: 'true',
    subtasks: includeSubtasks ? 'true' : 'false',
    order_by: 'updated',
    reverse: 'true',
    page: '0',
  });

  if (startDate) {
    params.append('date_updated_gt', String(startDate));
  }
  if (endDate) {
    params.append('date_updated_lt', String(endDate));
  }

  const data = await fetchWithAuth(`/list/${listId}/task?${params.toString()}`, token);
  return data.tasks || [];
};

// Get tasks by team with date range using team-level filtering
export const getTasksByTeam = async (teamId, startDate, endDate, token) => {
  const params = new URLSearchParams({
    archived: 'false',
    include_closed: 'true',
    subtasks: 'true',
    order_by: 'updated',
    reverse: 'true',
    page: '0',
    team_id: teamId,
  });

  if (startDate) {
    params.append('date_updated_gt', String(startDate));
  }
  if (endDate) {
    params.append('date_updated_lt', String(endDate));
  }

  const data = await fetchWithAuth(`/team/${teamId}/task?${params.toString()}`, token);
  return data.tasks || [];
};

// Get tasks for a specific list with pagination
export const getTaskTimeInStatus = async (taskId, token) => {
  try {
    const data = await fetchWithAuth(`/task/${taskId}/time_in_status`, token);
    return data || null;
  } catch (err) {
    console.error("Error fetching time_in_status for task", taskId, err);
    return null;
  }
};

export const getTasksWithPagination = async (listId, startDate, endDate, token, includeSubtasks = true) => {
  let allTasks = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      archived: 'false',
      include_closed: 'true',
      subtasks: includeSubtasks ? 'true' : 'false',
      order_by: 'updated',
      reverse: 'true',
      page: String(page),
    });

    if (startDate) params.append('date_updated_gt', String(startDate));
    if (endDate) params.append('date_updated_lt', String(endDate));

    const data = await fetchWithAuth(`/list/${listId}/task?${params.toString()}`, token);
    const tasks = data.tasks || [];

    allTasks = [...allTasks, ...tasks];

    if (tasks.length < 100) {
      hasMore = false;
    } else {
      page++;
    }

    if (page > 5) break; // Safety limit
  }

  return allTasks;
};

// Get team tasks with pagination
// Menggunakan date_done untuk konsisten dengan filter ClickUp "Date done"
export const getAllTeamTasks = async (teamId, startDate, endDate, token) => {
  const taskMap = new Map();

  // Helper function to fetch tasks with specific date field
  const fetchTasksByDateField = async (dateField, forceOpenOnly = false) => {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        archived: 'false',
        include_closed: forceOpenOnly ? 'false' : 'true',
        subtasks: 'true',
        order_by: 'updated',
        reverse: 'true',
        page: String(page),
      });

      if (!forceOpenOnly && startDate) params.append(`${dateField}_gt`, String(startDate));
      if (!forceOpenOnly && endDate) params.append(`${dateField}_lt`, String(endDate));

      const data = await fetchWithAuth(`/team/${teamId}/task?${params.toString()}`, token);
      const tasks = data.tasks || [];

      tasks.forEach(t => taskMap.set(t.id, t));

      if (tasks.length < 100) {
        hasMore = false;
      } else {
        page++;
        // Supports up to 3600 tasks across pages for date filters, and 1500 for open tasks
        if (page > (forceOpenOnly ? 15 : 35)) break; 
      }
    }
  };

  // 1. Fetch by date_updated (catches tasks worked on or created during the period)
  await fetchTasksByDateField('date_updated');

  // 2. Fetch by date_done (catches tasks completed in the period but updated AFTER the period)
  if (startDate || endDate) {
    await fetchTasksByDateField('date_done');
  }

  // 3. Fetch by date_created (catches tasks created in the period but updated AFTER the period)
  if (startDate || endDate) {
    await fetchTasksByDateField('date_created');
  }

  // 4. Fetch OPEN tasks without date filter (catches old tasks like 2 weeks ago that are not closed and haven't been updated)
  // Memastikan task yang masih berjalan (seperti di card development/DRF) tetap ditarik walau tidak ada update baru di minggu ini
  await fetchTasksByDateField('date_updated', true);

  return Array.from(taskMap.values());
};

// Fetch all COMPLETE HOTFIX tasks directly via statuses filter for 100% complete and fast retrieval
export const getCompleteHotfixTasks = async (teamId, token, startDate = null, endDate = null) => {
  const taskMap = new Map();
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      archived: 'false',
      include_closed: 'true',
      subtasks: 'true',
      order_by: 'updated',
      reverse: 'true',
      page: String(page),
      'statuses[]': 'complete hotfix',
    });

    if (startDate) params.append('date_updated_gt', String(startDate));
    if (endDate) params.append('date_updated_lt', String(endDate));

    const data = await fetchWithAuth(`/team/${teamId}/task?${params.toString()}`, token);
    const tasks = data.tasks || [];

    tasks.forEach(t => taskMap.set(t.id, t));

    if (tasks.length < 100) {
      hasMore = false;
    } else {
      page++;
      if (page > 20) break;
    }
  }

  return Array.from(taskMap.values());
};

// Helper: cek apakah status = selesai/complete
export const isCompletedStatus = (task) => {
  const type = (task.status?.type || '').toLowerCase();
  const name = (task.status?.status || '').toLowerCase();
  return (
    type === 'closed' ||
    type === 'done' ||
    name.includes('complete') ||
    name.includes('done') ||
    name === 'closed'
  );
};

// Helper: get start of week (Monday)
export const getWeekStart = (dateValue) => {
  const d = new Date(dateValue);
  const dow = d.getDay();
  const diff = dow === 0 ? 6 : dow - 1; // 0 is Sunday
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Helper: compute deadlines (Wednesday 23:59:59.999)
export const computeDeadlines = (monday) => {
  const wednesday = new Date(monday);
  wednesday.setDate(monday.getDate() + 2);
  wednesday.setHours(23, 59, 59, 999);

  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  thursday.setHours(23, 59, 59, 999);

  const fridayEnd = new Date(monday);
  fridayEnd.setDate(monday.getDate() + 4);
  fridayEnd.setHours(23, 59, 59, 999);

  return { wednesday, thursday, fridayEnd };
};

// Helper: check if a subtask is late
export const isSubtaskLate = (task, filterStartTs = null, now = Date.now()) => {
  const isSub = !!task.parent || !!task.parentId || task.isSubtask;
  if (!isSub) return false;

  const rawDone = task.date_done || task.dateDone ? parseInt(task.date_done || task.dateDone, 10) : null;
  const rawCreated = task.date_created || task.dateCreated ? parseInt(task.date_created || task.dateCreated, 10) : null;
  const doneTime = (rawDone && (!rawCreated || rawDone >= rawCreated)) ? rawDone : rawDone;

  // Acuan minggu: tanggal selesai, tanggal awal filter, atau tanggal dibuat / saat ini
  const refTime = doneTime || filterStartTs || rawCreated || now;
  const weekMonday = getWeekStart(refTime);
  const deadlines = computeDeadlines(weekMonday);
  let deadline = deadlines.wednesday.getTime();

  const isDrf = (task.name || '').toLowerCase().includes('drf');

  // Jika ada due_date spesifik di ClickUp dan BUKAN DRF
  const due = task.due_date || task.dueDate;
  if (due && !isDrf) {
    const dueMs = parseInt(due, 10);
    const dDue = new Date(dueMs);
    const isNoTime =
      task.due_date_time === false ||
      task.due_date_time === 'false' ||
      task.dueDateTime === false ||
      task.dueDateTime === 'false' ||
      (dDue.getHours() === 0 && dDue.getMinutes() === 0 && dDue.getSeconds() === 0);

    if (isNoTime) {
      dDue.setHours(23, 59, 59, 999);
      deadline = dDue.getTime();
    } else {
      deadline = dueMs;
    }
  } else if (!isDrf) {
    // Jika tidak ada due_date spesifik dan BUKAN DRF, maka tidak pernah telat
    return false;
  }
  // Jika DRF, selalu gunakan aturan baku (Rabu 23:59) terlepas dari due_date ClickUp

  if (doneTime) {
    return doneTime > deadline;
  } else {
    return now > deadline;
  }
};

// Check if main task is late for Dev/DFT/UAT
export const isMainTaskLate = (task, devDoneTime, filterStartTs = null, now = Date.now()) => {
  let isLate = false;

  // 1. Check Dev Late (Wednesday)
  const devTaskMonday = getWeekStart(devDoneTime || filterStartTs || now);
  const devDeadlines = computeDeadlines(devTaskMonday);
  if (devDoneTime) {
    if (devDoneTime > devDeadlines.wednesday.getTime()) isLate = true;
  } else {
    if (now > devDeadlines.wednesday.getTime()) isLate = true;
  }

  // 2. Check DFT/UAT Late if Dev is done
  if (devDoneTime) {
    const mcMonday = getWeekStart(devDoneTime);
    const mcDeadlines = computeDeadlines(mcMonday);
    
    const currentStatus = task.status?.status || '';
    const s = currentStatus.toLowerCase().trim();
    
    // Heuristic for DFT done
    const isDftDone = s.includes('testing dft') || s.includes('ready uat') || s.includes('revision uat') || s.includes('ontesting uat') || s.includes('release') || s.includes('complete') || s.includes('live') || s === 'closed';
    
    // Heuristic for UAT done
    const isUatDone = s.includes('release') || s.includes('complete') || s.includes('live') || s === 'closed';
    
    // If it's not done with DFT, is it past Thursday?
    if (!isDftDone && now > mcDeadlines.thursday.getTime()) {
      isLate = true;
    }
    
    // If it's not done with UAT, is it past Friday?
    if (!isUatDone && now > mcDeadlines.fridayEnd.getTime()) {
      isLate = true;
    }
  }
  
  return isLate;
};

// Parse and aggregate task data per person
export const aggregateTasksByAssignee = (tasks, filterStartTs = null) => {
  const assigneeMap = new Map();
  const devDataMap = {};

  // First pass: find all DRF subtasks to build devDataMap
  for (const task of tasks) {
    const isSubtask = !!task.parent;
    const lowerName = (task.name || '').toLowerCase();
    
    if (isSubtask && lowerName.includes('drf')) {
      const parentId = task.parent;
      const rawDone = task.date_done ? parseInt(task.date_done) : null;
      const rawCreated = task.date_created ? parseInt(task.date_created) : null;
      const dDone = (rawDone && (!rawCreated || rawDone >= rawCreated)) ? rawDone : rawDone;
      
      if (!devDataMap[parentId]) {
        devDataMap[parentId] = { doneDate: dDone, assignees: task.assignees ? [...task.assignees] : [] };
      } else {
        if (dDone && (!devDataMap[parentId].doneDate || dDone > devDataMap[parentId].doneDate)) {
          devDataMap[parentId].doneDate = dDone;
        }
        if (task.assignees) {
          task.assignees.forEach(a => {
            if (!devDataMap[parentId].assignees.find(existing => existing.id === a.id)) {
              devDataMap[parentId].assignees.push(a);
            }
          });
        }
      }
    }
  }

  // Pre-calculate lateness for all parent BRD tasks
  const parentLatenessMap = {};
  for (const task of tasks) {
    const lowerName = (task.name || '').toLowerCase();
    if (!task.parent && lowerName.includes('brd') && !lowerName.includes('oos') && !lowerName.includes('hotfix')) {
       const devDoneTime = devDataMap[task.id]?.doneDate;
       parentLatenessMap[task.id] = isMainTaskLate(task, devDoneTime, filterStartTs);
    }
  }

  const processTask = (task, isSubtask = false) => {
    const lowerName = (task.name || '').toLowerCase();
    
    // Abaikan OOS dan Hotfix
    if (lowerName.includes('oos') || lowerName.includes('hotfix')) return;

    const isBrd = lowerName.includes('brd');
    const isDrf = lowerName.includes('drf');

    // Hanya proses BRD (sebagai task utama) dan DRF (sebagai subtask)
    if (!isBrd && !isDrf) return;

    let targetAssignees = task.assignees ? [...task.assignees] : [];

    // Jika ini BRD (Task Utama), tambahkan assignee dari DRF-nya agar developer DRF juga mendapat evaluasi task utama
    if (isBrd && !task.parent) {
      const devAssignees = devDataMap[task.id]?.assignees || [];
      devAssignees.forEach(dev => {
        if (!targetAssignees.find(a => a.id === dev.id)) {
          targetAssignees.push(dev);
        }
      });
    }

    if (targetAssignees.length === 0) return;

    for (const assignee of targetAssignees) {
      if (!assigneeMap.has(assignee.id)) {
        assigneeMap.set(assignee.id, {
          id: assignee.id,
          name: assignee.username || assignee.email,
          email: assignee.email,
          profilePicture: assignee.profilePicture,
          color: assignee.color,
          tasks: [],
          subtasks: [],
          totalTasks: 0,
          totalSubtasks: 0,
          completedTasks: 0,
          completedSubtasks: 0,
          onreleaseSubtasks: 0,
          lateTasks: 0,
          lateSubtasks: 0,
          onTimeSubtasks: 0,
          statusBreakdown: {},
          priorityBreakdown: {},
        });
      }

      const person = assigneeMap.get(assignee.id);
      const isDone = isCompletedStatus(task);
      const statusName = (task.status?.status || '').toLowerCase().trim();
      const isOnrelease = statusName.includes('onrelease') || statusName.includes('on release') || statusName.includes('complete') || statusName.includes('done') || statusName === 'closed';

      const rawDone = task.date_done ? parseInt(task.date_done) : null;
      const rawCreated = task.date_created ? parseInt(task.date_created) : null;
      const sanitizedDone = (rawDone && (!rawCreated || rawDone >= rawCreated)) ? rawDone : (rawCreated || rawDone);

      const isSub = isSubtask || !!task.parent;
      const taskData = {
        id: task.id,
        name: task.name,
        status: task.status?.status || 'unknown',
        statusColor: task.status?.color || '#94a3b8',
        statusType: task.status?.type || 'unknown',
        priority: task.priority?.priority || null,
        dueDate: task.due_date ? parseInt(task.due_date) : null,
        dueDateTime: task.due_date_time,
        dateUpdated: task.date_updated ? parseInt(task.date_updated) : null,
        dateDone: sanitizedDone,
        dateCreated: rawCreated,
        url: task.url,
        listId: task.list?.id,
        listName: task.list?.name || 'Unknown List',
        parentId: task.parent || null,
        isSubtask: isDrf, // Gunakan penanda spesifik DRF
        isCompleted: isDone,
        isLate: false,
      };

      if (taskData.isSubtask) {
        // Late information derived from the parent BRD task
        const late = parentLatenessMap[task.parent] || false;
        taskData.isLate = late;
        person.subtasks.push(taskData);
        person.totalSubtasks++;
        if (isDone) person.completedSubtasks++;
        if (late) person.lateSubtasks++;
        // Count parent BRD task's onrelease status for completion tracking
        const parentTask = tasks.find(t => t.id === task.parent);
        if (parentTask) {
          const parentStatus = (parentTask.status?.status || '').toLowerCase().trim();
          if (parentStatus.includes('onrelease') || parentStatus.includes('on release') || parentStatus.includes('complete') || parentStatus.includes('done') || parentStatus === 'closed') {
            person.onreleaseSubtasks++;
          }
        }
      } else if (isBrd) {
        const devDoneTime = devDataMap[task.id]?.doneDate;
        const late = parentLatenessMap[task.id] || false;
        taskData.isLate = late;
        person.tasks.push(taskData);
        person.totalTasks++;
        if (isDone) person.completedTasks++;
        if (late) person.lateTasks++;
      }

      // Status breakdown — simpan nama aslinya
      const statusKey = task.status?.status || 'unknown';
      person.statusBreakdown[statusKey] = (person.statusBreakdown[statusKey] || 0) + 1;

      // Priority breakdown
      const priorityKey = task.priority?.priority || 'none';
      person.priorityBreakdown[priorityKey] = (person.priorityBreakdown[priorityKey] || 0) + 1;
    }
  };

  for (const task of tasks) {
    const isSubtask = !!task.parent;
    processTask(task, isSubtask);
  }

  return Array.from(assigneeMap.values()).map(person => {
    const totalItems = person.totalSubtasks;
    
    // Late Rate = persentase subtask yang late
    const onTimeSubtasks = Math.max(0, person.totalSubtasks - person.lateSubtasks);
    const lateRate = totalItems > 0 
      ? Math.round((person.lateSubtasks / totalItems) * 100) 
      : 0;

    // Completion Rate = berdasarkan parent BRD yang sudah onrelease/complete
    const completionRate = totalItems > 0
      ? Math.round((person.onreleaseSubtasks / totalItems) * 100)
      : 0;

    return {
      ...person,
      completionRate,
      lateRate,
      onTimeSubtasks,
      totalItems,
    };
  });
};

// Format date for display
export const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

// Format date for input
export const formatDateForInput = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Date to timestamp (start of day)
export const dateToTimestamp = (dateStr) => {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// Date to timestamp (end of day)
export const dateToEndTimestamp = (dateStr) => {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

// Get default date range (last 1 week)
export const getDefaultDateRange = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7); // Changed from 1 month to 7 days

  return {
    startDate: formatDateForInput(start),
    endDate: formatDateForInput(end),
  };
};

// Get task status class
export const getStatusClass = (status) => {
  const s = status?.toLowerCase() || '';
  if (s.includes('complete') || s.includes('done') || s.includes('closed')) return 'status-complete';
  if (s.includes('progress') || s.includes('in review') || s.includes('active')) return 'status-in-progress';
  if (s.includes('review') || s.includes('testing')) return 'status-review';
  if (s.includes('block') || s.includes('stuck')) return 'status-blocked';
  return 'status-to-do';
};

// Get priority class
export const getPriorityClass = (priority) => {
  const p = (priority || '').toLowerCase();
  if (p === 'urgent') return 'priority-urgent';
  if (p === 'high') return 'priority-high';
  if (p === 'normal') return 'priority-normal';
  if (p === 'low') return 'priority-low';
  return '';
};

// Get priority icon
export const getPriorityIcon = (priority) => {
  const p = (priority || '').toLowerCase();
  if (p === 'urgent') return '🔴';
  if (p === 'high') return '🟠';
  if (p === 'normal') return '🔵';
  if (p === 'low') return '⚪';
  return '⚪';
};

// Get initials from name
export const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.split(/[\s._@]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

// Format relative time
export const formatRelativeTime = (timestamp) => {
  if (!timestamp) return '-';
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m lalu`;
  if (hours < 24) return `${hours}j lalu`;
  if (days < 30) return `${days}h lalu`;
  return formatDate(timestamp);
};
