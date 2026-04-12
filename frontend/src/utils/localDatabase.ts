// Local database for offline storage
// Uses localStorage on web for preview, SQLite on native devices
import { Platform } from 'react-native';

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

// ========== WEB STORAGE (for preview) ==========
// This uses localStorage as a fallback for web preview
// On the actual Android tablet, SQLite will be used

let webStorage: {
  users: User[];
  commesse: Commessa[];
  timesheets: Timesheet[];
} = {
  users: [],
  commesse: [],
  timesheets: []
};

const IS_WEB = Platform.OS === 'web';

const loadWebStorage = () => {
  if (IS_WEB && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem('timesheet_db');
      if (stored) {
        webStorage = JSON.parse(stored);
      }
    } catch (e) {
      console.log('Error loading web storage:', e);
    }
  }
};

const saveWebStorage = () => {
  if (IS_WEB && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('timesheet_db', JSON.stringify(webStorage));
    } catch (e) {
      console.log('Error saving web storage:', e);
    }
  }
};

// ========== NATIVE SQLITE STORAGE ==========
let db: any = null;

// Initialize database
export const initDatabase = async (): Promise<void> => {
  if (IS_WEB) {
    // On web, use localStorage for preview
    loadWebStorage();
    console.log('[DB] Web storage initialized (preview mode)');
    return;
  }
  
  // On native, use SQLite
  try {
    const SQLite = require('expo-sqlite');
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
    console.log('[DB] SQLite database initialized');
  } catch (error) {
    console.error('[DB] Error initializing SQLite:', error);
    // Fall back to web storage
    loadWebStorage();
  }
};

// ============ USERS ============

export const getUsers = async (): Promise<User[]> => {
  if (IS_WEB || !db) {
    return [...webStorage.users].sort((a, b) => a.name.localeCompare(b.name));
  }
  
  const result = await db.getAllAsync<User>('SELECT * FROM users ORDER BY name');
  return result;
};

export const createUser = async (name: string): Promise<User> => {
  const id = generateUUID();
  const user: User = { id, name, created_at: new Date().toISOString() };
  
  if (IS_WEB || !db) {
    webStorage.users.push(user);
    saveWebStorage();
    return user;
  }
  
  await db.runAsync(
    'INSERT INTO users (id, name) VALUES (?, ?)',
    [id, name]
  );
  return { id, name };
};

export const deleteUser = async (userId: string): Promise<void> => {
  if (IS_WEB || !db) {
    webStorage.users = webStorage.users.filter(u => u.id !== userId);
    webStorage.timesheets = webStorage.timesheets.filter(t => t.user_id !== userId);
    saveWebStorage();
    return;
  }
  
  await db.runAsync('DELETE FROM users WHERE id = ?', [userId]);
  await db.runAsync('DELETE FROM timesheets WHERE user_id = ?', [userId]);
};

// ============ COMMESSE ============

export const getCommesse = async (): Promise<Commessa[]> => {
  if (IS_WEB || !db) {
    return [...webStorage.commesse].sort((a, b) => a.name.localeCompare(b.name));
  }
  
  const result = await db.getAllAsync<Commessa>('SELECT * FROM commesse ORDER BY name');
  return result;
};

export const saveCommessa = async (name: string): Promise<Commessa> => {
  if (IS_WEB || !db) {
    const existing = webStorage.commesse.find(c => c.name === name);
    if (existing) return existing;
    
    const commessa: Commessa = { 
      id: generateUUID(), 
      name, 
      created_at: new Date().toISOString() 
    };
    webStorage.commesse.push(commessa);
    saveWebStorage();
    return commessa;
  }
  
  // Check if exists
  const existing = await db.getFirstAsync<Commessa>(
    'SELECT * FROM commesse WHERE name = ?',
    [name]
  );
  
  if (existing) return existing;
  
  const id = generateUUID();
  await db.runAsync(
    'INSERT INTO commesse (id, name) VALUES (?, ?)',
    [id, name]
  );
  return { id, name };
};

