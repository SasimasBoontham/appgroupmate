import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { get, getDatabase, ref, set } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { FIREBASE_CONFIG, FIREBASE_STATE_PATH } from './database-config.js';

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function isFirebaseConfigReady() {
  return (
    hasValue(FIREBASE_CONFIG.apiKey) &&
    hasValue(FIREBASE_CONFIG.databaseURL) &&
    hasValue(FIREBASE_CONFIG.projectId) &&
    hasValue(FIREBASE_CONFIG.appId)
  );
}

function getFirebaseDb() {
  if (!isFirebaseConfigReady()) {
    return null;
  }

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  return getDatabase(app);
}

export function isDatabaseConfigured() {
  return isFirebaseConfigReady();
}

function buildStructuredPayload(state) {
  const safeState = state && typeof state === 'object' ? state : {};
  const authAccounts = Array.isArray(safeState.authAccounts) ? safeState.authAccounts : [];
  const groups = Array.isArray(safeState.groups) ? safeState.groups : [];
  const messages = Array.isArray(safeState.messages) ? safeState.messages : [];
  const savedNotes = Array.isArray(safeState.savedNotes) ? safeState.savedNotes : [];
  const savedCalendar = Array.isArray(safeState.savedCalendar) ? safeState.savedCalendar : [];
  const groupMembers = Array.isArray(safeState.groupMembers) ? safeState.groupMembers : [];

  return {
    meta: {
      schemaVersion: 2,
      source: 'sentapptoajarn-web',
      updatedAt: Date.now(),
    },
    summary: {
      accountCount: authAccounts.length,
      groupCount: groups.length,
      messageCount: messages.length,
      noteCount: savedNotes.length,
      calendarCount: savedCalendar.length,
    },
    sections: {
      auth: {
        accounts: authAccounts,
        profile: safeState.authProfile || {},
      },
      groups: {
        list: groups,
        members: groupMembers,
      },
      chat: {
        messages,
        messageCounter: Number(safeState.messageCounter) || 1,
      },
      notes: {
        entries: savedNotes,
      },
      calendar: {
        entries: savedCalendar,
      },
      session: {
        currentUserName: safeState.currentUserName || '',
        currentUserId: safeState.currentUserId || '',
        generatedGroupIdCounter: Number(safeState.generatedGroupIdCounter) || 1,
      },
    },
    state: safeState,
  };
}

function normalizeRemoteState(payload) {
  if (!payload) {
    return null;
  }

  if (typeof payload.stateRaw === 'string' && payload.stateRaw.trim()) {
    try {
      return JSON.parse(payload.stateRaw);
    } catch {
      return null;
    }
  }

  if (payload.state && typeof payload.state === 'object') {
    return payload.state;
  }

  if (payload.sections && typeof payload.sections === 'object') {
    const sections = payload.sections;
    return {
      version: 1,
      authAccounts: Array.isArray(sections.auth?.accounts) ? sections.auth.accounts : [],
      authProfile: sections.auth?.profile && typeof sections.auth.profile === 'object' ? sections.auth.profile : {},
      groups: Array.isArray(sections.groups?.list) ? sections.groups.list : [],
      groupMembers: Array.isArray(sections.groups?.members) ? sections.groups.members : [],
      messages: Array.isArray(sections.chat?.messages) ? sections.chat.messages : [],
      messageCounter: Number(sections.chat?.messageCounter) || 1,
      savedNotes: Array.isArray(sections.notes?.entries) ? sections.notes.entries : [],
      savedCalendar: Array.isArray(sections.calendar?.entries) ? sections.calendar.entries : [],
      currentUserName: sections.session?.currentUserName || '',
      currentUserId: sections.session?.currentUserId || '',
      generatedGroupIdCounter: Number(sections.session?.generatedGroupIdCounter) || 1,
    };
  }

  if (payload.groups || payload.messages || payload.authAccounts || payload.authProfile) {
    return payload;
  }

  return null;
}

export async function pullRemoteState() {
  const db = getFirebaseDb();
  if (!db) {
    return null;
  }

  try {
    const snapshot = await get(ref(db, FIREBASE_STATE_PATH));
    return normalizeRemoteState(snapshot.val());
  } catch {
    return null;
  }
}

export async function pushRemoteState(state) {
  const db = getFirebaseDb();
  if (!db) {
    return false;
  }

  try {
    await set(ref(db, FIREBASE_STATE_PATH), buildStructuredPayload(state));
    return true;
  } catch {
    return false;
  }
}
