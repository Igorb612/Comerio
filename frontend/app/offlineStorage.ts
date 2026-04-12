// Offline Storage using IndexedDB for PWA functionality
const DB_NAME = 'TimesheetDB';
const DB_VERSION = 1;

interface User {
  id: string;
  name: string;
  created_at?: string;
}

interface TimesheetRow {
  commessa: string;
  hours: number[];
}

interface Timesheet {
  id: string;
  user_id: string;
  month: number;
  year: number;
  rows: TimesheetRow[];
  created_at?: string;
  updated_at?: string;
}

interface Commessa {
  id: string;
  name: string;
  created_at?: string;
}

let db: IDBDatabase | null = null;

// Initialize IndexedDB
export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Error opening IndexedDB');
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create Users store
      if (!database.objectStoreNames.contains('users')) {
        const usersStore = database.createObjectStore('users', { keyPath: 'id' });
        usersStore.createIndex('name', 'name', { unique: false });
      }

      // Create Timesheets store
      if (!database.objectStoreNames.contains('timesheets')) {
        const timesheetsStore = database.createObjectStore('timesheets', { keyPath: 'id' });
        timesheetsStore.createIndex('user_month_year', ['user_id', 'month', 'year'], { unique: true });
        timesheetsStore.createIndex('user_id', 'user_id', { unique: false });
      }

      // Create Commesse store
      if (!database.objectStoreNames.contains('commesse')) {
        const commesseStore = database.createObjectStore('commesse', { keyPath: 'id' });
        commesseStore.createIndex('name', 'name', { unique: true });
      }
    };
  });
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

export const getUsers = async (): Promise<User[]> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['users'], 'readonly');
    const store = transaction.objectStore('users');
    const request = store.getAll();

    request.onsuccess = () => {
      const users = request.result.sort((a: User, b: User) => 
        a.name.localeCompare(b.name)
      );
      resolve(users);
    };
    request.onerror = () => reject(request.error);
  });
};

export const createUser = async (name: string): Promise<User> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');

    const user: User = {
      id: generateUUID(),
      name: name,
      created_at: new Date().toISOString()
    };

    const request = store.add(user);
    request.onsuccess = () => resolve(user);
    request.onerror = () => reject(request.error);
  });
};

export const deleteUser = async (userId: string): Promise<void> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['users', 'timesheets'], 'readwrite');
    
    // Delete user
    const usersStore = transaction.objectStore('users');
    usersStore.delete(userId);

    // Delete all timesheets for this user
    const timesheetsStore = transaction.objectStore('timesheets');
    const index = timesheetsStore.index('user_id');
    const request = index.openCursor(IDBKeyRange.only(userId));

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

// ============ TIMESHEETS ============

export const getTimesheet = async (userId: string, year: number, month: number): Promise<Timesheet | null> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['timesheets'], 'readonly');
    const store = transaction.objectStore('timesheets');
    const index = store.index('user_month_year');
    const request = index.get([userId, month, year]);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
};

export const saveTimesheet = async (
  userId: string,
  year: number,
  month: number,
  rows: TimesheetRow[]
): Promise<Timesheet> => {
  const database = await initDB();
  
  // First, save any new commesse
  for (const row of rows) {
    if (row.commessa.trim()) {
      await saveCommessa(row.commessa.trim());
    }
  }

  return new Promise(async (resolve, reject) => {
    const transaction = database.transaction(['timesheets'], 'readwrite');
    const store = transaction.objectStore('timesheets');
    const index = store.index('user_month_year');

    // Check if exists
    const getRequest = index.get([userId, month, year]);
    
    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      const now = new Date().toISOString();

      const timesheet: Timesheet = existing ? {
        ...existing,
        rows: rows.filter(r => r.commessa.trim() !== ''),
        updated_at: now
      } : {
        id: generateUUID(),
        user_id: userId,
        month: month,
        year: year,
        rows: rows.filter(r => r.commessa.trim() !== ''),
        created_at: now,
        updated_at: now
      };

      const putRequest = store.put(timesheet);
      putRequest.onsuccess = () => resolve(timesheet);
      putRequest.onerror = () => reject(putRequest.error);
    };
    
    getRequest.onerror = () => reject(getRequest.error);
  });
};

export const getTimesheets = async (userId?: string, year?: number): Promise<Timesheet[]> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['timesheets'], 'readonly');
    const store = transaction.objectStore('timesheets');
    const request = store.getAll();

    request.onsuccess = () => {
      let timesheets = request.result as Timesheet[];
      
      if (userId) {
        timesheets = timesheets.filter(t => t.user_id === userId);
      }
      if (year) {
        timesheets = timesheets.filter(t => t.year === year);
      }
      
      timesheets.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return a.month - b.month;
      });
      
      resolve(timesheets);
    };
    request.onerror = () => reject(request.error);
  });
};

// ============ COMMESSE ============

export const getCommesse = async (): Promise<Commessa[]> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['commesse'], 'readonly');
    const store = transaction.objectStore('commesse');
    const request = store.getAll();

    request.onsuccess = () => {
      const commesse = request.result.sort((a: Commessa, b: Commessa) => 
        a.name.localeCompare(b.name)
      );
      resolve(commesse);
    };
    request.onerror = () => reject(request.error);
  });
};

export const saveCommessa = async (name: string): Promise<Commessa> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['commesse'], 'readwrite');
    const store = transaction.objectStore('commesse');
    const index = store.index('name');

    // Check if already exists
    const getRequest = index.get(name);
    
    getRequest.onsuccess = () => {
      if (getRequest.result) {
        resolve(getRequest.result);
        return;
      }

      const commessa: Commessa = {
        id: generateUUID(),
        name: name,
        created_at: new Date().toISOString()
      };

      const addRequest = store.add(commessa);
      addRequest.onsuccess = () => resolve(commessa);
      addRequest.onerror = () => reject(addRequest.error);
    };
    
    getRequest.onerror = () => reject(getRequest.error);
  });
};

export const deleteCommessa = async (commessaId: string): Promise<void> => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['commesse'], 'readwrite');
    const store = transaction.objectStore('commesse');
    const request = store.delete(commessaId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// ============ UTILITY ============

export const isOnline = (): boolean => {
  return typeof navigator !== 'undefined' && navigator.onLine;
};

// Check if IndexedDB is supported
export const isIndexedDBSupported = (): boolean => {
  return typeof indexedDB !== 'undefined';
};
