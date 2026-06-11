import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Firebase mock — tests run without real credentials
vi.mock('../firebase', () => ({
  db: {},
  auth: { currentUser: null },
  storage: {},
}));

// Firebase/firestore mock
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  query: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => null })),
  addDoc: vi.fn(() => Promise.resolve({ id: 'test-id' })),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => new Date()),
  Timestamp: { fromDate: (d: Date) => d },
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));

// Suppress console.warn in tests
vi.spyOn(console, 'warn').mockImplementation(() => {});
