// Local SQLite database for offline storage
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

// Initialize database
export const initDatabase = async (): Promise<void> => {
  db = await SQLite.openDatabaseAsync('timesheet.db');
  
  // Create tables
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS commesse (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS timesheets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      rows TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, month, year)
    );
  `);
};

// Generate UUID
const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// ============ USERS ============

export interface User {
  id: string;
  name: string;
  created_at?: string;
}

export const getUsers = async (): Promise<User[]> => {
  if (!db) await initDatabase();
  const result = await db!.getAllAsync<User>('SELECT * FROM users ORDER BY name');
  return result;
};

export const createUser = async (name: string): Promise<User> => {
  if (!db) await initDatabase();
  const id = generateUUID();
  await db!.runAsync(
    'INSERT INTO users (id, name) VALUES (?, ?)',
    [id, name]
  );
  return { id, name };
};

export const deleteUser = async (userId: string): Promise<void> => {
  if (!db) await initDatabase();
  await db!.runAsync('DELETE FROM users WHERE id = ?', [userId]);
  await db!.runAsync('DELETE FROM timesheets WHERE user_id = ?', [userId]);
};

// ============ COMMESSE ============

export interface Commessa {
  id: string;
  name: string;
  created_at?: string;
}

export const getCommesse = async (): Promise<Commessa[]> => {
  if (!db) await initDatabase();
  const result = await db!.getAllAsync<Commessa>('SELECT * FROM commesse ORDER BY name');
  return result;
};

export const saveCommessa = async (name: string): Promise<Commessa> => {
  if (!db) await initDatabase();
  
  // Check if exists
  const existing = await db!.getFirstAsync<Commessa>(
    'SELECT * FROM commesse WHERE name = ?',
    [name]
  );
  
  if (existing) return existing;
  
  const id = generateUUID();
  await db!.runAsync(
    'INSERT INTO commesse (id, name) VALUES (?, ?)',
    [id, name]
  );
  return { id, name };
};

export const deleteCommessa = async (commessaId: string): Promise<void> => {
  if (!db) await initDatabase();
  await db!.runAsync('DELETE FROM commesse WHERE id = ?', [commessaId]);
};

// ============ TIMESHEETS ============

export interface TimesheetRow {
  commessa: string;
  hours: number[];
}

export interface Timesheet {
  id: string;
  user_id: string;
  month: number;
  year: number;
  rows: TimesheetRow[];
  created_at?: string;
  updated_at?: string;
}

export const getTimesheet = async (userId: string, year: number, month: number): Promise<Timesheet | null> => {
  if (!db) await initDatabase();
  
  const result = await db!.getFirstAsync<any>(
    'SELECT * FROM timesheets WHERE user_id = ? AND year = ? AND month = ?',
    [userId, year, month]
  );
  
  if (!result) return null;
  
  return {
    ...result,
    rows: JSON.parse(result.rows)
  };
};

export const saveTimesheet = async (
  userId: string,
  year: number,
  month: number,
  rows: TimesheetRow[]
): Promise<Timesheet> => {
  if (!db) await initDatabase();
  
  // Save new commesse
  for (const row of rows) {
    if (row.commessa.trim()) {
      await saveCommessa(row.commessa.trim());
    }
  }
  
  const filteredRows = rows.filter(r => r.commessa.trim() !== '');
  const rowsJson = JSON.stringify(filteredRows);
  
  // Check if exists
  const existing = await db!.getFirstAsync<any>(
    'SELECT * FROM timesheets WHERE user_id = ? AND year = ? AND month = ?',
    [userId, year, month]
  );
  
  if (existing) {
    // Update
    await db!.runAsync(
      'UPDATE timesheets SET rows = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [rowsJson, existing.id]
    );
    return {
      ...existing,
      rows: filteredRows,
      updated_at: new Date().toISOString()
    };
  } else {
    // Insert
    const id = generateUUID();
    await db!.runAsync(
      'INSERT INTO timesheets (id, user_id, month, year, rows) VALUES (?, ?, ?, ?, ?)',
      [id, userId, month, year, rowsJson]
    );
    return {
      id,
      user_id: userId,
      month,
      year,
      rows: filteredRows
    };
  }
};

export const getTimesheets = async (userId?: string, year?: number): Promise<Timesheet[]> => {
  if (!db) await initDatabase();
  
  let query = 'SELECT * FROM timesheets';
  const params: any[] = [];
  const conditions: string[] = [];
  
  if (userId) {
    conditions.push('user_id = ?');
    params.push(userId);
  }
  if (year) {
    conditions.push('year = ?');
    params.push(year);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY year DESC, month';
  
  const results = await db!.getAllAsync<any>(query, params);
  
  return results.map(r => ({
    ...r,
    rows: JSON.parse(r.rows)
  }));
};
