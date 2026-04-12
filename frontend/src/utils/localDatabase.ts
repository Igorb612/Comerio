// Local database for offline storage
// Uses SQLite on native devices (Android/iOS)
// Uses AsyncStorage as fallback
import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// Storage keys for AsyncStorage fallback
const STORAGE_KEYS = {
  USERS: 'timesheet_users',
  COMMESSE: 'timesheet_commesse',
  TIMESHEETS: 'timesheet_data'
};

// Database instance
let db: SQLite.SQLiteDatabase | null = null;
let useAsyncStorage = Platform.OS === 'web';

// ========== ASYNC STORAGE HELPERS (for web fallback) ==========
const getAsyncData = async <T>(key: string, defaultValue: T): Promise<T> => {
  try {
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (e) {
    console.log('[AsyncStorage] Error reading:', e);
    return defaultValue;
  }
};

const setAsyncData = async <T>(key: string, value: T): Promise<void> => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.log('[AsyncStorage] Error writing:', e);
  }
};

// ========== DATABASE INITIALIZATION ==========
export const initDatabase = async (): Promise<void> => {
  // For web, use AsyncStorage
  if (Platform.OS === 'web') {
    useAsyncStorage = true;
    console.log('[DB] Using AsyncStorage for web');
    return;
  }
  
  // For native (Android/iOS), use SQLite
  try {
    db = await SQLite.openDatabaseAsync('timesheet.db');
    useAsyncStorage = false;
    
    // Create tables with WAL mode for better performance
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
    
    console.log('[DB] SQLite database initialized successfully');
  } catch (error) {
    console.error('[DB] SQLite initialization failed, using AsyncStorage:', error);
    useAsyncStorage = true;
  }
};

// ============ USERS ============

export const getUsers = async (): Promise<User[]> => {
  if (useAsyncStorage || !db) {
    const users = await getAsyncData<User[]>(STORAGE_KEYS.USERS, []);
    return users.sort((a, b) => a.name.localeCompare(b.name));
  }
  
  try {
    const result = await db.getAllAsync<User>('SELECT * FROM users ORDER BY name');
    return result;
  } catch (error) {
    console.error('[DB] Error getting users:', error);
    return [];
  }
};

export const createUser = async (name: string): Promise<User> => {
  const id = generateUUID();
  const user: User = { id, name, created_at: new Date().toISOString() };
  
  if (useAsyncStorage || !db) {
    const users = await getAsyncData<User[]>(STORAGE_KEYS.USERS, []);
    users.push(user);
    await setAsyncData(STORAGE_KEYS.USERS, users);
    return user;
  }
  
  try {
    await db.runAsync(
      'INSERT INTO users (id, name) VALUES (?, ?)',
      [id, name]
    );
    return { id, name };
  } catch (error) {
    console.error('[DB] Error creating user:', error);
    throw error;
  }
};

export const deleteUser = async (userId: string): Promise<void> => {
  if (useAsyncStorage || !db) {
    const users = await getAsyncData<User[]>(STORAGE_KEYS.USERS, []);
    await setAsyncData(STORAGE_KEYS.USERS, users.filter(u => u.id !== userId));
    
    const timesheets = await getAsyncData<Timesheet[]>(STORAGE_KEYS.TIMESHEETS, []);
    await setAsyncData(STORAGE_KEYS.TIMESHEETS, timesheets.filter(t => t.user_id !== userId));
    return;
  }
  
  try {
    await db.runAsync('DELETE FROM users WHERE id = ?', [userId]);
    await db.runAsync('DELETE FROM timesheets WHERE user_id = ?', [userId]);
  } catch (error) {
    console.error('[DB] Error deleting user:', error);
  }
};

// ============ COMMESSE ============

export const getCommesse = async (): Promise<Commessa[]> => {
  if (useAsyncStorage || !db) {
    const commesse = await getAsyncData<Commessa[]>(STORAGE_KEYS.COMMESSE, []);
    return commesse.sort((a, b) => a.name.localeCompare(b.name));
  }
  
  try {
    const result = await db.getAllAsync<Commessa>('SELECT * FROM commesse ORDER BY name');
    return result;
  } catch (error) {
    console.error('[DB] Error getting commesse:', error);
    return [];
  }
};

