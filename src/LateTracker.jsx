import React, { useState, useEffect, useMemo } from 'react';
import { getAllTeamTasks, getStatusClass, getDefaultDateRange, dateToTimestamp, dateToEndTimestamp, formatDateForInput, getTaskTimeInStatus } from './clickupApi';

const CUSTOM_DATES_KEY = 'clickup_custom_phase_dates';
const AUTO_CACHE_KEY = 'clickup_auto_phase_cache';

// Replaced by API call to backend
const getInitialCustomDates = () => {
  return {};
};

// Get start of the week (Monday) for a given date
const getWeekStart = (dateValue) => {
  const d = new Date(dateValue);
  const dow = d.getDay();
  const diff = dow === 0 ? 6 : dow - 1; // 0 is Sunday
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Compute deadlines for a given monday
const computeDeadlines = (monday) => {
  // Rabu (Wednesday) 23:59
  const wednesday = new Date(monday);
  wednesday.setDate(monday.getDate() + 2);
  wednesday.setHours(23, 59, 59, 999);

  // Kamis (Thursday) 23:59
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  thursday.setHours(23, 59, 59, 999);

  // Jumat (Friday) 11:59
  const fridayNoon = new Date(monday);
  fridayNoon.setDate(monday.getDate() + 4);
  fridayNoon.setHours(11, 59, 59, 999);

  // Jumat (Friday) 23:59
  const fridayEnd = new Date(monday);
  fridayEnd.setDate(monday.getDate() + 4);
  fridayEnd.setHours(23, 59, 59, 999);

  return { wednesday, thursday, fridayNoon, fridayEnd };
};

// Check if a status is considered "Done" (or beyond) for a specific phase
const isBeyondPhase = (status, phase) => {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  
  if (phase === 'DFT') {
    return s.includes('testing dft') || s.includes('staging') || s.includes('ready uat') || s.includes('revision uat') || s.includes('ontesting uat') || s.includes('release') || s.includes('complete') || s.includes('live') || s === 'closed';
  }
  if (phase === 'Staging') {
    return s.includes('ready uat') || s.includes('revision uat') || s.includes('ontesting uat') || s.includes('release') || s.includes('complete') || s.includes('live') || s === 'closed';
  }
  if (phase === 'UAT') {
    return s.includes('release') || s.includes('complete') || s.includes('live') || s === 'closed';
  }
  return false;
};

// Parse timestamp from ClickUp time_in_status response if available (Business Plan+)
const getPhaseTimestamp = (historyData, phase) => {
  if (!historyData) return null;
  
  let foundTimestamp = null;

  const checkStatus = (statusObj) => {
    if (!statusObj || !statusObj.status || !statusObj.total_time || !statusObj.total_time.since) return;
    const s = statusObj.status.toLowerCase().trim();
    
    let isMatch = false;
    if (phase === 'DFT') {
      isMatch = s.includes('dft') || s.includes('testing dft');
    } else if (phase === 'Staging') {
      isMatch = s.includes('ready uat') || s.includes('staging');
    } else if (phase === 'UAT') {
      isMatch = s.includes('release') || s.includes('onrelease') || s.includes('complete') || s === 'closed' || s === 'done';
    }
    
    if (isMatch) {
      const ts = parseInt(statusObj.total_time.since);
      if (!foundTimestamp || ts < foundTimestamp) {
        foundTimestamp = ts;
      }
    }
  };

  if (historyData.status_history) {
    historyData.status_history.forEach(checkStatus);
  }
  if (historyData.current_status) {
    checkStatus(historyData.current_status);
  }

  return foundTimestamp;
};

// Resolver for phase timestamps avoiding fake identical timestamp duplication
const resolvePhaseTime = (task, phase, currentStatus, dUpdate, historyData, customDates, autoCache) => {
  // 1. Manual user override (from ClickUp history)
  if (customDates && customDates[task.id]?.[phase]) {
    return { time: customDates[task.id][phase], isManual: true };
  }

  // 2. ClickUp API time_in_status (if workspace has Business+ plan)
  if (historyData) {
    const ts = getPhaseTimestamp(historyData, phase);
    if (ts) return { time: ts, isManual: false };
  }

  // 3. Auto cache captured during app sessions
  if (autoCache && autoCache[task.id]?.[phase]) {
    return { time: autoCache[task.id][phase], isManual: false };
  }

  // 4. Exact match with CURRENT status
  const s = currentStatus.toLowerCase().trim();
  if (phase === 'DFT' && s.includes('testing dft staging')) {
    return { time: dUpdate, isManual: false };
  }
  if (phase === 'Staging' && s === 'ready uat') {
    return { time: dUpdate, isManual: false };
  }
  if (phase === 'UAT' && s.includes('onrelease')) {
    return { time: dUpdate, isManual: false };
  }
  if (phase === 'UAT' && (s.includes('complete') || s === 'closed')) {
    const dDone = task.date_done ? parseInt(task.date_done) : dUpdate;
    return { time: dDone, isManual: false };
  }

  // 5. If card already passed this phase, return null rather than overwriting with newer status timestamp!
  return { time: null, isManual: false };
};

// Helper: cek apakah task berada di dalam periode rentang tanggal (filter)
const isTaskInPeriod = (task, devData, startTs, endTs) => {
  if (!startTs || !endTs) return true;
  if (!devData) return false;

  const devDoneTime = devData.doneDate;
  if (devDoneTime) {
    // Jika Developer sudah selesai (Done Dev), gunakan devDoneTime sebagai acuan minggu/siklus
    return devDoneTime >= startTs && devDoneTime <= endTs;
  }

  // Jika belum Done Dev (devDoneTime null)
  const drfCreated = devData.createdDate;
  const taskCreated = task.date_created ? parseInt(task.date_created) : null;
  const taskDue = task.due_date ? parseInt(task.due_date) : null;
  const taskStart = task.start_date ? parseInt(task.start_date) : null;
  const taskDone = task.date_done ? parseInt(task.date_done) : null;

  // Jika card utama sudah selesai/closed di luar rentang tanggal, skip
  if (taskDone && (taskDone < startTs || taskDone > endTs)) {
    return false;
  }

  const earliestCreated = drfCreated || taskCreated;
  if (earliestCreated && earliestCreated > endTs) {
    return false;
  }

  const isDueInRange = taskDue && taskDue >= startTs && taskDue <= endTs;
  const isStartInRange = taskStart && taskStart >= startTs && taskStart <= endTs;
  const isCreatedInRange = earliestCreated && earliestCreated >= startTs && earliestCreated <= endTs;

  if (isDueInRange || isStartInRange || isCreatedInRange) {
    return true;
  }

  const taskUpdated = task.date_updated ? parseInt(task.date_updated) : null;
  const wasActiveInRange = taskUpdated && taskUpdated >= startTs && taskUpdated <= endTs;
  return wasActiveInRange;
};

export default function LateTracker({ apiToken, selectedTeam, addToast }) {
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lateItems, setLateItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  
  // Pagination for Late Items & All Items
  const [latePage, setLatePage] = useState(1);
  const [latePerPage, setLatePerPage] = useState(10);
  const [allPage, setAllPage] = useState(1);
  const [allPerPage, setAllPerPage] = useState(10);
  
  // Filter & Search states
  const [allSearch, setAllSearch] = useState('');
  const [allPhaseFilter, setAllPhaseFilter] = useState('All');
  const [lateSearch, setLateSearch] = useState('');
  const [latePhaseFilter, setLatePhaseFilter] = useState('All');
  
  // Custom Dates (manual overrides from ClickUp history log)
  const [customDates, setCustomDates] = useState(getInitialCustomDates);

  // Task Reasons (manual delay/explanation reasons from DB)
  const [taskReasons, setTaskReasons] = useState({});

  // Cached raw tasks to re-evaluate instantly when custom dates or reasons are edited
  const [cachedTasks, setCachedTasks] = useState(null);
  const [cachedDevDataMap, setCachedDevDataMap] = useState(null);
  const [cachedStatusHistoryMap, setCachedStatusHistoryMap] = useState({});

  // Fetch initial custom dates and reasons from backend API
  useEffect(() => {
    fetch('http://localhost:3001/api/manual-dates')
      .then(res => res.json())
      .then(data => {
        setCustomDates(data);
        if (cachedTasks && cachedDevDataMap) {
          evaluateTasks(cachedTasks, cachedDevDataMap, cachedStatusHistoryMap, data, taskReasons);
        }
      })
      .catch(err => {
        console.error('Failed to fetch custom dates:', err);
      });

    fetch('http://localhost:3001/api/task-reasons')
      .then(res => res.json())
      .then(data => {
        setTaskReasons(data);
        if (cachedTasks && cachedDevDataMap) {
          evaluateTasks(cachedTasks, cachedDevDataMap, cachedStatusHistoryMap, customDates, data);
        }
      })
      .catch(err => {
        console.error('Failed to fetch task reasons:', err);
      });
  }, [cachedTasks, cachedDevDataMap]);

  // Modal State for editing/inputting date
  const [editModal, setEditModal] = useState({
    isOpen: false,
    taskId: null,
    taskName: '',
    phase: null,
    currentValue: '',
  });

  // Modal State for editing/inputting reason
  const [reasonModal, setReasonModal] = useState({
    isOpen: false,
    taskId: null,
    taskName: '',
    currentValue: '',
  });

  // Dashboard summaries
  const [summary, setSummary] = useState({
    dev: 0,
    dft: 0,
    staging: 0,
    uat: 0
  });

  // Core task evaluation function
  const evaluateTasks = (tasks, devDataMap, statusHistoryMap, cDates, cReasons, fStart = startDate, fEnd = endDate) => {
    const currentReasons = cReasons || taskReasons || {};
    let autoCache = {};
    try {
      const raw = localStorage.getItem(AUTO_CACHE_KEY);
      if (raw) autoCache = JSON.parse(raw);
    } catch (e) {}

    const filterStartTs = fStart ? dateToTimestamp(fStart) : null;
    const filterEndTs = fEnd ? dateToEndTimestamp(fEnd) : null;

    const lateViolations = [];
    const allTrackedItems = [];
    const now = new Date();

    let countDev = 0;
    let countDft = 0;
    let countStaging = 0;
    let countUat = 0;

    tasks.forEach(task => {
      const isSubtask = !!task.parent;
      if (isSubtask) return; // Hanya proses Card Utama (Task)
      
      const devData = devDataMap[task.id];
      if (!devData || devData.assignees.length === 0) return;

      // Filter ketat tanggal sesuai rentang yang dipilih
      if (!isTaskInPeriod(task, devData, filterStartTs, filterEndTs)) {
        return;
      }
      
      const currentStatus = task.status?.status || '';
      const dUpdate = task.date_updated ? parseInt(task.date_updated) : null;
      
      const devDoneTime = devData.doneDate;
      const devTaskMonday = getWeekStart(devDoneTime || filterStartTs || now.getTime());
      const devDeadlines = computeDeadlines(devTaskMonday);

      devData.assignees.forEach(assignee => {
        const personName = assignee.username || assignee.email;
        const avatar = assignee.profilePicture || '';
        
        // Evaluasi Dev Lateness
        let isDevLate = false;
        let devDoneStr = "-";

        if (devDoneTime) {
          devDoneStr = new Date(devDoneTime).toLocaleString('id-ID');
          if (devDoneTime > devDeadlines.wednesday.getTime()) {
            isDevLate = true;
            countDev++;
            lateViolations.push({
              id: task.id + "-dev-" + assignee.id,
              taskId: task.id,
              taskName: task.name,
              url: task.url,
              assigneeName: personName,
              avatar: avatar,
              type: 'Task',
              latePhase: 'Late Dev',
              deadlineStr: `Rabu 23:59 (${devDeadlines.wednesday.toLocaleDateString('id-ID')})`,
              currentStatus: "Done Dev",
              statusColor: "#10b981",
              recordedTime: devDoneStr,
              reason: currentReasons[task.id] || ''
            });
          }
        } else {
          devDoneStr = "Belum Selesai";
          if (now.getTime() > devDeadlines.wednesday.getTime()) {
            isDevLate = true;
            countDev++;
            lateViolations.push({
              id: task.id + "-dev-" + assignee.id,
              taskId: task.id,
              taskName: task.name,
              url: task.url,
              assigneeName: personName,
              avatar: avatar,
              type: 'Task',
              latePhase: 'Late Dev',
              deadlineStr: `Rabu 23:59 (${devDeadlines.wednesday.toLocaleDateString('id-ID')})`,
              currentStatus: "Belum Selesai",
              statusColor: "#f59e0b",
              recordedTime: devDoneStr,
              reason: currentReasons[task.id] || ''
            });
          }
        }

        // Evaluasi DFT, Staging, UAT (Hanya jika Dev selesai)
        let cardIsLate = isDevLate;
        let cardLateMessages = isDevLate ? ["Dev"] : [];
        let dftStr = "-";
        let stagingStr = "-";
        let uatStr = "-";

        let rawDft = null, rawStaging = null, rawUat = null;
        let isDftManual = false, isStagingManual = false, isUatManual = false;

        if (devDoneTime) {
          const mcMonday = getWeekStart(devDoneTime);
          const mcDeadlines = computeDeadlines(mcMonday);

          const isDftDone = isBeyondPhase(currentStatus, 'DFT');
          const isStagingDone = isBeyondPhase(currentStatus, 'Staging');
          const isUatDone = isBeyondPhase(currentStatus, 'UAT');

          const historyData = statusHistoryMap ? statusHistoryMap[task.id] : null;

          const resDft = resolvePhaseTime(task, 'DFT', currentStatus, dUpdate, historyData, cDates, autoCache);
          const resStaging = resolvePhaseTime(task, 'Staging', currentStatus, dUpdate, historyData, cDates, autoCache);
          const resUat = resolvePhaseTime(task, 'UAT', currentStatus, dUpdate, historyData, cDates, autoCache);

          rawDft = resDft.time;
          isDftManual = resDft.isManual;
          rawStaging = resStaging.time;
          isStagingManual = resStaging.isManual;
          rawUat = resUat.time;
          isUatManual = resUat.isManual;

          let isDftLate = false, isStagingLate = false, isUatLate = false;

          // 1. DFT
          if (rawDft) {
            dftStr = new Date(rawDft).toLocaleString('id-ID');
            if (rawDft > mcDeadlines.thursday.getTime()) isDftLate = true;
          } else if (isDftDone) {
            dftStr = "Selesai (N/A)";
          } else {
            dftStr = "Belum Selesai";
            if (now.getTime() > mcDeadlines.thursday.getTime()) isDftLate = true;
          }

          // 2. Staging
          if (rawStaging) {
            stagingStr = new Date(rawStaging).toLocaleString('id-ID');
            if (rawStaging > mcDeadlines.fridayNoon.getTime()) isStagingLate = true;
          } else if (isStagingDone) {
            stagingStr = "Selesai (N/A)";
          } else {
            stagingStr = "Belum Selesai";
            if (now.getTime() > mcDeadlines.fridayNoon.getTime()) isStagingLate = true;
          }

          // 3. UAT
          if (rawUat) {
            uatStr = new Date(rawUat).toLocaleString('id-ID');
            if (rawUat > mcDeadlines.fridayEnd.getTime()) isUatLate = true;
          } else if (isUatDone) {
            uatStr = "Selesai (N/A)";
          } else {
            uatStr = "Belum Selesai";
            if (now.getTime() > mcDeadlines.fridayEnd.getTime()) isUatLate = true;
          }

          // Push ke late violations
          const pushLate = (phaseKey, phaseName, deadlineTime, recTime) => {
            lateViolations.push({
              id: task.id + "-" + phaseKey + "-" + assignee.id,
              taskId: task.id,
              taskName: task.name,
              url: task.url,
              assigneeName: personName,
              avatar: avatar,
              type: 'Task',
              latePhase: phaseName,
              deadlineStr: `${phaseName.replace('Late ', '')} - ${phaseName.includes('Staging') ? 'Jumat 11:59' : (phaseName.includes('DFT') ? 'Kamis 23:59' : 'Jumat 23:59')} (${new Date(deadlineTime).toLocaleDateString('id-ID')})`,
              currentStatus: currentStatus,
              statusColor: task.status?.color,
              recordedTime: recTime || (dUpdate ? new Date(dUpdate).toLocaleString('id-ID') : "-"),
              reason: currentReasons[task.id] || ''
            });
          };

          if (isDftLate) { cardIsLate = true; cardLateMessages.push("DFT"); countDft++; pushLate('DFT', 'Late DFT', mcDeadlines.thursday.getTime(), dftStr); }
          if (isStagingLate) { cardIsLate = true; cardLateMessages.push("Staging"); countStaging++; pushLate('Staging', 'Late Staging', mcDeadlines.fridayNoon.getTime(), stagingStr); }
          if (isUatLate) { cardIsLate = true; cardLateMessages.push("UAT"); countUat++; pushLate('UAT', 'Late UAT', mcDeadlines.fridayEnd.getTime(), uatStr); }
        }

        allTrackedItems.push({
          id: task.id + "-summary-" + assignee.id,
          taskId: task.id,
          taskName: task.name,
          url: task.url,
          assigneeName: personName,
          avatar: avatar,
          type: 'Task',
          latePhase: 'Seluruh Fase',
          deadlineStr: devDoneTime ? `Minggu Dev: ${new Date(devDoneTime).toLocaleDateString('id-ID')}` : 'Menunggu Dev',
          currentStatus: currentStatus,
          statusColor: task.status?.color,
          doneDev: devDoneStr,
          doneDft: dftStr,
          doneStaging: stagingStr,
          doneUat: uatStr,
          rawDft,
          rawStaging,
          rawUat,
          isDftManual,
          isStagingManual,
          isUatManual,
          isLate: cardIsLate,
          statusText: cardIsLate ? `Terlambat (${cardLateMessages.join(', ')})` : ((isBeyondPhase(currentStatus, 'UAT') || rawUat) ? "Selesai Semua (On Time)" : "On Track"),
          devDoneTimeRaw: devDoneTime || Number.MAX_SAFE_INTEGER,
          reason: currentReasons[task.id] || ''
        });
      });
    });

    lateViolations.sort((a, b) => a.assigneeName.localeCompare(b.assigneeName));
    allTrackedItems.sort((a, b) => {
      if (a.assigneeName !== b.assigneeName) return a.assigneeName.localeCompare(b.assigneeName);
      return a.devDoneTimeRaw - b.devDoneTimeRaw;
    });

    setLateItems(lateViolations);
    setAllItems(allTrackedItems);
    setSummary({ dev: countDev, dft: countDft, staging: countStaging, uat: countUat });
    setLatePage(1);
    setAllPage(1);
  };

  const fetchLateTasks = async () => {
    if (!apiToken || !selectedTeam) {
      addToast('Pastikan API Token dan Workspace sudah terpilih', 'error');
      return;
    }

    if (!startDate || !endDate) {
      addToast('Pilih tanggal mulai dan selesai', 'error');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const startTs = dateToTimestamp(startDate);
      const endTs = dateToEndTimestamp(endDate);
      
      const tasks = await getAllTeamTasks(selectedTeam.id, startTs, endTs, apiToken);
      window._debugTasks = tasks;
      
      const targetEmails = [
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

      // 1. Kumpulkan subtask DRF untuk Developer dan devDoneDate
      const devDataMap = {};
      
      tasks.forEach(task => {
        const isSubtask = !!task.parent;
        const lowerName = (task.name || '').toLowerCase();
        
        if (isSubtask && lowerName.includes('drf')) {
          const parentId = task.parent;
          const dDone = task.date_done ? parseInt(task.date_done) : null;
          const dCreated = task.date_created ? parseInt(task.date_created) : null;
          
          if (!devDataMap[parentId]) {
            devDataMap[parentId] = {
              doneDate: dDone,
              createdDate: dCreated,
              assignees: []
            };
          } else {
            if (dDone && (!devDataMap[parentId].doneDate || dDone > devDataMap[parentId].doneDate)) {
              devDataMap[parentId].doneDate = dDone;
            }
            if (dCreated && (!devDataMap[parentId].createdDate || dCreated < devDataMap[parentId].createdDate)) {
              devDataMap[parentId].createdDate = dCreated;
            }
          }
          
          if (task.assignees) {
            task.assignees.forEach(a => {
              if (a.email && targetEmails.includes(a.email.toLowerCase())) {
                if (!devDataMap[parentId].assignees.find(existing => existing.id === a.id)) {
                  devDataMap[parentId].assignees.push(a);
                }
              }
            });
          }
        }
      });

      // 2. Update autoCache untuk card yang sedang berada di status tertentu
      let autoCache = {};
      try {
        const raw = localStorage.getItem(AUTO_CACHE_KEY);
        if (raw) autoCache = JSON.parse(raw);
      } catch (e) {}

      let cacheChanged = false;
      tasks.forEach(t => {
        if (t.parent) return; // hanya main tasks
        const s = (t.status?.status || '').toLowerCase().trim();
        const dUp = t.date_updated ? parseInt(t.date_updated) : null;
        if (!dUp) return;

        if (!autoCache[t.id]) autoCache[t.id] = {};

        if (s.includes('testing dft staging')) {
          if (!autoCache[t.id].DFT || autoCache[t.id].DFT < dUp) {
            autoCache[t.id].DFT = dUp;
            cacheChanged = true;
          }
        } else if (s === 'ready uat') {
          if (!autoCache[t.id].Staging || autoCache[t.id].Staging < dUp) {
            autoCache[t.id].Staging = dUp;
            cacheChanged = true;
          }
        } else if (s.includes('onrelease')) {
          if (!autoCache[t.id].UAT || autoCache[t.id].UAT < dUp) {
            autoCache[t.id].UAT = dUp;
            cacheChanged = true;
          }
        }
      });

      if (cacheChanged) {
        try {
          localStorage.setItem(AUTO_CACHE_KEY, JSON.stringify(autoCache));
        } catch (e) {}
      }

      // 3. Coba ambil time_in_status untuk main task jika akun mendukung
      const mainTasksToEvaluate = tasks.filter(task => {
        const isSubtask = !!task.parent;
        if (isSubtask) return false;
        const devData = devDataMap[task.id];
        if (!devData || devData.assignees.length === 0) return false;
        return isTaskInPeriod(task, devData, startTs, endTs);
      });

      const statusHistoryMap = {};
      const chunkSize = 5;
      for (let i = 0; i < mainTasksToEvaluate.length; i += chunkSize) {
        const chunk = mainTasksToEvaluate.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (task) => {
          const history = await getTaskTimeInStatus(task.id, apiToken);
          if (history) {
            statusHistoryMap[task.id] = history;
          }
        }));
      }

      // Simpan di cache state
      setCachedTasks(tasks);
      setCachedDevDataMap(devDataMap);
      setCachedStatusHistoryMap(statusHistoryMap);

      // Jalankan evaluasi
      evaluateTasks(tasks, devDataMap, statusHistoryMap, customDates, taskReasons, startDate, endDate);
      addToast(`✅ Berhasil memuat dan menganalisa data tugas`, 'info');

    } catch (err) {
      setError(err.message);
      addToast(`❌ Gagal memuat data: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Open modal to manually input/edit timestamp from ClickUp history log
  const openEditModal = (taskId, taskName, phase, currentTime) => {
    let initialDate = '';
    if (currentTime) {
      const d = new Date(currentTime);
      const pad = (n) => String(n).padStart(2, '0');
      initialDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    setEditModal({
      isOpen: true,
      taskId,
      taskName,
      phase,
      currentValue: initialDate,
    });
  };

  // Save custom date from Modal
  const handleSaveCustomDate = async () => {
    if (!editModal.taskId || !editModal.phase) return;
    if (!editModal.currentValue) {
      addToast('Silakan pilih tanggal dan jam', 'error');
      return;
    }

    const newTs = new Date(editModal.currentValue).getTime();
    if (isNaN(newTs)) {
      addToast('Format tanggal tidak valid', 'error');
      return;
    }

    const updated = {
      ...customDates,
      [editModal.taskId]: {
        ...(customDates[editModal.taskId] || {}),
        [editModal.phase]: newTs
      }
    };

    setCustomDates(updated);
    
    // Save to Postgres Database via API
    try {
      await fetch('http://localhost:3001/api/manual-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: editModal.taskId,
          phase: editModal.phase,
          timestampMs: newTs
        })
      });
    } catch (e) {
      console.error('Error saving manual date to DB:', e);
      addToast('Gagal menyimpan ke database', 'error');
    }

    // Instantly re-evaluate if tasks are already loaded
    if (cachedTasks && cachedDevDataMap) {
      evaluateTasks(cachedTasks, cachedDevDataMap, cachedStatusHistoryMap, updated, taskReasons);
    }

    setEditModal({ isOpen: false, taskId: null, taskName: '', phase: null, currentValue: '' });
    addToast(`✅ Waktu Done ${editModal.phase} berhasil disimpan`, 'info');
  };

  // Reset custom date
  const handleResetCustomDate = async () => {
    if (!editModal.taskId || !editModal.phase) return;
    const updated = { ...customDates };
    if (updated[editModal.taskId]) {
      delete updated[editModal.taskId][editModal.phase];
      if (Object.keys(updated[editModal.taskId]).length === 0) {
        delete updated[editModal.taskId];
      }
    }

    setCustomDates(updated);
    
    // Delete from Postgres Database via API
    try {
      await fetch(`http://localhost:3001/api/manual-dates/${editModal.taskId}/${editModal.phase}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Error deleting manual date from DB:', e);
    }

    if (cachedTasks && cachedDevDataMap) {
      evaluateTasks(cachedTasks, cachedDevDataMap, cachedStatusHistoryMap, updated, taskReasons);
    }

    setEditModal({ isOpen: false, taskId: null, taskName: '', phase: null, currentValue: '' });
    addToast(`Tanggal kustom direset`, 'info');
  };

  // Open modal to input/edit reason
  const openReasonModal = (taskId, taskName, currentReason) => {
    setReasonModal({
      isOpen: true,
      taskId,
      taskName,
      currentValue: currentReason || '',
    });
  };

  // Save reason from Modal to Postgres DB
  const handleSaveReason = async () => {
    if (!reasonModal.taskId) return;
    const newReason = reasonModal.currentValue.trim();

    const updated = {
      ...taskReasons,
      [reasonModal.taskId]: newReason
    };

    setTaskReasons(updated);

    try {
      await fetch('http://localhost:3001/api/task-reasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: reasonModal.taskId,
          reason: newReason
        })
      });
      addToast('✅ Reason berhasil disimpan ke database', 'info');
    } catch (e) {
      console.error('Error saving reason to DB:', e);
      addToast('Gagal menyimpan reason ke database', 'error');
    }

    if (cachedTasks && cachedDevDataMap) {
      evaluateTasks(cachedTasks, cachedDevDataMap, cachedStatusHistoryMap, customDates, updated);
    }

    setReasonModal({ isOpen: false, taskId: null, taskName: '', currentValue: '' });
  };

  // Reset/Delete reason from Modal and DB
  const handleResetReason = async () => {
    if (!reasonModal.taskId) return;
    const updated = { ...taskReasons };
    delete updated[reasonModal.taskId];

    setTaskReasons(updated);

    try {
      await fetch(`http://localhost:3001/api/task-reasons/${reasonModal.taskId}`, {
        method: 'DELETE'
      });
      addToast('Reason berhasil dihapus dari database', 'info');
    } catch (e) {
      console.error('Error deleting reason from DB:', e);
    }

    if (cachedTasks && cachedDevDataMap) {
      evaluateTasks(cachedTasks, cachedDevDataMap, cachedStatusHistoryMap, customDates, updated);
    }

    setReasonModal({ isOpen: false, taskId: null, taskName: '', currentValue: '' });
  };

  // Filtering for All Items
  const filteredAllItems = useMemo(() => {
    return allItems.filter(item => {
      const searchTxt = allSearch.toLowerCase();
      const matchSearch = item.taskName.toLowerCase().includes(searchTxt) || 
                          item.assigneeName.toLowerCase().includes(searchTxt) ||
                          (item.reason && item.reason.toLowerCase().includes(searchTxt));
                          
      let matchPhase = true;
      if (allPhaseFilter !== 'All') {
        if (allPhaseFilter === 'On Track') {
          matchPhase = item.statusText === 'On Track';
        } else if (allPhaseFilter === 'Completed' || allPhaseFilter === 'Selesai Semua') {
          matchPhase = item.statusText.includes('Selesai Semua');
        } else if (allPhaseFilter === 'All Late' || allPhaseFilter === 'Terlambat (Semua)') {
          matchPhase = item.isLate || item.statusText.includes('Terlambat');
        } else if (allPhaseFilter === 'Late Dev') {
          matchPhase = item.statusText.includes('Terlambat') && item.statusText.includes('Dev');
        } else if (allPhaseFilter === 'Late DFT') {
          matchPhase = item.statusText.includes('Terlambat') && item.statusText.includes('DFT');
        } else if (allPhaseFilter === 'Late Staging') {
          matchPhase = item.statusText.includes('Terlambat') && item.statusText.includes('Staging');
        } else if (allPhaseFilter === 'Late UAT') {
          matchPhase = item.statusText.includes('Terlambat') && item.statusText.includes('UAT');
        } else if (allPhaseFilter === 'Done Dev') {
          matchPhase = Boolean(item.doneDev && item.doneDev !== 'Belum Selesai' && item.doneDev !== '-');
        } else if (allPhaseFilter === 'Done DFT') {
          matchPhase = Boolean(item.doneDft && item.doneDft !== 'Belum Selesai' && item.doneDft !== '-');
        } else if (allPhaseFilter === 'Done Staging') {
          matchPhase = Boolean(item.doneStaging && item.doneStaging !== 'Belum Selesai' && item.doneStaging !== '-');
        } else if (allPhaseFilter === 'Done UAT') {
          matchPhase = Boolean(item.doneUat && item.doneUat !== 'Belum Selesai' && item.doneUat !== '-');
        }
      }
      return matchSearch && matchPhase;
    });
  }, [allItems, allSearch, allPhaseFilter]);

  // Filtering for Late Items
  const filteredLateItems = useMemo(() => {
    return lateItems.filter(item => {
      const searchTxt = lateSearch.toLowerCase();
      const matchSearch = item.taskName.toLowerCase().includes(searchTxt) || 
                          item.assigneeName.toLowerCase().includes(searchTxt) ||
                          (item.reason && item.reason.toLowerCase().includes(searchTxt));
      const matchPhase = latePhaseFilter === 'All' || (item.latePhase && item.latePhase.includes(latePhaseFilter));
      return matchSearch && matchPhase;
    });
  }, [lateItems, lateSearch, latePhaseFilter]);

  // Pagination calculations for Late Items
  const totalLatePages = Math.max(1, Math.ceil(filteredLateItems.length / latePerPage));
  const currentLatePage = Math.min(latePage, totalLatePages);
  const lateStartIdx = (currentLatePage - 1) * latePerPage;
  const lateEndIdx = lateStartIdx + latePerPage;
  const paginatedLateItems = filteredLateItems.slice(lateStartIdx, lateEndIdx);

  // Pagination calculations for All Items
  const totalAllPages = Math.max(1, Math.ceil(filteredAllItems.length / allPerPage));
  const currentAllPage = Math.min(allPage, totalAllPages);
  const allStartIdx = (currentAllPage - 1) * allPerPage;
  const allEndIdx = allStartIdx + allPerPage;
  const paginatedAllItems = filteredAllItems.slice(allStartIdx, allEndIdx);

  return (
    <div style={{ animation: 'fadeInUp 0.4s ease' }}>
      
      {/* Informational Banner about ClickUp API Plan Limitation */}
      <div style={{
        background: 'rgba(59, 130, 246, 0.08)',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 20px',
        marginBottom: 'var(--space-xl)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px'
      }}>
        <span style={{ fontSize: '22px' }}>💡</span>
        <div style={{ fontSize: 'var(--font-sm)', lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
          <strong style={{ color: 'var(--color-text-primary)' }}>Informasi Status Histori ClickUp:</strong>
          <br />
          Workspace <strong>{selectedTeam?.name || 'MOSTRANS-IT'}</strong> berada pada paket <em>Free Forever</em>. ClickUp membatasi API riwayat status (<code>time_in_status</code>) hanya untuk akun <strong>Business Plan</strong> ke atas (Error 403).
          <br />
          • Sistem secara otomatis mencatat waktu saat card sedang aktif di kolom status (<em>On Testing DFT Staging</em>, <em>Ready UAT</em>, <em>Onrelease</em>).
          <br />
          • Untuk card yang sudah <strong>Complete</strong> atau sudah melewati fase sebelumnya, Anda dapat mengklik tombol <strong>✏️</strong> pada kolom fase untuk memasukkan tanggal & jam sesuai log aktivitas di ClickUp.
        </div>
      </div>

      {/* Date Filter */}
      <div className="section-card" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="section-header">
          <div className="section-title">🔍 Filter Tanggal Pencarian</div>
        </div>
        <div style={{ padding: 'var(--space-lg)' }}>
          <div className="filter-grid" style={{ alignItems: 'flex-end' }}>
            <div className="form-group">
              <label className="form-label">Tanggal Mulai</label>
              <input
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
                type="date"
                className="form-control"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                min={startDate}
              />
            </div>
            <div className="form-group">
              <button 
                className="btn btn-primary" 
                onClick={fetchLateTasks}
                disabled={loading}
              >
                {loading ? '⏳ Menganalisa...' : '🔍 Analisa Keterlambatan'}
              </button>
            </div>
          </div>
          
          <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>Aturan Deadline & Sumber Status:</div>
            <ul style={{ paddingLeft: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <li><strong>Done Dev (Subtask):</strong> Rabu 23:59 (dari subtask DRF yang complete)</li>
              <li><strong>Done DFT (Card Utama):</strong> Kamis 23:59 (saat digeser ke <em>On Testing DFT Staging</em>)</li>
              <li><strong>Done Staging (Card Utama):</strong> Jumat 11:59 (saat digeser ke <em>Ready UAT</em>)</li>
              <li><strong>Done UAT (Card Utama):</strong> Jumat 23:59 (saat digeser ke <em>Onrelease</em>)</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-card" style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="error-icon">⚠️</div>
          <div className="error-title">Gagal Menganalisa</div>
          <div className="error-message">{error}</div>
        </div>
      )}

      {/* Summary Dashboard */}
      {lateItems.length > 0 && !loading && (
        <div className="stats-grid" style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>💻</div>
            <div className="stat-value" style={{ color: '#ef4444' }}>{summary.dev}</div>
            <div className="stat-label">Total Late Dev</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(249, 115, 22, 0.1)', color: '#f97316' }}>🧪</div>
            <div className="stat-value" style={{ color: '#f97316' }}>{summary.dft}</div>
            <div className="stat-label">Total Late DFT</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>🚀</div>
            <div className="stat-value" style={{ color: '#f59e0b' }}>{summary.staging}</div>
            <div className="stat-label">Total Late Staging</div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>✅</div>
            <div className="stat-value" style={{ color: '#10b981' }}>{summary.uat}</div>
            <div className="stat-label">Total Late UAT</div>
          </div>
        </div>
      )}

      {/* All Items Section */}
      {allItems.length > 0 && !loading && (
        <div className="section-card" style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="section-header">
            <span className="section-title">
              📋 Semua Evaluasi Tugas
            </span>
            <span className="section-badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--color-primary)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
              {filteredAllItems.length}
            </span>
          </div>

          {/* Filters for Semua Evaluasi Tugas */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap', padding: '0 20px' }}>
            <input 
              type="text" 
              className="form-control"
              placeholder="Search task or assignee..." 
              value={allSearch}
              onChange={(e) => { setAllSearch(e.target.value); setAllPage(1); }}
              style={{ flex: '1', minWidth: '200px', fontSize: '0.9rem' }}
            />
            <select 
              className="form-control"
              value={allPhaseFilter} 
              onChange={(e) => { setAllPhaseFilter(e.target.value); setAllPage(1); }}
              style={{ width: 'auto', minWidth: '220px', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              <option value="All" style={{ background: '#1a1e28', color: '#f1f5f9' }}>All Statuses</option>
              <option value="On Track" style={{ background: '#1a1e28', color: '#f1f5f9' }}>On Track</option>
              <option value="Completed" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Completed (On Time)</option>
              <option value="All Late" style={{ background: '#1a1e28', color: '#f1f5f9' }}>All Late Tasks</option>
              
              <optgroup label="── Late by Phase ──" style={{ background: '#13161f', color: '#94a3b8' }}>
                <option value="Late Dev" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Late Dev</option>
                <option value="Late DFT" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Late DFT</option>
                <option value="Late Staging" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Late Staging</option>
                <option value="Late UAT" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Late UAT</option>
              </optgroup>

              <optgroup label="── Filter by Done Phase ──" style={{ background: '#13161f', color: '#94a3b8' }}>
                <option value="Done Dev" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Done Dev</option>
                <option value="Done DFT" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Done DFT</option>
                <option value="Done Staging" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Done Staging</option>
                <option value="Done UAT" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Done UAT</option>
              </optgroup>
            </select>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '540px', overflowY: 'auto' }}>
            <table className="people-table">
              <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-bg-card)' }}>
                <tr>
                  <th>Anggota / Assignee</th>
                  <th>Tugas / Card</th>
                  <th>Done Dev</th>
                  <th>Done DFT</th>
                  <th>Done Staging</th>
                  <th>Done UAT</th>
                  <th>Status Saat Ini</th>
                  <th>Keterangan (Hasil)</th>
                  <th style={{ minWidth: '180px' }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAllItems.map((item, idx) => (
                  <tr key={item.id} style={{ animationDelay: `${Math.min(idx * 0.02, 0.5)}s`, background: item.isLate ? 'rgba(225, 29, 72, 0.03)' : 'inherit' }}>
                    <td>
                      <div className="person-info">
                        <div className="avatar" style={{ width: 24, height: 24, fontSize: 10, background: 'var(--color-bg-input)' }}>
                          {item.avatar ? <img src={item.avatar} alt="A" /> : (item.assigneeName[0] || '?').toUpperCase()}
                        </div>
                        <div className="person-name" style={{ fontSize: 'var(--font-xs)' }}>{item.assigneeName}</div>
                      </div>
                    </td>
                    <td>
                      <a 
                        href={item.url} 
                        target="_blank" 
                        rel="noreferrer" 
                        style={{ 
                          color: 'var(--color-text-primary)', 
                          textDecoration: 'none', 
                          fontWeight: 500, 
                          display: 'block', 
                          minWidth: '220px', 
                          maxWidth: '380px', 
                          whiteSpace: 'normal', 
                          wordBreak: 'break-word', 
                          lineHeight: 1.45 
                        }} 
                        title={item.taskName}
                      >
                        {item.taskName}
                      </a>
                    </td>
                    {/* Done Dev */}
                    <td style={{ fontSize: 'var(--font-xs)', color: item.doneDev.includes('Belum') ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
                      {item.doneDev}
                    </td>
                    {/* Done DFT */}
                    <td style={{ fontSize: 'var(--font-xs)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: item.doneDft.includes('Belum') || item.doneDft === '-' ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
                          {item.doneDft}
                        </span>
                        <button 
                          onClick={() => openEditModal(item.taskId, item.taskName, 'DFT', item.rawDft)}
                          title={item.isDftManual ? "Tanggal DFT diubah manual (Klik untuk edit/reset)" : "Ubah tanggal Done DFT dari log ClickUp"}
                          style={{
                            background: item.isDftManual ? 'rgba(59, 130, 246, 0.15)' : 'none',
                            border: item.isDftManual ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            padding: '1px 4px',
                            fontSize: 11,
                            opacity: item.isDftManual ? 1 : 0.65,
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = item.isDftManual ? '1' : '0.65';
                            e.currentTarget.style.background = item.isDftManual ? 'rgba(59, 130, 246, 0.15)' : 'none';
                          }}
                        >
                          ✏️
                        </button>
                      </div>
                    </td>
                    {/* Done Staging */}
                    <td style={{ fontSize: 'var(--font-xs)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: item.doneStaging.includes('Belum') || item.doneStaging === '-' ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
                          {item.doneStaging}
                        </span>
                        <button 
                          onClick={() => openEditModal(item.taskId, item.taskName, 'Staging', item.rawStaging)}
                          title={item.isStagingManual ? "Tanggal Staging diubah manual (Klik untuk edit/reset)" : "Ubah tanggal Done Staging dari log ClickUp"}
                          style={{
                            background: item.isStagingManual ? 'rgba(59, 130, 246, 0.15)' : 'none',
                            border: item.isStagingManual ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            padding: '1px 4px',
                            fontSize: 11,
                            opacity: item.isStagingManual ? 1 : 0.65,
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = item.isStagingManual ? '1' : '0.65';
                            e.currentTarget.style.background = item.isStagingManual ? 'rgba(59, 130, 246, 0.15)' : 'none';
                          }}
                        >
                          ✏️
                        </button>
                      </div>
                    </td>
                    {/* Done UAT */}
                    <td style={{ fontSize: 'var(--font-xs)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: item.doneUat.includes('Belum') || item.doneUat === '-' ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
                          {item.doneUat}
                        </span>
                        <button 
                          onClick={() => openEditModal(item.taskId, item.taskName, 'UAT', item.rawUat)}
                          title={item.isUatManual ? "Tanggal UAT diubah manual (Klik untuk edit/reset)" : "Ubah tanggal Done UAT dari log ClickUp"}
                          style={{
                            background: item.isUatManual ? 'rgba(59, 130, 246, 0.15)' : 'none',
                            border: item.isUatManual ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            padding: '1px 4px',
                            fontSize: 11,
                            opacity: item.isUatManual ? 1 : 0.65,
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = item.isUatManual ? '1' : '0.65';
                            e.currentTarget.style.background = item.isUatManual ? 'rgba(59, 130, 246, 0.15)' : 'none';
                          }}
                        >
                          ✏️
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className={`task-status ${getStatusClass(item.currentStatus)}`} style={{ padding: '2px 6px', fontSize: 10 }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: item.statusColor || 'currentColor', display: 'inline-block', flexShrink: 0 }} />
                        {item.currentStatus}
                      </span>
                    </td>
                    <td>
                      <span style={{ 
                        fontWeight: 600, fontSize: 'var(--font-xs)',
                        color: item.statusText.includes('Tepat Waktu') || item.statusText.includes('On Track') || item.statusText.includes('On Time') ? 'var(--color-emerald)' : 'var(--color-rose)'
                      }}>
                        {item.isLate ? '⚠️ ' : '✅ '}{item.statusText}
                      </span>
                    </td>
                    {/* Reason */}
                    <td style={{ fontSize: 'var(--font-xs)', maxWidth: '240px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between' }}>
                        <span 
                          style={{ 
                            color: item.reason ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                            fontStyle: item.reason ? 'normal' : 'italic',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '180px',
                            display: 'inline-block'
                          }} 
                          title={item.reason || 'Klik ikon pensil untuk mengisi reason'}
                        >
                          {item.reason || 'Belum ada'}
                        </span>
                        <button 
                          onClick={() => openReasonModal(item.taskId, item.taskName, item.reason)}
                          title={item.reason ? "Edit reason" : "Tambah reason"}
                          style={{
                            background: item.reason ? 'rgba(59, 130, 246, 0.15)' : 'none',
                            border: item.reason ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            padding: '1px 4px',
                            fontSize: 11,
                            opacity: item.reason ? 1 : 0.65,
                            transition: 'all 0.15s ease',
                            flexShrink: 0
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = item.reason ? '1' : '0.65';
                            e.currentTarget.style.background = item.reason ? 'rgba(59, 130, 246, 0.15)' : 'none';
                          }}
                        >
                          ✏️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Interactive Pagination Bar for All Items */}
          {allItems.length > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderTop: '1px solid var(--color-border-light)',
              background: 'var(--color-bg-card)',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: 'var(--font-xs)', color: 'var(--color-text-secondary)' }}>
                <span>
                  Menampilkan <strong>{allStartIdx + 1}</strong> - <strong>{Math.min(allEndIdx, allItems.length)}</strong> dari <strong>{allItems.length}</strong> tugas
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>Baris:</span>
                  <select
                    value={allPerPage}
                    onChange={(e) => {
                      setAllPerPage(Number(e.target.value));
                      setAllPage(1);
                    }}
                    className="form-control"
                    style={{
                      padding: '3px 8px',
                      fontSize: 'var(--font-xs)',
                      width: 'auto',
                      background: 'var(--color-bg-input)',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>

              {totalAllPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAllPage(1)}
                    disabled={currentAllPage === 1}
                    style={{ padding: '4px 8px', fontSize: 'var(--font-xs)', opacity: currentAllPage === 1 ? 0.35 : 1, cursor: currentAllPage === 1 ? 'not-allowed' : 'pointer' }}
                    title="Halaman Pertama"
                  >
                    «
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAllPage(p => Math.max(1, p - 1))}
                    disabled={currentAllPage === 1}
                    style={{ padding: '4px 10px', fontSize: 'var(--font-xs)', opacity: currentAllPage === 1 ? 0.35 : 1, cursor: currentAllPage === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    ‹ Prev
                  </button>
                  
                  {/* Page number buttons */}
                  {Array.from({ length: totalAllPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalAllPages || Math.abs(p - currentAllPage) <= 1)
                    .reduce((acc, p, idx, arr) => {
                      if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, idx) => item === '...' ? (
                      <span key={`dots-all-${idx}`} style={{ padding: '0 4px', color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)' }}>...</span>
                    ) : (
                      <button
                        key={item}
                        className={`btn ${currentAllPage === item ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setAllPage(item)}
                        style={{
                          padding: '4px 10px',
                          fontSize: 'var(--font-xs)',
                          minWidth: '28px',
                          fontWeight: currentAllPage === item ? 700 : 400
                        }}
                      >
                        {item}
                      </button>
                    ))
                  }

                  <button
                    className="btn btn-secondary"
                    onClick={() => setAllPage(p => Math.min(totalAllPages, p + 1))}
                    disabled={currentAllPage === totalAllPages}
                    style={{ padding: '4px 10px', fontSize: 'var(--font-xs)', opacity: currentAllPage === totalAllPages ? 0.35 : 1, cursor: currentAllPage === totalAllPages ? 'not-allowed' : 'pointer' }}
                  >
                    Next ›
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAllPage(totalAllPages)}
                    disabled={currentAllPage === totalAllPages}
                    style={{ padding: '4px 8px', fontSize: 'var(--font-xs)', opacity: currentAllPage === totalAllPages ? 0.35 : 1, cursor: currentAllPage === totalAllPages ? 'not-allowed' : 'pointer' }}
                    title="Halaman Terakhir"
                  >
                    »
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Results Section (Late Only) */}
      <div className="section-card">
        <div className="section-header">
          <span className="section-title">
            ⚠️ Daftar Tugas Terlambat (Late)
          </span>
          <span className="section-badge" style={{ background: 'rgba(225, 29, 72, 0.15)', color: 'var(--color-rose-light)', borderColor: 'rgba(225, 29, 72, 0.3)' }}>
            {filteredLateItems.length}
          </span>
        </div>

        {/* Filters for Daftar Tugas Terlambat */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap', padding: '0 20px' }}>
          <input 
            type="text" 
            className="form-control"
            placeholder="Search task or assignee..." 
            value={lateSearch}
            onChange={(e) => { setLateSearch(e.target.value); setLatePage(1); }}
            style={{ flex: '1', minWidth: '200px', fontSize: '0.9rem' }}
          />
          <select 
            className="form-control"
            value={latePhaseFilter} 
            onChange={(e) => { setLatePhaseFilter(e.target.value); setLatePage(1); }}
            style={{ width: 'auto', minWidth: '200px', cursor: 'pointer', fontSize: '0.9rem' }}
          >
            <option value="All" style={{ background: '#1a1e28', color: '#f1f5f9' }}>All Late Phases</option>
            <option value="Dev" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Late Dev</option>
            <option value="DFT" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Late DFT</option>
            <option value="Staging" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Late Staging</option>
            <option value="UAT" style={{ background: '#1a1e28', color: '#f1f5f9' }}>Late UAT</option>
          </select>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '540px', overflowY: 'auto' }}>
          <table className="people-table">
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--color-bg-card)' }}>
              <tr>
                <th>Anggota / Assignee</th>
                <th>Tugas / Card</th>
                <th>Jenis</th>
                <th>Pelanggaran</th>
                <th>Batas Waktu (Deadline)</th>
                <th>Status Saat Ini</th>
                <th>Keterangan Waktu</th>
                <th style={{ minWidth: '180px' }}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {lateItems.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
                    {loading ? 'Menganalisa data...' : 'Tidak ada tugas yang terlambat 🎉'}
                  </td>
                </tr>
              ) : (
                paginatedLateItems.map((item, idx) => (
                  <tr key={item.id} style={{ animationDelay: `${idx * 0.04}s` }}>
                    <td>
                      <div className="person-info">
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: 11, background: 'var(--color-bg-input)' }}>
                          {item.avatar ? <img src={item.avatar} alt="A" /> : (item.assigneeName[0] || '?').toUpperCase()}
                        </div>
                        <div className="person-name" style={{ fontSize: 'var(--font-xs)' }}>{item.assigneeName}</div>
                      </div>
                    </td>
                    <td>
                      <a 
                        href={item.url} 
                        target="_blank" 
                        rel="noreferrer" 
                        style={{ 
                          color: 'var(--color-text-primary)', 
                          textDecoration: 'none', 
                          fontWeight: 500, 
                          display: 'block', 
                          minWidth: '220px', 
                          maxWidth: '380px', 
                          whiteSpace: 'normal', 
                          wordBreak: 'break-word', 
                          lineHeight: 1.45 
                        }} 
                        title={item.taskName}
                      >
                        {item.taskName}
                      </a>
                    </td>
                    <td>
                      <span className={`badge ${item.type === 'Subtask' ? 'badge-subtask' : 'badge-task'}`}>
                        {item.type}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--color-rose-light)', fontWeight: 600 }}>{item.latePhase}</span>
                    </td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-xs)' }}>
                      {item.deadlineStr}
                    </td>
                    <td>
                      <span className={`task-status ${getStatusClass(item.currentStatus)}`}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.statusColor || 'currentColor', display: 'inline-block', flexShrink: 0 }} />
                        {item.currentStatus}
                      </span>
                    </td>
                    <td style={{ fontSize: 'var(--font-xs)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {item.recordedTime === 'Belum Selesai' || item.recordedTime === 'Belum Mencapai Status' ? (
                          <span style={{ color: 'var(--color-amber-light)', fontWeight: 500 }}>{item.recordedTime}</span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>{item.recordedTime}</span>
                        )}
                        {(item.latePhase === 'Late DFT' || item.latePhase === 'Late Staging' || item.latePhase === 'Late UAT') && (
                          <button 
                            onClick={() => openEditModal(item.taskId, item.taskName, item.latePhase.replace('Late ', ''), null)}
                            title={`Ubah tanggal ${item.latePhase} dari log ClickUp`}
                            style={{
                              background: 'none',
                              border: '1px solid transparent',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              padding: '1px 4px',
                              fontSize: 11,
                              opacity: 0.65,
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.opacity = '1';
                              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.opacity = '0.65';
                              e.currentTarget.style.background = 'none';
                            }}
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                    </td>
                    {/* Reason */}
                    <td style={{ fontSize: 'var(--font-xs)', maxWidth: '240px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between' }}>
                        <span 
                          style={{ 
                            color: item.reason ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                            fontStyle: item.reason ? 'normal' : 'italic',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '180px',
                            display: 'inline-block'
                          }} 
                          title={item.reason || 'Klik ikon pensil untuk mengisi reason'}
                        >
                          {item.reason || 'Belum ada'}
                        </span>
                        <button 
                          onClick={() => openReasonModal(item.taskId, item.taskName, item.reason)}
                          title={item.reason ? "Edit reason" : "Tambah reason"}
                          style={{
                            background: item.reason ? 'rgba(59, 130, 246, 0.15)' : 'none',
                            border: item.reason ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            padding: '1px 4px',
                            fontSize: 11,
                            opacity: item.reason ? 1 : 0.65,
                            transition: 'all 0.15s ease',
                            flexShrink: 0
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.25)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.opacity = item.reason ? '1' : '0.65';
                            e.currentTarget.style.background = item.reason ? 'rgba(59, 130, 246, 0.15)' : 'none';
                          }}
                        >
                          ✏️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Interactive Pagination Bar */}
        {lateItems.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderTop: '1px solid var(--color-border-light)',
            background: 'var(--color-bg-card)',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: 'var(--font-xs)', color: 'var(--color-text-secondary)' }}>
              <span>
                Menampilkan <strong>{lateStartIdx + 1}</strong> - <strong>{Math.min(lateEndIdx, lateItems.length)}</strong> dari <strong>{lateItems.length}</strong> tugas
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Baris:</span>
                <select
                  value={latePerPage}
                  onChange={(e) => {
                    setLatePerPage(Number(e.target.value));
                    setLatePage(1);
                  }}
                  className="form-control"
                  style={{
                    padding: '3px 8px',
                    fontSize: 'var(--font-xs)',
                    width: 'auto',
                    background: 'var(--color-bg-input)',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            {totalLatePages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setLatePage(1)}
                  disabled={currentLatePage === 1}
                  style={{ padding: '4px 8px', fontSize: 'var(--font-xs)', opacity: currentLatePage === 1 ? 0.35 : 1, cursor: currentLatePage === 1 ? 'not-allowed' : 'pointer' }}
                  title="Halaman Pertama"
                >
                  «
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setLatePage(p => Math.max(1, p - 1))}
                  disabled={currentLatePage === 1}
                  style={{ padding: '4px 10px', fontSize: 'var(--font-xs)', opacity: currentLatePage === 1 ? 0.35 : 1, cursor: currentLatePage === 1 ? 'not-allowed' : 'pointer' }}
                >
                  ‹ Prev
                </button>
                
                {/* Page number buttons */}
                {Array.from({ length: totalLatePages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalLatePages || Math.abs(p - currentLatePage) <= 1)
                  .reduce((acc, p, idx, arr) => {
                    if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, idx) => item === '...' ? (
                    <span key={`dots-${idx}`} style={{ padding: '0 4px', color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)' }}>...</span>
                  ) : (
                    <button
                      key={item}
                      className={`btn ${currentLatePage === item ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setLatePage(item)}
                      style={{
                        padding: '4px 10px',
                        fontSize: 'var(--font-xs)',
                        minWidth: '28px',
                        fontWeight: currentLatePage === item ? 700 : 400,
                        background: currentLatePage === item ? 'var(--color-rose, #e11d48)' : undefined,
                        borderColor: currentLatePage === item ? 'var(--color-rose, #e11d48)' : undefined
                      }}
                    >
                      {item}
                    </button>
                  ))
                }

                <button
                  className="btn btn-secondary"
                  onClick={() => setLatePage(p => Math.min(totalLatePages, p + 1))}
                  disabled={currentLatePage === totalLatePages}
                  style={{ padding: '4px 10px', fontSize: 'var(--font-xs)', opacity: currentLatePage === totalLatePages ? 0.35 : 1, cursor: currentLatePage === totalLatePages ? 'not-allowed' : 'pointer' }}
                >
                  Next ›
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setLatePage(totalLatePages)}
                  disabled={currentLatePage === totalLatePages}
                  style={{ padding: '4px 8px', fontSize: 'var(--font-xs)', opacity: currentLatePage === totalLatePages ? 0.35 : 1, cursor: currentLatePage === totalLatePages ? 'not-allowed' : 'pointer' }}
                  title="Halaman Terakhir"
                >
                  »
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Edit Tanggal Fase */}
      {editModal.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{
            background: 'var(--color-bg-card, #1c2130)',
            border: '1px solid var(--color-border, #2e384d)',
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '480px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--font-md)', color: 'var(--color-text-primary)' }}>
                ✏️ Edit Waktu Done {editModal.phase}
              </div>
              <button 
                onClick={() => setEditModal({ isOpen: false, taskId: null, taskName: '', phase: null, currentValue: '' })}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 18 }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginBottom: 16, background: 'var(--color-bg-input)', padding: '10px 12px', borderRadius: '8px' }}>
              <strong>Card:</strong> {editModal.taskName}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                Tanggal & Jam Perpindahan Status:
              </label>
              <input 
                type="datetime-local" 
                className="form-control"
                value={editModal.currentValue}
                onChange={e => setEditModal(prev => ({ ...prev, currentValue: e.target.value }))}
                style={{ width: '100%', fontSize: 'var(--font-sm)', padding: '8px 12px' }}
              />
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                  ℹ️ Masukkan tanggal & jam sesuai riwayat status di ClickUp (misal saat card digeser ke <em>{editModal.phase === 'DFT' ? 'On Testing DFT Staging' : editModal.phase === 'Staging' ? 'Ready UAT' : 'Onrelease'}</em>). Data tersimpan permanen di database.
                </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 24 }}>
              <button 
                className="btn"
                style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                onClick={handleResetCustomDate}
              >
                Reset ke Otomatis
              </button>
              <button 
                className="btn btn-secondary"
                onClick={() => setEditModal({ isOpen: false, taskId: null, taskName: '', phase: null, currentValue: '' })}
              >
                Batal
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleSaveCustomDate}
              >
                💾 Simpan Tanggal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Reason */}
      {reasonModal.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{
            background: 'var(--color-bg-card, #1c2130)',
            border: '1px solid var(--color-border, #2e384d)',
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '520px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--font-md)', color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                📝 Keterangan / Reason Tugas
              </div>
              <button 
                onClick={() => setReasonModal({ isOpen: false, taskId: null, taskName: '', currentValue: '' })}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 18 }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginBottom: 16, background: 'var(--color-bg-input)', padding: '10px 12px', borderRadius: '8px' }}>
              <strong>Card:</strong> {reasonModal.taskName}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                Alasan Keterlambatan / Catatan Kendala:
              </label>
              <textarea 
                className="form-control"
                rows={4}
                placeholder="Contoh: Menunggu review client, kendala deployment staging, perubahan PRD mendadak, dsb..."
                value={reasonModal.currentValue}
                onChange={e => setReasonModal(prev => ({ ...prev, currentValue: e.target.value }))}
                style={{ width: '100%', fontSize: 'var(--font-sm)', padding: '10px 12px', resize: 'vertical' }}
              />
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                ℹ️ Alasan ini akan tersimpan permanen di database PostgreSQL dan langsung tampil pada tabel evaluasi tugas.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: 24 }}>
              {taskReasons[reasonModal.taskId] && (
                <button 
                  className="btn"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                  onClick={handleResetReason}
                >
                  Hapus Reason
                </button>
              )}
              <button 
                className="btn btn-secondary"
                onClick={() => setReasonModal({ isOpen: false, taskId: null, taskName: '', currentValue: '' })}
              >
                Batal
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleSaveReason}
              >
                💾 Simpan Reason
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