export const deleteCommessa = async (commessaId: string): Promise<void> => {
  if (IS_WEB || !db) {
    const commessa = webStorage.commesse.find(c => c.id === commessaId);
    if (commessa) {
      webStorage.commesse = webStorage.commesse.filter(c => c.id !== commessaId);
      // Remove from all timesheets
      webStorage.timesheets = webStorage.timesheets.map(ts => ({
        ...ts,
        rows: ts.rows.filter(r => r.commessa !== commessa.name)
      }));
      saveWebStorage();
    }
    return;
  }
  
  // Get commessa name first
  const commessa = await db.getFirstAsync<Commessa>(
    'SELECT * FROM commesse WHERE id = ?',
    [commessaId]
  );
  
  if (commessa) {
    // Delete from commesse table
    await db.runAsync('DELETE FROM commesse WHERE id = ?', [commessaId]);
    
    // Remove this commessa from all timesheets
    const timesheets = await db.getAllAsync<any>('SELECT * FROM timesheets');
    for (const ts of timesheets) {
      const rows: TimesheetRow[] = JSON.parse(ts.rows);
      const filteredRows = rows.filter(r => r.commessa !== commessa.name);
      if (filteredRows.length !== rows.length) {
        await db.runAsync(
          'UPDATE timesheets SET rows = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [JSON.stringify(filteredRows), ts.id]
        );
      }
    }
  }
};

// ============ TIMESHEETS ============

export const getTimesheet = async (userId: string, year: number, month: number): Promise<Timesheet | null> => {
  if (IS_WEB || !db) {
    const ts = webStorage.timesheets.find(
      t => t.user_id === userId && t.year === year && t.month === month
    );
    return ts || null;
  }
  
  const result = await db.getFirstAsync<any>(
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
  // Save new commesse
  for (const row of rows) {
    if (row.commessa.trim()) {
      await saveCommessa(row.commessa.trim());
    }
  }
  
  const filteredRows = rows.filter(r => r.commessa.trim() !== '');
  
  if (IS_WEB || !db) {
    const existingIndex = webStorage.timesheets.findIndex(
      t => t.user_id === userId && t.year === year && t.month === month
    );
    
    const timesheet: Timesheet = {
      id: existingIndex >= 0 ? webStorage.timesheets[existingIndex].id : generateUUID(),
      user_id: userId,
      month,
      year,
      rows: filteredRows,
      created_at: existingIndex >= 0 ? webStorage.timesheets[existingIndex].created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
      webStorage.timesheets[existingIndex] = timesheet;
    } else {
      webStorage.timesheets.push(timesheet);
    }
    saveWebStorage();
    return timesheet;
  }
  
  const rowsJson = JSON.stringify(filteredRows);
  
  // Check if exists
  const existing = await db.getFirstAsync<any>(
    'SELECT * FROM timesheets WHERE user_id = ? AND year = ? AND month = ?',
    [userId, year, month]
  );
  
  if (existing) {
    // Update
    await db.runAsync(
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
    await db.runAsync(
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
  if (IS_WEB || !db) {
    let results = [...webStorage.timesheets];
    if (userId) {
      results = results.filter(t => t.user_id === userId);
    }
    if (year) {
      results = results.filter(t => t.year === year);
    }
    return results.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return a.month - b.month;
    });
  }
  
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
  
  const results = await db.getAllAsync<any>(query, params);
  
  return results.map(r => ({
    ...r,
    rows: JSON.parse(r.rows)
  }));
};

// Get all timesheets for a specific month/year (for summary report)
export const getAllTimesheetsForMonth = async (year: number, month: number): Promise<{user: User, timesheet: Timesheet}[]> => {
  const results: {user: User, timesheet: Timesheet}[] = [];
  const users = await getUsers();
  
  for (const user of users) {
    const timesheet = await getTimesheet(user.id, year, month);
    if (timesheet && timesheet.rows.length > 0) {
      results.push({ user, timesheet });
    }
  }
  
  return results;
};