export const saveCommessa = async (name: string): Promise<Commessa> => {
  if (useAsyncStorage || !db) {
    const commesse = await getAsyncData<Commessa[]>(STORAGE_KEYS.COMMESSE, []);
    const existing = commesse.find(c => c.name === name);
    if (existing) return existing;
    
    const commessa: Commessa = { 
      id: generateUUID(), 
      name, 
      created_at: new Date().toISOString() 
    };
    commesse.push(commessa);
    await setAsyncData(STORAGE_KEYS.COMMESSE, commesse);
    return commessa;
  }
  
  try {
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
  } catch (error) {
    console.error('[DB] Error saving commessa:', error);
    throw error;
  }
};

export const deleteCommessa = async (commessaId: string): Promise<void> => {
  if (useAsyncStorage || !db) {
    const commesse = await getAsyncData<Commessa[]>(STORAGE_KEYS.COMMESSE, []);
    const commessa = commesse.find(c => c.id === commessaId);
    
    if (commessa) {
      await setAsyncData(STORAGE_KEYS.COMMESSE, commesse.filter(c => c.id !== commessaId));
      
      // Remove from all timesheets
      const timesheets = await getAsyncData<Timesheet[]>(STORAGE_KEYS.TIMESHEETS, []);
      const updated = timesheets.map(ts => ({
        ...ts,
        rows: ts.rows.filter(r => r.commessa !== commessa.name)
      }));
      await setAsyncData(STORAGE_KEYS.TIMESHEETS, updated);
    }
    return;
  }
  
  try {
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
  } catch (error) {
    console.error('[DB] Error deleting commessa:', error);
  }
};

// ============ TIMESHEETS ============

export const getTimesheet = async (userId: string, year: number, month: number): Promise<Timesheet | null> => {
  if (useAsyncStorage || !db) {
    const timesheets = await getAsyncData<Timesheet[]>(STORAGE_KEYS.TIMESHEETS, []);
    const ts = timesheets.find(
      t => t.user_id === userId && t.year === year && t.month === month
    );
    return ts || null;
  }
  
  try {
    const result = await db.getFirstAsync<any>(
      'SELECT * FROM timesheets WHERE user_id = ? AND year = ? AND month = ?',
      [userId, year, month]
    );
    
    if (!result) return null;
    
    return {
      ...result,
      rows: JSON.parse(result.rows)
    };
  } catch (error) {
    console.error('[DB] Error getting timesheet:', error);
    return null;
  }
};

export const saveTimesheet = async (
  userId: string,
  year: number,
  month: number,
  rows: TimesheetRow[]
): Promise<Timesheet> => {
  // Save new commesse
  for (const row of rows) {
    if (row.commessa && row.commessa.trim()) {
      await saveCommessa(row.commessa.trim());
    }
  }
  
  const filteredRows = rows.filter(r => r.commessa && r.commessa.trim() !== '');
  
  if (useAsyncStorage || !db) {
    const timesheets = await getAsyncData<Timesheet[]>(STORAGE_KEYS.TIMESHEETS, []);
    const existingIndex = timesheets.findIndex(
      t => t.user_id === userId && t.year === year && t.month === month
    );
    
    const timesheet: Timesheet = {
      id: existingIndex >= 0 ? timesheets[existingIndex].id : generateUUID(),
      user_id: userId,
      month,
      year,
      rows: filteredRows,
      created_at: existingIndex >= 0 ? timesheets[existingIndex].created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
      timesheets[existingIndex] = timesheet;
    } else {
      timesheets.push(timesheet);
    }
    await setAsyncData(STORAGE_KEYS.TIMESHEETS, timesheets);
    return timesheet;
  }
  
  try {
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
  } catch (error) {
    console.error('[DB] Error saving timesheet:', error);
    throw error;
  }
};

export const getTimesheets = async (userId?: string, year?: number): Promise<Timesheet[]> => {
  if (useAsyncStorage || !db) {
    let results = await getAsyncData<Timesheet[]>(STORAGE_KEYS.TIMESHEETS, []);
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
  
  try {
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
  } catch (error) {
    console.error('[DB] Error getting timesheets:', error);
    return [];
  }
};

// Get all timesheets for a specific month/year (for summary report)
export const getAllTimesheetsForMonth = async (year: number, month: number): Promise<{user: User, timesheet: Timesheet}[]> => {
  const results: {user: User, timesheet: Timesheet}[] = [];
  const users = await getUsers();
  
  for (const user of users) {
    const timesheet = await getTimesheet(user.id, year, month);
    if (timesheet && timesheet.rows && timesheet.rows.length > 0) {
      results.push({ user, timesheet });
    }
  }
  
  return results;
};
