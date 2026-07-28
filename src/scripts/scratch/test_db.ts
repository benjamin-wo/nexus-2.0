// @ts-nocheck
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://postgres:PdATemthzUktYdEIRRWfeXEJVLRdvnIY@hayabusa.proxy.rlwy.net:38664/railway',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query("SELECT * FROM profiles WHERE key LIKE 'RAILWAY_%' OR key LIKE 'WEBAPP_%'");
    console.log(res.rows);
  } catch (err) {
    console.error("Connection failed:", err);
  } finally {
    await pool.end();
  }
}
run();
