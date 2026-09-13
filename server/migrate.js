import { pool } from './db.js';

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Beginning migration...');
    
    // Create schema if not exists
    await client.query('CREATE SCHEMA IF NOT EXISTS portofolio;');
    console.log('Schema portofolio verified.');

    // Create table for manual phase dates
    await client.query(`
      CREATE TABLE IF NOT EXISTS portofolio.manual_phase_dates (
        task_id VARCHAR(50) NOT NULL,
        phase VARCHAR(50) NOT NULL,
        timestamp_ms BIGINT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (task_id, phase)
      );
    `);
    console.log('Table portofolio.manual_phase_dates verified.');

    // Create table for task reasons
    await client.query(`
      CREATE TABLE IF NOT EXISTS portofolio.task_reasons (
        task_id VARCHAR(50) NOT NULL PRIMARY KEY,
        reason TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table portofolio.task_reasons verified.');

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
