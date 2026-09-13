import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: '168.110.200.225',
  user: 'postgres',
  password: 'Undip123?',
  database: 'db_zeri',
  port: 5432,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});
