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
  const fetchTasksByDateField = async (dateField) => {
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
      });

      if (startDate) params.append(`${dateField}_gt`, String(startDate));
      if (endDate) params.append(`${dateField}_lt`, String(endDate));

      const data = await fetchWithAuth(`/team/${teamId}/task?${params.toString()}`, token);
      const tasks = data.tasks || [];

      tasks.forEach(t => taskMap.set(t.id, t));

      if (tasks.length < 100) {
        hasMore = false;
      } else {
        page++;
        if (page > 10) break;
      }
    }
  };

  // 1. Fetch by date_updated (catches tasks worked on or created during the period)
  await fetchTasksByDateField('date_updated');

  // 2. Fetch by date_done (catches tasks completed in the period but updated AFTER the period)
  // Only need to run this if dates are provided, otherwise date_updated already gets everything
  if (startDate || endDate) {
    await fetchTasksByDateField('date_done');
  }

  // 3. Fetch by date_created (catches tasks created in the period but updated AFTER the period)
  if (startDate || endDate) {
    await fetchTasksByDateField('date_created');
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

// Parse and aggregate task data per person
export const aggregateTasksByAssignee = (tasks) => {
  const assigneeMap = new Map();

  const processTask = (task, isSubtask = false) => {
    if (!task.assignees || task.assignees.length === 0) return;

    for (const assignee of task.assignees) {
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
          statusBreakdown: {},
          priorityBreakdown: {},
        });
      }

      const person = assigneeMap.get(assignee.id);
      const isDone = isCompletedStatus(task);

      const taskData = {
        id: task.id,
        name: task.name,
        status: task.status?.status || 'unknown',
        statusColor: task.status?.color || '#94a3b8',
        statusType: task.status?.type || 'unknown',
        priority: task.priority?.priority || null,
        dueDate: task.due_date ? parseInt(task.due_date) : null,
        dateUpdated: task.date_updated ? parseInt(task.date_updated) : null,
        dateDone: task.date_done ? parseInt(task.date_done) : null,
        dateCreated: task.date_created ? parseInt(task.date_created) : null,
        url: task.url,
        listId: task.list?.id,
        listName: task.list?.name || 'Unknown List',
        parentId: task.parent || null,
        isSubtask: isSubtask || !!task.parent,
        isCompleted: isDone,
      };

      if (taskData.isSubtask) {
        person.subtasks.push(taskData);
        person.totalSubtasks++;
        if (isDone) person.completedSubtasks++;
      } else {
        person.tasks.push(taskData);
        person.totalTasks++;
        if (isDone) person.completedTasks++;
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
    const totalItems = person.totalTasks + person.totalSubtasks;
    const completedAll = person.completedTasks + person.completedSubtasks;
    const completionRate = totalItems > 0
      ? Math.round((completedAll / totalItems) * 100)
      : 0;

    return {
      ...person,
      completionRate,
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

// Get default date range (last 1 month)
export const getDefaultDateRange = () => {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 1);

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
