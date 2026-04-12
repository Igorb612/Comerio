// Local database for offline storage - SQLite only
import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

// Types
export interface User {
  id: string;
  name: string;
  created_at?: string;
}

export interface Commessa {
  id: string;
  name: string;
  created_at?: string;
}

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

// Generate UUID
const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Database instance
let db: SQLite.SQLiteDatabase | null = null;

// In-memory fallback for web
let memoryDB: {
  users: User[];
  commesse: Commessa[];
  timesheets: Timesheet[];
} = { users: [], commesse: [], timesheets: [] };

const isWeb = Platform.OS === 'web';

// ========== DATABASE INITIALIZATION ==========
export const initDatabase = async (): Promise<void> => {
  if (isWeb) {
    console.log('[DB] Web mode - using memory storage');
    return;
  }
  
  try {
    db = await SQLite.openDatabaseAsync('timesheet.db');
    
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS commesse (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS timesheets (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        rows TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, month, year)
      );
    `);
    
    console.log('[DB] SQLite initialized');
  } catch (error) {
    console.error('[DB] Init error:', error);
  }
};

// ============ USERS ============
export const getUsers = async (): Promise<User[]> => {
  if (isWeb || !db) return memoryDB.users.sort((a, b) => a.name.localeCompare(b.name));
  
  try {
    return await db.getAllAsync<User>('SELECT * FROM users ORDER BY name');
  } catch (e) {
    console.error('[DB] getUsers error:', e);
    return [];
  }
};

export const createUser = async (name: string): Promise<User> => {
  const user: User = { id: generateUUID(), name, created_at: new Date().toISOString() };
  
  if (isWeb || !db) {
    memoryDB.users.push(user);
    return user;
  }
  
  await db.runAsync('INSERT INTO users (id, name) VALUES (?, ?)', [user.id, name]);
  return user;
};

export const deleteUser = async (userId: string): Promise<void> => {
  if (isWeb || !db) {
    memoryDB.users = memoryDB.users.filter(u => u.id !== userId);
    memoryDB.timesheets = memoryDB.timesheets.filter(t => t.user_id !== userId);
    return;
  }
  
  await db.runAsync('DELETE FROM users WHERE id = ?', [userId]);
  await db.runAsync('DELETE FROM timesheets WHERE user_id = ?', [userId]);
};

// ============ COMMESSE ============
export const getCommesse = async (): Promise<Commessa[]> => {
  if (isWeb || !db) return memoryDB.commesse.sort((a, b) => a.name.localeCompare(b.name));
  
  try {
    return await db.getAllAsync<Commessa>('SELECT * FROM commesse ORDER BY name');
  } catch (e) {
    console.error('[DB] getCommesse error:', e);
    return [];
  }
};

export const saveCommessa = async (name: string): Promise<Commessa> => {
  if (isWeb || !db) {
    const existing = memoryDB.commesse.find(c => c.name === name);
    if (existing) return existing;
    const commessa: Commessa = { id: generateUUID(), name, created_at: new Date().toISOString() };
    memoryDB.commesse.push(commessa);
    return commessa;
  }
  
  const existing = await db.getFirstAsync<Commessa>('SELECT * FROM commesse WHERE name = ?', [name]);
  if (existing) return existing;
  
  const id = generateUUID();
  await db.runAsync('INSERT INTO commesse (id, name) VALUES (?, ?)', [id, name]);
  return { id, name };
};

export const deleteCommessa = async (commessaId: string): Promise<void> => {
  if (isWeb || !db) {
    const commessa = memoryDB.commesse.find(c => c.id === commessaId);
    if (commessa) {
      memoryDB.commesse = memoryDB.commesse.filter(c => c.id !== commessaId);
      memoryDB.timesheets = memoryDB.timesheets.map(ts => ({
        ...ts,
        rows: ts.rows.filter(r => r.commessa !== commessa.name)
      }));
    }
    return;
  }
  
  const commessa = await db.getFirstAsync<Commessa>('SELECT * FROM commesse WHERE id = ?', [commessaId]);
  if (commessa) {
    await db.runAsync('DELETE FROM commesse WHERE id = ?', [commessaId]);
    const timesheets = await db.getAllAsync<any>('SELECT * FROM timesheets');
    for (const ts of timesheets) {
      const rows: TimesheetRow[] = JSON.parse(ts.rows);
      const filteredRows = rows.filter(r => r.commessa !== commessa.name);
      if (filteredRows.length !== rows.length) {
        await db.runAsync('UPDATE timesheets SET rows = ? WHERE id = ?', [JSON.stringify(filteredRows), ts.id]);
      }
    }
  }
};

// ============ TIMESHEETS ============
export const getTimesheet = async (userId: string, year: number, month: number): Promise<Timesheet | null> => {
  if (isWeb || !db) {
    return memoryDB.timesheets.find(t => t.user_id === userId && t.year === year && t.month === month) || null;
  }
  
  try {
    const result = await db.getFirstAsync<any>(
      'SELECT * FROM timesheets WHERE user_id = ? AND year = ? AND month = ?',
      [userId, year, month]
    );
    if (!result) return null;
    return { ...result, rows: JSON.parse(result.rows) };
  } catch (e) {
    console.error('[DB] getTimesheet error:', e);
    return null;
  }
};

export const saveTimesheet = async (userId: string, year: number, month: number, rows: TimesheetRow[]): Promise<Timesheet> => {
  for (const row of rows) {
    if (row.commessa?.trim()) await saveCommessa(row.commessa.trim());
  }
  
  const filteredRows = rows.filter(r => r.commessa?.trim());
  
  if (isWeb || !db) {
    const idx = memoryDB.timesheets.findIndex(t => t.user_id === userId && t.year === year && t.month === month);
    const ts: Timesheet = {
      id: idx >= 0 ? memoryDB.timesheets[idx].id : generateUUID(),
      user_id: userId, month, year, rows: filteredRows,
      updated_at: new Date().toISOString()
    };
    if (idx >= 0) memoryDB.timesheets[idx] = ts;
    else memoryDB.timesheets.push(ts);
    return ts;
  }
  
  const rowsJson = JSON.stringify(filteredRows);
  const existing = await db.getFirstAsync<any>(
    'SELECT * FROM timesheets WHERE user_id = ? AND year = ? AND month = ?',
    [userId, year, month]
  );
  
  if (existing) {
    await db.runAsync('UPDATE timesheets SET rows = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [rowsJson, existing.id]);
    return { ...existing, rows: filteredRows };
  } else {
    const id = generateUUID();
    await db.runAsync('INSERT INTO timesheets (id, user_id, month, year, rows) VALUES (?, ?, ?, ?, ?)', [id, userId, month, year, rowsJson]);
    return { id, user_id: userId, month, year, rows: filteredRows };
  }
};

export const getAllTimesheetsForMonth = async (year: number, month: number): Promise<{user: User, timesheet: Timesheet}[]> => {
  const results: {user: User, timesheet: Timesheet}[] = [];
  const users = await getUsers();
  
  for (const user of users) {
    const timesheet = await getTimesheet(user.id, year, month);
    if (timesheet?.rows?.length > 0) {
      results.push({ user, timesheet });
    }
  }
  return results;
};

// ============ BACKUP / RESTORE ============
export const exportAllData = async (): Promise<string> => {
  const users = await getUsers();
  const commesse = await getCommesse();
  
  // Get all timesheets
  let timesheets: Timesheet[] = [];
  if (isWeb || !db) {
    timesheets = memoryDB.timesheets;
  } else {
    const results = await db.getAllAsync<any>('SELECT * FROM timesheets');
    timesheets = results.map(r => ({ ...r, rows: JSON.parse(r.rows) }));
  }
  
  const backup = {
    version: 1,
    exportDate: new Date().toISOString(),
    users,
    commesse,
    timesheets
  };
  
  return JSON.stringify(backup, null, 2);
};

export const importAllData = async (jsonData: string): Promise<{ users: number, commesse: number, timesheets: number }> => {
  const backup = JSON.parse(jsonData);
  
  let usersImported = 0;
  let commesseImported = 0;
  let timesheetsImported = 0;
  
  // Import users
  for (const user of backup.users || []) {
    try {
      if (isWeb || !db) {
        if (!memoryDB.users.find(u => u.id === user.id)) {
          memoryDB.users.push(user);
          usersImported++;
        }
      } else {
        const existing = await db.getFirstAsync('SELECT * FROM users WHERE id = ?', [user.id]);
        if (!existing) {
          await db.runAsync('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)', [user.id, user.name, user.created_at || new Date().toISOString()]);
          usersImported++;
        }
      }
    } catch (e) { console.log('User import error:', e); }
  }
  
  // Import commesse
  for (const commessa of backup.commesse || []) {
    try {
      if (isWeb || !db) {
        if (!memoryDB.commesse.find(c => c.id === commessa.id)) {
          memoryDB.commesse.push(commessa);
          commesseImported++;
        }
      } else {
        const existing = await db.getFirstAsync('SELECT * FROM commesse WHERE id = ?', [commessa.id]);
        if (!existing) {
          await db.runAsync('INSERT INTO commesse (id, name, created_at) VALUES (?, ?, ?)', [commessa.id, commessa.name, commessa.created_at || new Date().toISOString()]);
          commesseImported++;
        }
      }
    } catch (e) { console.log('Commessa import error:', e); }
  }
  
  // Import timesheets
  for (const ts of backup.timesheets || []) {
    try {
      if (isWeb || !db) {
        const idx = memoryDB.timesheets.findIndex(t => t.user_id === ts.user_id && t.year === ts.year && t.month === ts.month);
        if (idx < 0) {
          memoryDB.timesheets.push(ts);
          timesheetsImported++;
        }
      } else {
        const existing = await db.getFirstAsync('SELECT * FROM timesheets WHERE user_id = ? AND year = ? AND month = ?', [ts.user_id, ts.year, ts.month]);
        if (!existing) {
          await db.runAsync('INSERT INTO timesheets (id, user_id, month, year, rows, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [ts.id, ts.user_id, ts.month, ts.year, JSON.stringify(ts.rows), ts.created_at || new Date().toISOString(), ts.updated_at || new Date().toISOString()]);
          timesheetsImported++;
        }
      }
    } catch (e) { console.log('Timesheet import error:', e); }
  }
  
  return { users: usersImported, commesse: commesseImported, timesheets: timesheetsImported };
};
