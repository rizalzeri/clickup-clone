import express from 'express';
import cors from 'cors';
import { pool } from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Get all manual dates formatted as an object
app.get('/api/manual-dates', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT task_id, phase, timestamp_ms FROM portofolio.manual_phase_dates');
    
    // Group by taskId: { [taskId]: { [phase]: timestamp_ms } }
    const result = {};
    for (const row of rows) {
      if (!result[row.task_id]) {
        result[row.task_id] = {};
      }
      result[row.task_id][row.phase] = parseInt(row.timestamp_ms, 10);
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching manual dates:', error);
    res.status(500).json({ error: 'Failed to fetch manual dates' });
  }
});

// Save or update a manual date
app.post('/api/manual-dates', async (req, res) => {
  const { taskId, phase, timestampMs } = req.body;
  if (!taskId || !phase || !timestampMs) {
    return res.status(400).json({ error: 'taskId, phase, and timestampMs are required' });
  }

  try {
    const query = `
      INSERT INTO portofolio.manual_phase_dates (task_id, phase, timestamp_ms, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (task_id, phase)
      DO UPDATE SET timestamp_ms = EXCLUDED.timestamp_ms, updated_at = CURRENT_TIMESTAMP;
    `;
    await pool.query(query, [taskId, phase, timestampMs]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving manual date:', error);
    res.status(500).json({ error: 'Failed to save manual date' });
  }
});

// Reset (delete) a specific manual date
app.delete('/api/manual-dates/:taskId/:phase', async (req, res) => {
  const { taskId, phase } = req.params;
  
  try {
    const query = 'DELETE FROM portofolio.manual_phase_dates WHERE task_id = $1 AND phase = $2';
    await pool.query(query, [taskId, phase]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting manual date:', error);
    res.status(500).json({ error: 'Failed to delete manual date' });
  }
});

// ================= TASK REASONS API =================

// Get all task reasons
app.get('/api/task-reasons', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT task_id, reason FROM portofolio.task_reasons');
    const result = {};
    for (const row of rows) {
      result[row.task_id] = row.reason;
    }
    res.json(result);
  } catch (error) {
    console.error('Error fetching task reasons:', error);
    res.status(500).json({ error: 'Failed to fetch task reasons' });
  }
});

// Save or update a task reason
app.post('/api/task-reasons', async (req, res) => {
  const { taskId, reason } = req.body;
  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    const query = `
      INSERT INTO portofolio.task_reasons (task_id, reason, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (task_id)
      DO UPDATE SET reason = EXCLUDED.reason, updated_at = CURRENT_TIMESTAMP;
    `;
    await pool.query(query, [taskId, reason || '']);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving task reason:', error);
    res.status(500).json({ error: 'Failed to save task reason' });
  }
});

// Delete a task reason
app.delete('/api/task-reasons/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    await pool.query('DELETE FROM portofolio.task_reasons WHERE task_id = $1', [taskId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting task reason:', error);
    res.status(500).json({ error: 'Failed to delete task reason' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend API for ClickUp tracker listening at http://localhost:${PORT}`);
});
