import {
  APP_STORAGE_KEY,
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_HEARTBEAT_MS,
  DELETE_OPEN_THRESHOLD,
  DELETE_REVEAL_WIDTH,
  SWIPE_TAP_SLOP,
} from './js/constants.js';
import { isLamduanEmail, normalizeEmail } from './js/auth-utils.js';
import { createRealtimePersistence } from './js/realtime-persistence.js';
import { isDatabaseConfigured, pullRemoteState, pushRemoteState } from './js/database.js';
import { formatDateOnly, formatNoteTimestamp, formatTimeOnly } from './js/date-utils.js';
import { buildUniqueGroupId, normalizeGroupId } from './js/group-id-utils.js';
import { activateOnKeyboard, copyText } from './js/ui-utils.js';

// App entry module: orchestrates UI state, auth flow, chat/notes/calendar rendering,
// and persistence integration via localStorage + optional Firebase adapter.

const copyIdButton = document.querySelector('#copy-id');
const userCode = document.querySelector('#user-code');
const statusMessage = document.querySelector('#status-message');
const logoutButton = document.querySelector('#logout-btn');
const createGroupButton = document.querySelector('#create-group-btn');
const calendarButton = document.querySelector('#calendar-btn');
const joinGroupButton = document.querySelector('#join-group-btn');
const notesButton = document.querySelector('#notes-btn');
const groupList = document.querySelector('.group-list');
const loginView = document.querySelector('#login-view');
const homeView = document.querySelector('#home-view');
const chatView = document.querySelector('#chat-view');
const joinView = document.querySelector('#join-view');
const notesView = document.querySelector('#notes-view');
const calendarView = document.querySelector('#calendar-view');
const topbarTitle = document.querySelector('#topbar-title');
const backButton = document.querySelector('#back-btn');
const loginForm = document.querySelector('#login-form');
const loginNameInput = document.querySelector('#login-name-input');
const loginEmailInput = document.querySelector('#login-email-input');
const loginPasswordInput = document.querySelector('#login-password-input');
const loginPasswordToggle = document.querySelector('#login-password-toggle');
const loginCopyIdButton = document.querySelector('#login-copy-id');
const loginUserCode = document.querySelector('#login-user-code');
const loginSecondaryMessage = document.querySelector('#login-secondary-message');
const loginSignupLink = document.querySelector('#login-signup-link');
const loginForgotLink = document.querySelector('#login-forgot-link');
const signupModal = document.querySelector('#signup-modal');
const signupModalClose = document.querySelector('#signup-modal-close');
const signupModalForm = document.querySelector('#signup-modal-form');
const signupNameInput = document.querySelector('#signup-name-input');
const signupEmailInput = document.querySelector('#signup-email-input');
const signupPasswordInput = document.querySelector('#signup-password-input');
const signupModalMessage = document.querySelector('#signup-modal-message');
const forgotModal = document.querySelector('#forgot-modal');
const forgotModalClose = document.querySelector('#forgot-modal-close');
const forgotModalForm = document.querySelector('#forgot-modal-form');
const forgotEmailInput = document.querySelector('#forgot-email-input');
const forgotModalMessage = document.querySelector('#forgot-modal-message');
const welcomeTitle = document.querySelector('#welcome-title');

const chatGroupName = document.querySelector('#chat-group-name');
const chatGroupId = document.querySelector('#chat-group-id');
const copyGroupIdButton = document.querySelector('#copy-group-id-btn');
const membersButton = document.querySelector('#members-btn');
const addMemberForm = document.querySelector('#add-member-form');
const messageForm = document.querySelector('#message-form');
const chatInput = document.querySelector('#chat-input');
const chatMessages = document.querySelector('#chat-messages');
const joinForm = document.querySelector('#join-form');
const joinGroupIdInput = document.querySelector('#join-group-id-input');
const joinMessage = document.querySelector('#join-message');
const joinSubmitButton = document.querySelector('.join-submit-btn');
const notesList = document.querySelector('#notes-list');
const calendarList = document.querySelector('#calendar-list');

let currentView = 'login';
let currentGroupName = 'Math';
let previousViewBeforeNotes = 'home';
let previousViewBeforeCalendar = 'home';
let groupFormMode = 'join';
const groupMembers = new Map(); // groupId -> [{id, name}]
let currentUserName = 'You';
let currentUserId = '';
let messageCounter = 2;
let generatedGroupIdCounter = 1;
let activeSwipeItem = null;
let activeListSwipeItem = null;
const savedNotes = new Map();
const savedCalendar = new Map();
const usedGroupIds = new Set();
const authAccounts = [];
const authProfile = {
  registeredEmail: '',
  password: '',
  displayName: '',
  lastLoginEmail: '',
  recoveryEmails: [],
  lastResetCode: '',
  lastResetTarget: '',
  lastResetIssuedAt: 0,
};

let realtimePersistence = null;

function hasRegisteredAccount() {
  return authAccounts.length > 0;
}

function getAccountByEmail(email) {
  const normalized = normalizeEmail(email);
  return authAccounts.find((item) => item.email === normalized) || null;
}

function getPreferredLoginAccount() {
  const lastEmail = normalizeEmail(authProfile.lastLoginEmail);
  if (lastEmail) {
    const matched = getAccountByEmail(lastEmail);
    if (matched) {
      return matched;
    }
  }
  return authAccounts[0] || null;
}

function prefillLoginFromSavedAccount() {
  const account = getPreferredLoginAccount();
  if (!account) {
    return;
  }

  if (loginNameInput) {
    loginNameInput.value = account.displayName;
  }
  if (loginEmailInput) {
    loginEmailInput.value = account.email;
  }
  if (loginPasswordInput) {
    loginPasswordInput.value = account.password;
  }
}

function updateSignupAvailability() {
  if (!loginSignupLink) {
    return;
  }

  const isLocked = hasRegisteredAccount();
  loginSignupLink.disabled = isLocked;
  loginSignupLink.setAttribute('aria-disabled', isLocked ? 'true' : 'false');
  loginSignupLink.textContent = isLocked ? 'Sign Up Locked' : 'Sign Up';
  loginSignupLink.title = isLocked
    ? 'Account is already linked on this device. Please sign in.'
    : 'Create a new account';
}

function getResetRecipients() {
  const recipients = [authProfile.registeredEmail, ...authProfile.recoveryEmails]
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
  return [...new Set(recipients)];
}

function generateResetCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getSerializedGroups() {
  return [...document.querySelectorAll('.group-link')].map((button) => ({
    groupName: button.dataset.groupName || button.querySelector('.group-name')?.textContent?.trim() || '',
    groupId: button.dataset.groupId || '',
    members: button.dataset.members || button.querySelector('.group-members')?.textContent?.trim() || '0 members',
  }));
}

function getSerializedMessages() {
  return [...chatMessages.querySelectorAll('.chat-bubble')].map((bubble) => ({
    messageId: bubble.dataset.messageId || '',
    author: bubble.dataset.author || '',
    groupName: bubble.dataset.groupName || '',
    groupId: bubble.dataset.groupId || '',
    outgoing: bubble.classList.contains('outgoing'),
    text: bubble.querySelector('.bubble-text')?.textContent || '',
    time: bubble.querySelector('.bubble-meta')?.textContent || '',
  }));
}

function getSerializedMembers() {
  return [...groupMembers.entries()].map(([groupId, members]) => [groupId, members]);
}

function createBubbleFromState(item) {
  const bubble = document.createElement('article');
  bubble.className = item.outgoing ? 'chat-bubble outgoing' : 'chat-bubble incoming';
  bubble.dataset.messageId = item.messageId || `msg-${messageCounter}`;
  bubble.dataset.author = item.author || (item.outgoing ? 'You' : 'Member');
  bubble.dataset.groupName = item.groupName || currentGroupName;
  bubble.dataset.groupId = item.groupId || getActiveGroupId();

  const messageText = document.createElement('p');
  messageText.className = 'bubble-text';
  messageText.textContent = item.text || '';

  const meta = document.createElement('p');
  meta.className = 'bubble-meta';
  meta.textContent = item.time || formatTimeOnly(new Date());

  const metaRow = document.createElement('div');
  metaRow.className = 'bubble-meta-row';
  metaRow.append(meta);

  bubble.append(messageText, metaRow);
  return bubble;
}

function saveAppState() {
  const state = {
    version: 1,
    groups: getSerializedGroups(),
    messages: getSerializedMessages(),
    savedNotes: [...savedNotes.entries()],
    savedCalendar: [...savedCalendar.entries()],
    groupMembers: getSerializedMembers(),
    currentUserName,
    currentUserId,
    messageCounter,
    generatedGroupIdCounter,
    authAccounts: authAccounts.map((item) => ({
      displayName: item.displayName,
      email: item.email,
      password: item.password,
    })),
    authProfile: {
      registeredEmail: authProfile.registeredEmail,
      password: authProfile.password,
      displayName: authProfile.displayName,
      lastLoginEmail: authProfile.lastLoginEmail,
      recoveryEmails: [...authProfile.recoveryEmails],
      lastResetCode: authProfile.lastResetCode,
      lastResetTarget: authProfile.lastResetTarget,
      lastResetIssuedAt: authProfile.lastResetIssuedAt,
    },
  };

  const stateRaw = JSON.stringify(state);

  try {
    localStorage.setItem(APP_STORAGE_KEY, stateRaw);
  } catch {
    // Ignore storage errors (quota/private mode) without breaking app usage.
  }

  if (isDatabaseConfigured()) {
    void pushRemoteState(state);
  }
}

function setupRealtimePersistence() {
  realtimePersistence = createRealtimePersistence({
    onSave: saveAppState,
    watchedRoots: [groupList, chatMessages, notesList, calendarList],
    debounceMs: AUTOSAVE_DEBOUNCE_MS,
    heartbeatMs: AUTOSAVE_HEARTBEAT_MS,
  });
  realtimePersistence.start();
}

function loadAppState() {
  let state;
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) {
      return;
    }
    state = JSON.parse(raw);
  } catch {
    return;
  }

  if (Array.isArray(state.groups)) {
    groupList.innerHTML = '';
    state.groups.forEach((group) => {
      if (!group.groupId) {
        return;
      }
      addGroupListItem(group.groupName || group.groupId, group.groupId, group.members || '0 members');
    });
    initializeUniqueGroupIds();
  }

  savedNotes.clear();
  if (Array.isArray(state.savedNotes)) {
    state.savedNotes.forEach(([key, value]) => {
      savedNotes.set(key, value);
    });
  }

  savedCalendar.clear();
  if (Array.isArray(state.savedCalendar)) {
    state.savedCalendar.forEach(([key, value]) => {
      savedCalendar.set(key, value);
    });
  }

  groupMembers.clear();
  if (Array.isArray(state.groupMembers)) {
    state.groupMembers.forEach(([groupId, members]) => {
      groupMembers.set(groupId, Array.isArray(members) ? members : []);
    });
  }

  if (typeof state.currentUserName === 'string' && state.currentUserName.trim()) {
    currentUserName = state.currentUserName;
  }
  if (typeof state.currentUserId === 'string') {
    currentUserId = state.currentUserId;
  }

  authAccounts.length = 0;
  if (Array.isArray(state.authAccounts)) {
    state.authAccounts.forEach((account) => {
      const email = normalizeEmail(account?.email || '');
      const displayName = String(account?.displayName || '').trim();
      const password = String(account?.password || '');
      if (!email || !displayName || !password) {
        return;
      }
      authAccounts.push({
        displayName,
        email,
        password,
      });
    });
  }

  if (state.authProfile && typeof state.authProfile === 'object') {
    authProfile.registeredEmail = normalizeEmail(state.authProfile.registeredEmail || '');
    authProfile.password = typeof state.authProfile.password === 'string' ? state.authProfile.password : '';
    authProfile.displayName = typeof state.authProfile.displayName === 'string' ? state.authProfile.displayName : '';
    authProfile.lastLoginEmail = normalizeEmail(state.authProfile.lastLoginEmail || '');
    authProfile.recoveryEmails = Array.isArray(state.authProfile.recoveryEmails)
      ? state.authProfile.recoveryEmails.map((item) => normalizeEmail(item)).filter(Boolean)
      : [];
    authProfile.lastResetCode = typeof state.authProfile.lastResetCode === 'string' ? state.authProfile.lastResetCode : '';
    authProfile.lastResetTarget = normalizeEmail(state.authProfile.lastResetTarget || '');
    authProfile.lastResetIssuedAt = Number.isFinite(state.authProfile.lastResetIssuedAt)
      ? Number(state.authProfile.lastResetIssuedAt)
      : 0;

    // Backward compatibility for older single-account state.
    if (authAccounts.length === 0 && authProfile.registeredEmail && authProfile.password && authProfile.displayName) {
      authAccounts.push({
        displayName: authProfile.displayName,
        email: authProfile.registeredEmail,
        password: authProfile.password,
      });
    }
  }

  if (Array.isArray(state.messages)) {
    chatMessages.innerHTML = '';
    let maxMessageNumber = 0;

    state.messages.forEach((item) => {
      const bubble = createBubbleFromState(item);
      chatMessages.appendChild(bubble);
      const match = String(item.messageId || '').match(/^msg-(\d+)$/);
      if (match) {
        maxMessageNumber = Math.max(maxMessageNumber, Number(match[1]));
      }
    });

    messageCounter = Math.max(maxMessageNumber + 1, Number(state.messageCounter) || 1);
  }

  if (Number.isFinite(state.generatedGroupIdCounter)) {
    generatedGroupIdCounter = Math.max(1, Number(state.generatedGroupIdCounter));
  }

  chatMessages.querySelectorAll('.chat-bubble').forEach((bubble) => {
    attachBubbleReactions(bubble);
    attachBubbleSwipe(bubble);
  });

  syncVisibleMessagesForCurrentGroup();
  refreshReactionsForCurrentGroup();
  renderNotes();
  renderCalendar();

  if (hasRegisteredAccount()) {
    prefillLoginFromSavedAccount();
  }
  updateSignupAvailability();
}

function getActiveGroupId() {
  return chatGroupId.textContent.trim() || 'unknown-group';
}

function buildReactionKey(messageId, groupId = getActiveGroupId()) {
  return `${groupId}::${messageId}`;
}

function setGroupFormMode(mode) {
  groupFormMode = mode === 'create' ? 'create' : 'join';

  if (groupFormMode === 'create') {
    joinSubmitButton.textContent = 'Create Group';
    joinGroupIdInput.placeholder = 'Enter Group ID (e.g. g-123)';
    return;
  }

  joinSubmitButton.textContent = 'Join Group';
  joinGroupIdInput.placeholder = 'Enter Group ID (e.g. g-123)';
}

function syncBubbleVisualByReactionKey(reactionKey) {
  const [groupId, messageId] = reactionKey.split('::');
  if (!groupId || !messageId) {
    return;
  }

  chatMessages
    .querySelectorAll(`.chat-bubble[data-group-id="${groupId}"][data-message-id="${messageId}"]`)
    .forEach((bubble) => {
      syncBubbleReactionVisuals(bubble);
    });
}

function deleteSavedNoteByKey(reactionKey) {
  savedNotes.delete(reactionKey);
  renderNotes();
  syncBubbleVisualByReactionKey(reactionKey);
  saveAppState();
}

function deleteSavedCalendarByKey(reactionKey) {
  savedCalendar.delete(reactionKey);
  renderCalendar();
  syncBubbleVisualByReactionKey(reactionKey);
  saveAppState();
}

function setListSwipeOffset(card, offset) {
  const limitedOffset = Math.max(-DELETE_REVEAL_WIDTH, Math.min(0, offset));
  card.style.transform = `translateX(${limitedOffset}px)`;
}

function closeListSwipeItem(item) {
  if (!item) {
    return;
  }

  const card = item.querySelector('.swipe-card');
  if (!card) {
    return;
  }

  item.classList.remove('swipe-open');
  setListSwipeOffset(card, 0);

  if (activeListSwipeItem === item) {
    activeListSwipeItem = null;
  }
}

function openListSwipeItem(item) {
  if (!item) {
    return;
  }

  if (activeListSwipeItem && activeListSwipeItem !== item) {
    closeListSwipeItem(activeListSwipeItem);
  }

  const card = item.querySelector('.swipe-card');
  if (!card) {
    return;
  }

  item.classList.add('swipe-open');
  setListSwipeOffset(card, -DELETE_REVEAL_WIDTH);
  activeListSwipeItem = item;
}

function attachListSwipe(item, card, onSwipeDelete) {
  if (item.dataset.swipeBound === 'true') {
    return;
  }

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let isDragging = false;
  let isHorizontalSwipe = false;

  card.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffset = item.classList.contains('swipe-open') ? -DELETE_REVEAL_WIDTH : 0;
    isDragging = true;
    isHorizontalSwipe = false;
    card.classList.add('is-swiping');
    card.setPointerCapture(event.pointerId);
  });

  card.addEventListener('pointermove', (event) => {
    if (!isDragging || event.pointerId !== pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!isHorizontalSwipe) {
      if (Math.abs(deltaX) < SWIPE_TAP_SLOP && Math.abs(deltaY) < SWIPE_TAP_SLOP) {
        return;
      }

      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        isDragging = false;
        card.classList.remove('is-swiping');
        if (card.hasPointerCapture(pointerId)) {
          card.releasePointerCapture(pointerId);
        }
        pointerId = null;
        return;
      }

      isHorizontalSwipe = true;
      card.dataset.preventClick = 'true';
      if (activeListSwipeItem && activeListSwipeItem !== item) {
        closeListSwipeItem(activeListSwipeItem);
      }
    }

    event.preventDefault();
    setListSwipeOffset(card, startOffset + deltaX);
  });

  function finishSwipe(event) {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (card.hasPointerCapture(event.pointerId)) {
      card.releasePointerCapture(event.pointerId);
    }

    const deltaX = event.clientX - startX;
    const finalOffset = Math.max(-DELETE_REVEAL_WIDTH, Math.min(0, startOffset + deltaX));

    if (finalOffset <= -DELETE_OPEN_THRESHOLD) {
      card.classList.remove('is-swiping');
      isDragging = false;
      isHorizontalSwipe = false;
      pointerId = null;
      card.dataset.preventClick = 'false';
      if (typeof onSwipeDelete === 'function') {
        onSwipeDelete();
      }
      return;
    } else {
      closeListSwipeItem(item);
    }

    card.classList.remove('is-swiping');
    isDragging = false;
    isHorizontalSwipe = false;
    pointerId = null;
  }

  card.addEventListener('pointerup', finishSwipe);
  card.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (card.hasPointerCapture(event.pointerId)) {
      card.releasePointerCapture(event.pointerId);
    }

    closeListSwipeItem(item);
    card.classList.remove('is-swiping');
    isDragging = false;
    isHorizontalSwipe = false;
    pointerId = null;
  });

  card.addEventListener('click', (event) => {
    if (card.dataset.preventClick === 'true') {
      event.preventDefault();
      event.stopPropagation();
      card.dataset.preventClick = 'false';
      return;
    }

    if (item.classList.contains('swipe-open')) {
      event.preventDefault();
      event.stopPropagation();
      closeListSwipeItem(item);
    }
  });

  item.dataset.swipeBound = 'true';
}

function renderNotes() {
  notesList.innerHTML = '';
  activeListSwipeItem = null;

  if (savedNotes.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'note-time';
    empty.textContent = 'No saved notes yet.';
    notesList.appendChild(empty);
    return;
  }

  const items = [...savedNotes.entries()]
    .map(([reactionKey, note]) => ({ reactionKey, note }))
    .sort((a, b) => b.note.createdAt - a.note.createdAt);
  items.forEach(({ reactionKey, note }) => {
    const swipeItem = document.createElement('div');
    swipeItem.className = 'list-swipe-item note-swipe-item';

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'note-card note-card-action swipe-card';
    card.setAttribute('aria-label', `Open chat message: ${note.text}`);
    card.addEventListener('click', () => {
      focusMessageFromNote(note);
    });

    const group = document.createElement('p');
    group.className = 'note-group';
    group.textContent = note.group;

    const text = document.createElement('p');
    text.className = 'note-text';
    text.textContent = `❤️ ${note.text}`;

    const time = document.createElement('p');
    time.className = 'note-time';
    time.textContent = note.timestamp;

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'list-delete-btn';
    deleteButton.setAttribute('aria-label', 'Delete note item');
    deleteButton.textContent = '🗑';
    deleteButton.addEventListener('click', () => {
      deleteSavedNoteByKey(reactionKey);
    });

    card.append(group, text, time);
    swipeItem.append(card, deleteButton);
    notesList.appendChild(swipeItem);
    attachListSwipe(swipeItem, card, () => {
      deleteSavedNoteByKey(reactionKey);
    });
  });
}

function createGeneratedGroupId() {
  const stamp = Date.now();
  const value = `g-${stamp}-${generatedGroupIdCounter}`;
  generatedGroupIdCounter += 1;
  return value;
}

function getUniqueGroupId(preferredId = '') {
  return buildUniqueGroupId({
    preferredId,
    usedIds: usedGroupIds,
    generateFallback: createGeneratedGroupId,
  });
}

function registerGroupId(id) {
  const normalized = normalizeGroupId(id);
  if (!normalized) {
    return '';
  }
  usedGroupIds.add(normalized);
  return normalized;
}

function initializeUniqueGroupIds() {
  usedGroupIds.clear();
  const buttons = document.querySelectorAll('.group-link');

  buttons.forEach((button) => {
    const fixedId = getUniqueGroupId(button.dataset.groupId || '');
    button.dataset.groupId = fixedId;
    registerGroupId(fixedId);
  });
}

function findGroupButtonById(groupId) {
  return [...document.querySelectorAll('.group-link')].find(
    (groupButton) => groupButton.dataset.groupId === groupId
  );
}

function findGroupButtonByName(groupName) {
  return [...document.querySelectorAll('.group-link')].find(
    (groupButton) => groupButton.dataset.groupName === groupName
  );
}

function ensureGroupMembers(groupId) {
  if (!groupMembers.has(groupId)) {
    groupMembers.set(groupId, []);
  }
  return groupMembers.get(groupId);
}

function addMemberToGroup(groupId, memberId, memberName) {
  const list = ensureGroupMembers(groupId);
  const alreadyExists = list.some((m) => m.id === memberId);
  if (!alreadyExists) {
    list.push({ id: memberId, name: memberName });
    saveAppState();
  }
}

function addGroupListItem(groupName, groupId, members = '1 members') {
  const listItem = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'group-item group-link';
  button.dataset.groupName = groupName;
  button.dataset.groupId = groupId;
  button.dataset.members = members;

  const name = document.createElement('span');
  name.className = 'group-name';
  name.textContent = groupName;

  const memberText = document.createElement('span');
  memberText.className = 'group-members';
  memberText.textContent = members;

  button.append(name, memberText);
  listItem.appendChild(button);
  groupList.appendChild(listItem);
  return button;
}

function getGroupIdByName(groupName) {
  const matched = findGroupButtonByName(groupName);
  return matched?.dataset.groupId || '';
}

function focusMessageFromCalendar(item) {
  const groupId = item.groupId || getGroupIdByName(item.group);
  setChatView(item.group, groupId || item.group);

  const bubble = chatMessages.querySelector(`[data-message-id="${item.id}"]`);
  if (!bubble) {
    return;
  }

  bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
  bubble.classList.add('from-calendar-focus');
  window.setTimeout(() => {
    bubble.classList.remove('from-calendar-focus');
  }, 1300);
}

function focusMessageFromNote(item) {
  const groupId = item.groupId || getGroupIdByName(item.group);
  setChatView(item.group, groupId || item.group);

  const bubble = chatMessages.querySelector(`[data-message-id="${item.id}"]`);
  if (!bubble) {
    return;
  }

  bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
  bubble.classList.add('from-calendar-focus');
  window.setTimeout(() => {
    bubble.classList.remove('from-calendar-focus');
  }, 1300);
}

function renderCalendar() {
  calendarList.innerHTML = '';
  activeListSwipeItem = null;

  if (savedCalendar.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'calendar-time';
    empty.textContent = 'No saved calendar items yet.';
    calendarList.appendChild(empty);
    return;
  }

  const items = [...savedCalendar.entries()]
    .map(([reactionKey, item]) => ({ reactionKey, item }))
    .sort((a, b) => b.item.createdAt - a.item.createdAt);
  const grouped = items.reduce((acc, entry) => {
    const { item } = entry;
    if (!acc[item.date]) {
      acc[item.date] = [];
    }
    acc[item.date].push(entry);
    return acc;
  }, {});

  Object.keys(grouped).forEach((dateKey) => {
    const wrapper = document.createElement('section');
    wrapper.className = 'calendar-date-group';

    const heading = document.createElement('h3');
    heading.className = 'calendar-date-heading';
    heading.textContent = dateKey;
    wrapper.appendChild(heading);

    grouped[dateKey].forEach(({ reactionKey, item }) => {
      const swipeItem = document.createElement('div');
      swipeItem.className = 'list-swipe-item calendar-swipe-item';

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'calendar-card calendar-card-action swipe-card';
      card.setAttribute('aria-label', `Open chat message: ${item.text}`);
      card.addEventListener('click', () => {
        focusMessageFromCalendar(item);
      });

      const group = document.createElement('p');
      group.className = 'calendar-group';
      group.textContent = item.group;

      const text = document.createElement('p');
      text.className = 'calendar-text';
      text.textContent = `💚 ${item.text}`;

      const time = document.createElement('p');
      time.className = 'calendar-time';
      time.textContent = item.time;

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'list-delete-btn';
      deleteButton.setAttribute('aria-label', 'Delete calendar item');
      deleteButton.textContent = '🗑';
      deleteButton.addEventListener('click', () => {
        deleteSavedCalendarByKey(reactionKey);
      });

      card.append(group, text, time);
      swipeItem.append(card, deleteButton);
      wrapper.appendChild(swipeItem);
      attachListSwipe(swipeItem, card, () => {
        deleteSavedCalendarByKey(reactionKey);
      });
    });

    calendarList.appendChild(wrapper);
  });
}

function createHeartButton(type) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `reaction-btn ${type}`;
  button.setAttribute('aria-label', type === 'green-heart' ? 'Mark green heart' : 'Save to notes');
  button.textContent = '🤍';
  if (type === 'red-heart') {
    button.dataset.noteToggle = 'true';
  }
  return button;
}

function setGreenHeartVisual(button, isActive) {
  button.classList.toggle('active', isActive);
  button.textContent = isActive ? '💚' : '🤍';
}

function setRedHeartVisual(button, isActive) {
  button.classList.toggle('active', isActive);
  button.textContent = isActive ? '❤️' : '🤍';
}

function syncBubbleReactionVisuals(bubble) {
  const greenHeart = bubble.querySelector('.green-heart');
  const redHeart = bubble.querySelector('.red-heart');
  const messageId = bubble.dataset.messageId;
  if (!greenHeart || !redHeart || !messageId) {
    return;
  }

  const groupId = bubble.dataset.groupId || getActiveGroupId();
  const reactionKey = buildReactionKey(messageId, groupId);
  setGreenHeartVisual(greenHeart, savedCalendar.has(reactionKey));
  setRedHeartVisual(redHeart, savedNotes.has(reactionKey));
}

function bubbleBelongsToActiveGroup(bubble) {
  return (bubble.dataset.groupId || '') === getActiveGroupId();
}

function syncVisibleMessagesForCurrentGroup() {
  const swipeItems = chatMessages.querySelectorAll('.chat-swipe-item');

  swipeItems.forEach((item) => {
    const bubble = item.querySelector('.chat-bubble');
    if (!bubble) {
      return;
    }

    const shouldShow = bubbleBelongsToActiveGroup(bubble);
    item.classList.toggle('is-hidden', !shouldShow);

    if (!shouldShow) {
      item.classList.remove('swipe-open');
      setBubbleSwipeOffset(bubble, 0);
      if (activeSwipeItem === item) {
        activeSwipeItem = null;
      }
    }
  });

  chatMessages.querySelectorAll('.chat-bubble').forEach((bubble) => {
    if (bubble.closest('.chat-swipe-item')) {
      return;
    }

    bubble.classList.toggle('is-hidden', !bubbleBelongsToActiveGroup(bubble));
  });
}

function refreshReactionsForCurrentGroup() {
  chatMessages.querySelectorAll('.chat-bubble').forEach((bubble) => {
    if (!bubbleBelongsToActiveGroup(bubble)) {
      return;
    }

    syncBubbleReactionVisuals(bubble);
  });
}

function setBubbleSwipeOffset(bubble, offset) {
  const limitedOffset = Math.max(-DELETE_REVEAL_WIDTH, Math.min(0, offset));
  bubble.style.transform = `translateX(${limitedOffset}px)`;
}

function closeSwipeItem(item) {
  if (!item) {
    return;
  }

  const bubble = item.querySelector('.chat-bubble');
  if (!bubble) {
    return;
  }

  item.classList.remove('swipe-open');
  setBubbleSwipeOffset(bubble, 0);

  if (activeSwipeItem === item) {
    activeSwipeItem = null;
  }
}

function openSwipeItem(item) {
  if (!item) {
    return;
  }

  if (activeSwipeItem && activeSwipeItem !== item) {
    closeSwipeItem(activeSwipeItem);
  }

  const bubble = item.querySelector('.chat-bubble');
  if (!bubble) {
    return;
  }

  item.classList.add('swipe-open');
  setBubbleSwipeOffset(bubble, -DELETE_REVEAL_WIDTH);
  activeSwipeItem = item;
}

function deleteMessageBubble(bubble) {
  if (!bubble?.dataset.messageId) {
    return;
  }

  const messageId = bubble.dataset.messageId;
  const groupId = bubble.dataset.groupId || getActiveGroupId();
  const reactionKey = buildReactionKey(messageId, groupId);

  savedNotes.delete(reactionKey);
  savedCalendar.delete(reactionKey);
  renderNotes();
  renderCalendar();
  saveAppState();

  const item = bubble.closest('.chat-swipe-item');
  if (item) {
    if (activeSwipeItem === item) {
      activeSwipeItem = null;
    }
    item.remove();
    return;
  }

  bubble.remove();
}

function ensureBubbleSwipeActions(bubble) {
  const existingItem = bubble.closest('.chat-swipe-item');
  if (existingItem) {
    return existingItem;
  }

  const item = document.createElement('div');
  item.className = 'chat-swipe-item';

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'message-delete-btn';
  deleteButton.setAttribute('aria-label', 'Delete message');
  deleteButton.textContent = '🗑';
  deleteButton.addEventListener('click', () => {
    deleteMessageBubble(bubble);
  });

  bubble.parentNode.insertBefore(item, bubble);
  item.append(bubble, deleteButton);
  setBubbleSwipeOffset(bubble, 0);

  return item;
}

function attachBubbleSwipe(bubble) {
  const item = ensureBubbleSwipeActions(bubble);
  if (item.dataset.swipeBound === 'true') {
    return;
  }

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let isDragging = false;
  let isHorizontalSwipe = false;

  bubble.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (event.target.closest('.reaction-btn')) {
      return;
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startOffset = item.classList.contains('swipe-open') ? -DELETE_REVEAL_WIDTH : 0;
    isDragging = true;
    isHorizontalSwipe = false;
    bubble.classList.add('is-swiping');
    bubble.setPointerCapture(event.pointerId);
  });

  bubble.addEventListener('pointermove', (event) => {
    if (!isDragging || event.pointerId !== pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!isHorizontalSwipe) {
      if (Math.abs(deltaX) < SWIPE_TAP_SLOP && Math.abs(deltaY) < SWIPE_TAP_SLOP) {
        return;
      }

      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        isDragging = false;
        bubble.classList.remove('is-swiping');
        if (bubble.hasPointerCapture(pointerId)) {
          bubble.releasePointerCapture(pointerId);
        }
        pointerId = null;
        return;
      }

      isHorizontalSwipe = true;
      if (activeSwipeItem && activeSwipeItem !== item) {
        closeSwipeItem(activeSwipeItem);
      }
    }

    event.preventDefault();
    setBubbleSwipeOffset(bubble, startOffset + deltaX);
  });

  function finishSwipe(event) {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (bubble.hasPointerCapture(event.pointerId)) {
      bubble.releasePointerCapture(event.pointerId);
    }

    const deltaX = event.clientX - startX;
    const finalOffset = Math.max(-DELETE_REVEAL_WIDTH, Math.min(0, startOffset + deltaX));

    if (finalOffset <= -DELETE_OPEN_THRESHOLD) {
      bubble.classList.remove('is-swiping');
      isDragging = false;
      isHorizontalSwipe = false;
      pointerId = null;
      deleteMessageBubble(bubble);
      return;
    } else {
      closeSwipeItem(item);
    }

    bubble.classList.remove('is-swiping');
    isDragging = false;
    isHorizontalSwipe = false;
    pointerId = null;
  }

  bubble.addEventListener('pointerup', finishSwipe);
  bubble.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== pointerId) {
      return;
    }

    if (bubble.hasPointerCapture(event.pointerId)) {
      bubble.releasePointerCapture(event.pointerId);
    }

    closeSwipeItem(item);
    bubble.classList.remove('is-swiping');
    isDragging = false;
    isHorizontalSwipe = false;
    pointerId = null;
  });

  item.dataset.swipeBound = 'true';
}

function attachBubbleReactions(bubble) {
  if (!bubble.dataset.messageId) {
    bubble.dataset.messageId = `msg-${messageCounter}`;
    messageCounter += 1;
  }

  if (!bubble.dataset.groupName) {
    bubble.dataset.groupName = currentGroupName;
  }

  if (!bubble.dataset.groupId) {
    bubble.dataset.groupId = chatGroupId.textContent.trim();
  }

  const metaRow = bubble.querySelector('.bubble-meta-row');
  if (!metaRow) {
    return;
  }

  let reactions = metaRow.querySelector('.bubble-reactions');
  if (!reactions) {
    reactions = document.createElement('div');
    reactions.className = 'bubble-reactions';
    reactions.setAttribute('aria-label', 'Message reactions');
    metaRow.appendChild(reactions);
  }

  let greenHeart = reactions.querySelector('.green-heart');
  if (!greenHeart) {
    greenHeart = createHeartButton('green-heart');
    reactions.appendChild(greenHeart);
  }

  let redHeart = reactions.querySelector('.red-heart');
  if (!redHeart) {
    redHeart = createHeartButton('red-heart');
    reactions.appendChild(redHeart);
  }

  syncBubbleReactionVisuals(bubble);

  if (greenHeart.dataset.bound === 'true' && redHeart.dataset.bound === 'true') {
    return;
  }

  greenHeart.addEventListener('click', () => {
    const messageId = bubble.dataset.messageId;
    const groupId = bubble.dataset.groupId || getActiveGroupId();
    const reactionKey = buildReactionKey(messageId, groupId);
    const text = bubble.querySelector('.bubble-text')?.textContent?.trim() || '';
    if (!messageId || !text) {
      return;
    }

    if (savedCalendar.has(reactionKey)) {
      savedCalendar.delete(reactionKey);
      setGreenHeartVisual(greenHeart, false);
    } else {
      const now = new Date();
      savedCalendar.set(reactionKey, {
        id: messageId,
        group: currentGroupName,
        groupId,
        text,
        date: formatDateOnly(now),
        time: formatTimeOnly(now),
        createdAt: now.getTime(),
      });
      setGreenHeartVisual(greenHeart, true);
    }

    renderCalendar();
  });
  greenHeart.dataset.bound = 'true';

  redHeart.addEventListener('click', () => {
    const messageId = bubble.dataset.messageId;
    const groupId = bubble.dataset.groupId || getActiveGroupId();
    const reactionKey = buildReactionKey(messageId, groupId);
    const text = bubble.querySelector('.bubble-text')?.textContent?.trim() || '';
    if (!messageId || !text) {
      return;
    }

    if (savedNotes.has(reactionKey)) {
      savedNotes.delete(reactionKey);
      setRedHeartVisual(redHeart, false);
    } else {
      savedNotes.set(reactionKey, {
        id: messageId,
        group: currentGroupName,
        groupId,
        text,
        timestamp: formatNoteTimestamp(new Date()),
        createdAt: Date.now(),
      });
      setRedHeartVisual(redHeart, true);
    }

    renderNotes();
  });
  redHeart.dataset.bound = 'true';
}

function setCurrentGroup(groupName) {
  currentGroupName = groupName || 'Unknown Group';
}

function showView(viewName) {
  loginView.classList.add('is-hidden');
  homeView.classList.add('is-hidden');
  chatView.classList.add('is-hidden');
  joinView.classList.add('is-hidden');
  notesView.classList.add('is-hidden');
  calendarView.classList.add('is-hidden');
  document.body.classList.remove('page-login', 'page-home', 'page-chat', 'page-join', 'page-notes', 'page-calendar');
  document.body.classList.add(`page-${viewName}`);
  currentView = viewName;

  if (viewName === 'login') {
    loginView.classList.remove('is-hidden');
    topbarTitle.textContent = 'Login';
    backButton.classList.add('is-hidden');
    return;
  }

  if (viewName === 'home') {
    homeView.classList.remove('is-hidden');
    topbarTitle.textContent = 'Home';
    backButton.classList.add('is-hidden');
    return;
  }

  if (viewName === 'chat') {
    chatView.classList.remove('is-hidden');
    topbarTitle.textContent = 'Chat';
    backButton.classList.remove('is-hidden');
    return;
  }

  if (viewName === 'join') {
    joinView.classList.remove('is-hidden');
    topbarTitle.textContent = groupFormMode === 'create' ? 'CreateGroup' : 'JoinGroup';
    backButton.classList.remove('is-hidden');
    return;
  }

  if (viewName === 'notes') {
    notesView.classList.remove('is-hidden');
    topbarTitle.textContent = 'Notes';
    backButton.classList.remove('is-hidden');
    return;
  }

  if (viewName === 'calendar') {
    calendarView.classList.remove('is-hidden');
    topbarTitle.textContent = 'Calendar';
    backButton.classList.remove('is-hidden');
  }
}

function setHomeView() {
  showView('home');
}

function setChatView(groupName, groupId) {
  chatGroupName.textContent = groupName;
  chatGroupId.textContent = groupId;
  setCurrentGroup(groupName);
  closeSwipeItem(activeSwipeItem);
  syncVisibleMessagesForCurrentGroup();
  showView('chat');
  refreshReactionsForCurrentGroup();
  // Seed current user as a member of this group if not already present
  addMemberToGroup(groupId, currentUserId || userCode.textContent.trim(), currentUserName);
}

function addOutgoingMessage(text) {
  const bubble = document.createElement('article');
  bubble.className = 'chat-bubble outgoing';
  bubble.dataset.messageId = `msg-${messageCounter}`;
  bubble.dataset.author = 'You';
  bubble.dataset.groupName = currentGroupName;
  bubble.dataset.groupId = chatGroupId.textContent.trim();
  messageCounter += 1;

  const messageText = document.createElement('p');
  messageText.className = 'bubble-text';
  messageText.textContent = text;

  const meta = document.createElement('p');
  meta.className = 'bubble-meta';
  meta.textContent = new Date().toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const metaRow = document.createElement('div');
  metaRow.className = 'bubble-meta-row';
  metaRow.append(meta);

  const reactions = document.createElement('div');
  reactions.className = 'bubble-reactions';

  const greenHeart = document.createElement('button');
  greenHeart.type = 'button';
  greenHeart.className = 'reaction-btn green-heart';
  greenHeart.setAttribute('aria-label', 'Mark green heart');
  greenHeart.textContent = '🤍';

  const redHeart = document.createElement('button');
  redHeart.type = 'button';
  redHeart.className = 'reaction-btn red-heart';
  redHeart.dataset.noteToggle = 'true';
  redHeart.setAttribute('aria-label', 'Save to notes');
  redHeart.textContent = '🤍';

  reactions.append(greenHeart, redHeart);
  metaRow.append(reactions);
  bubble.append(messageText, metaRow);
  chatMessages.appendChild(bubble);
  attachBubbleReactions(bubble);
  attachBubbleSwipe(bubble);
  bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
  saveAppState();
}

let copyTooltipTimer = null;

    saveAppState();
function showCopyTooltip(anchorEl, message) {
  let tooltip = document.querySelector('#copy-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'copy-tooltip';
    tooltip.setAttribute('role', 'status');
    tooltip.setAttribute('aria-live', 'polite');
    document.body.appendChild(tooltip);
  }

  tooltip.textContent = message;
  tooltip.classList.remove('copy-tooltip-hide');
    saveAppState();
  tooltip.classList.add('copy-tooltip-show');

  const rect = anchorEl.getBoundingClientRect();
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  const scrollX = window.scrollX || document.documentElement.scrollLeft;
  const left = rect.left + scrollX + rect.width / 2;
  const top = rect.bottom + scrollY + 6;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  clearTimeout(copyTooltipTimer);
  copyTooltipTimer = setTimeout(() => {
    tooltip.classList.remove('copy-tooltip-show');
    tooltip.classList.add('copy-tooltip-hide');
  }, 1600);
}

if (copyIdButton && userCode) {
  copyIdButton.addEventListener('click', () => {
    copyText(userCode.textContent.trim(), {
      onSuccess: () => {
        showCopyTooltip(copyIdButton, 'Copied user code.');
        if (statusMessage) {
          statusMessage.textContent = '';
        }
      },
      onError: () => {
        if (statusMessage) {
          statusMessage.textContent = 'Unable to copy automatically. Please copy manually.';
        }
      },
    });
  });

  copyIdButton.addEventListener('keydown', (event) => {
    activateOnKeyboard(event, () => copyIdButton.click());
  });
}

if (loginCopyIdButton && loginUserCode) {
  loginCopyIdButton.addEventListener('click', () => {
    copyText(loginUserCode.textContent.trim(), {
      onSuccess: () => {
        showCopyTooltip(loginCopyIdButton, 'Copied user code.');
      },
    });
  });

  loginCopyIdButton.addEventListener('keydown', (event) => {
    activateOnKeyboard(event, () => loginCopyIdButton.click());
  });
}

if (loginForm) {
  const attemptSignIn = ({ showErrors = true } = {}) => {
    const name = loginNameInput.value.trim();
    const email = normalizeEmail(loginEmailInput.value);
    const password = loginPasswordInput.value.trim();

    const setLoginError = (message) => {
      if (showErrors && loginSecondaryMessage) {
        loginSecondaryMessage.textContent = message;
      }
    };

    if (!name || !email || !password) {
      setLoginError('Please enter display name, email, and password.');
      return false;
    }

    if (!isLamduanEmail(email)) {
      setLoginError('Please use your @lamduan.mfu.ac.th email only.');
      return false;
    }

    if (!hasRegisteredAccount()) {
      setLoginError('Please sign up first.');
      return false;
    }

    const matchedAccount = getAccountByEmail(email);
    if (!matchedAccount) {
      setLoginError('This email is not registered. Please sign up first.');
      return false;
    }

    if (name !== matchedAccount.displayName) {
      setLoginError(`Display name must match exactly: ${matchedAccount.displayName}`);
      return false;
    }

    if (password !== matchedAccount.password) {
      setLoginError('Incorrect password. Use the same password you signed up with.');
      return false;
    }

    const activeName = matchedAccount.displayName;

    if (welcomeTitle) {
      welcomeTitle.textContent = `Welcome, ${activeName}`;
    }
    if (statusMessage) {
      statusMessage.textContent = '';
    }
    if (loginSecondaryMessage) {
      loginSecondaryMessage.textContent = '';
    }
    currentUserName = activeName;
    currentUserId = (loginUserCode?.textContent || userCode?.textContent || 'U-LOCAL').trim();
    authProfile.lastLoginEmail = email;
    setHomeView();
    saveAppState();
    return true;
  };

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    attemptSignIn({ showErrors: true });
  });

  [loginNameInput, loginEmailInput, loginPasswordInput].forEach((field) => {
    field.addEventListener('input', () => {
      if (loginSecondaryMessage) {
        loginSecondaryMessage.textContent = '';
      }

      attemptSignIn({ showErrors: false });
    });
  });

  if (loginEmailInput) {
    loginEmailInput.addEventListener('input', () => {
      const matchedAccount = getAccountByEmail(loginEmailInput.value);
      if (!matchedAccount) {
        return;
      }

      if (loginNameInput && !loginNameInput.value.trim()) {
        loginNameInput.value = matchedAccount.displayName;
      }
      if (loginPasswordInput && !loginPasswordInput.value.trim()) {
        loginPasswordInput.value = matchedAccount.password;
      }

      attemptSignIn({ showErrors: false });
    });
  }
}

if (loginPasswordToggle) {
  loginPasswordToggle.addEventListener('click', () => {
    const isPassword = loginPasswordInput.type === 'password';
    loginPasswordInput.type = isPassword ? 'text' : 'password';
    loginPasswordToggle.textContent = isPassword ? 'Hide' : 'Show';
    loginPasswordToggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });
}

if (loginSignupLink) {
  loginSignupLink.addEventListener('click', () => {
    if (hasRegisteredAccount()) {
      if (loginSecondaryMessage) {
        loginSecondaryMessage.textContent = 'Sign up is locked after first registration. Please sign in with your linked account.';
      }
      return;
    }

    if (signupModalMessage) {
      signupModalMessage.textContent = '';
    }
    if (signupModalForm) {
      signupModalForm.reset();
    }
    if (signupNameInput && loginNameInput?.value.trim()) {
      signupNameInput.value = loginNameInput.value.trim();
    }
    if (signupEmailInput && loginEmailInput?.value.trim()) {
      signupEmailInput.value = normalizeEmail(loginEmailInput.value);
    }
    if (signupModal) {
      signupModal.classList.remove('is-hidden');
    }
    if (signupNameInput) {
      signupNameInput.focus();
    }
  });
}

if (signupModalClose) {
  signupModalClose.addEventListener('click', () => {
    if (signupModal) {
      signupModal.classList.add('is-hidden');
    }
  });
}

if (signupModal) {
  signupModal.addEventListener('click', (event) => {
    if (event.target === signupModal) {
      signupModal.classList.add('is-hidden');
    }
  });
}

if (signupModalForm) {
  signupModalForm.addEventListener('submit', (event) => {
    event.preventDefault();

    if (hasRegisteredAccount()) {
      if (signupModalMessage) {
        signupModalMessage.textContent = 'Sign up already completed. Please sign in with your linked account.';
      }
      return;
    }

    const name = signupNameInput?.value.trim() || '';
    const email = normalizeEmail(signupEmailInput?.value || '');
    const password = signupPasswordInput?.value.trim() || '';

    if (getAccountByEmail(email)) {
      if (signupModalMessage) {
        signupModalMessage.textContent = 'This email is already registered. Please login.';
      }
      return;
    }

    if (!name || !email || !password) {
      if (signupModalMessage) {
        signupModalMessage.textContent = 'Please fill display name, email, and password.';
      }
      return;
    }

    if (!isLamduanEmail(email)) {
      if (signupModalMessage) {
        signupModalMessage.textContent = 'Sign up requires @lamduan.mfu.ac.th email.';
      }
      return;
    }

    authAccounts.push({
      displayName: name,
      email,
      password,
    });

    // Keep latest account mirrored for compatibility with existing state model.
    authProfile.displayName = name;
    authProfile.registeredEmail = email;
    authProfile.password = password;
    authProfile.lastLoginEmail = email;
    authProfile.recoveryEmails = [];

    if (loginNameInput) {
      loginNameInput.value = name;
    }
    if (loginEmailInput) {
      loginEmailInput.value = email;
    }
    if (loginPasswordInput) {
      loginPasswordInput.value = password;
    }

    saveAppState();
    updateSignupAvailability();

    if (loginSecondaryMessage) {
      loginSecondaryMessage.textContent = 'Sign up successful. Use this same password every time you login.';
    }
    if (signupModal) {
      signupModal.classList.add('is-hidden');
    }
  });
}

if (loginForgotLink) {
  loginForgotLink.addEventListener('click', () => {
    if (forgotModalMessage) {
      forgotModalMessage.textContent = '';
    }
    if (forgotModalForm) {
      forgotModalForm.reset();
    }
    if (forgotModal) {
      forgotModal.classList.remove('is-hidden');
    }
    if (forgotEmailInput) {
      forgotEmailInput.focus();
    }
  });
}

if (forgotModalClose) {
  forgotModalClose.addEventListener('click', () => {
    if (forgotModal) {
      forgotModal.classList.add('is-hidden');
    }
  });
}

if (forgotModal) {
  forgotModal.addEventListener('click', (event) => {
    if (event.target === forgotModal) {
      forgotModal.classList.add('is-hidden');
    }
  });
}

if (forgotModalForm) {
  forgotModalForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const requestedEmail = normalizeEmail(forgotEmailInput?.value || '');
    if (!isLamduanEmail(requestedEmail)) {
      if (forgotModalMessage) {
        forgotModalMessage.textContent = 'กรอกได้เฉพาะอีเมล @lamduan.mfu.ac.th เท่านั้น';
      }
      return;
    }

    const account = getAccountByEmail(requestedEmail);
    if (!account) {
      if (forgotModalMessage) {
        forgotModalMessage.textContent = 'อีเมลนี้ยังไม่ได้ลงทะเบียนในระบบ';
      }
      return;
    }

    const resetCode = account.password;
    authProfile.lastResetCode = resetCode;
    authProfile.lastResetTarget = requestedEmail;
    authProfile.lastResetIssuedAt = Date.now();
    saveAppState();

    if (forgotModalMessage) {
      forgotModalMessage.textContent = `ส่งรหัสรีเซ็ตไปที่ ${requestedEmail} แล้ว`;
    }
    if (loginSecondaryMessage) {
      loginSecondaryMessage.textContent = `ส่งรหัสรีเซ็ตไปที่ ${requestedEmail} แล้ว`;
    }

    // Demo-only email delivery notice (no backend email service connected).
    alert(`ส่งรหัสรีเซ็ตไปที่ ${requestedEmail} แล้ว\nรหัสของคุณคือ: ${resetCode} (demo)`);
    if (forgotModal) {
      forgotModal.classList.add('is-hidden');
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    if (statusMessage) {
      statusMessage.textContent = '';
    }
    prefillLoginFromSavedAccount();
    if (loginPasswordInput) {
      loginPasswordInput.type = 'password';
    }
    if (loginPasswordToggle) {
      loginPasswordToggle.textContent = 'Show';
      loginPasswordToggle.setAttribute('aria-label', 'Show password');
    }
    if (loginSecondaryMessage) {
      loginSecondaryMessage.textContent = '';
    }
    showView('login');
  });
}

if (createGroupButton) {
  createGroupButton.addEventListener('click', () => {
    setGroupFormMode('create');
    joinMessage.textContent = '';
    joinForm.reset();
    showView('join');
    joinGroupIdInput.focus();
  });
}

calendarButton.addEventListener('click', () => {
  previousViewBeforeCalendar = currentView;
  renderCalendar();
  showView('calendar');
});

joinGroupButton.addEventListener('click', () => {
  setGroupFormMode('join');
  joinMessage.textContent = '';
  joinForm.reset();
  showView('join');
  joinGroupIdInput.focus();
});

notesButton.addEventListener('click', () => {
  previousViewBeforeNotes = currentView;
  renderNotes();
  showView('notes');
});

groupList.addEventListener('click', (event) => {
  const groupButton = event.target.closest('.group-link');
  if (!groupButton) {
    return;
  }

  setChatView(groupButton.dataset.groupName, groupButton.dataset.groupId);
});

const leaveGroupButton = document.querySelector('#leave-group-btn');
leaveGroupButton.addEventListener('click', () => {
  const activeGroupId = getActiveGroupId();
  const groupButton = findGroupButtonById(activeGroupId);
  if (groupButton) {
    const li = groupButton.closest('li');
    if (li) {
      li.remove();
    }
  }
  saveAppState();
  setHomeView();
});

backButton.addEventListener('click', () => {
  if (currentView === 'calendar') {
    showView(previousViewBeforeCalendar === 'home' ? 'home' : previousViewBeforeCalendar);
    return;
  }

  if (currentView === 'notes') {
    showView(previousViewBeforeNotes === 'home' ? 'home' : previousViewBeforeNotes);
    return;
  }

  setHomeView();
});

copyGroupIdButton.addEventListener('click', () => {
  copyText(chatGroupId.textContent.trim());
});

copyGroupIdButton.addEventListener('keydown', (event) => {
  activateOnKeyboard(event, () => copyGroupIdButton.click());
});

const membersModal = document.querySelector('#members-modal');
const membersModalClose = document.querySelector('#members-modal-close');
const membersModalList = document.querySelector('#members-modal-list');

function openMembersModal() {
  const groupId = getActiveGroupId();
  const list = ensureGroupMembers(groupId);

  membersModalList.innerHTML = '';

  if (list.length === 0) {
    const empty = document.createElement('li');
    empty.style.color = '#999';
    empty.style.padding = '16px 20px';
    empty.textContent = 'No members yet.';
    membersModalList.appendChild(empty);
  } else {
    list.forEach((member) => {
      const li = document.createElement('li');

      const avatar = document.createElement('span');
      avatar.className = 'member-avatar';
      avatar.textContent = member.name.charAt(0).toUpperCase();

      const name = document.createElement('span');
      name.className = 'member-name';
      name.textContent = member.name;

      const id = document.createElement('span');
      id.className = 'member-id';
      id.textContent = member.id;

      li.append(avatar, name, id);
      membersModalList.appendChild(li);
    });
  }

  membersModal.classList.remove('is-hidden');
}

function closeMembersModal() {
  membersModal.classList.add('is-hidden');
}

membersButton.addEventListener('click', openMembersModal);

membersModalClose.addEventListener('click', closeMembersModal);

membersModal.addEventListener('click', (event) => {
  if (event.target === membersModal) {
    closeMembersModal();
  }
});

addMemberForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const memberIdInput = document.querySelector('#member-id-input');
  const memberNameInput = document.querySelector('#member-name-input');
  const memberId = memberIdInput.value.trim();
  const memberName = memberNameInput.value.trim();

  if (memberId && memberName) {
    const groupId = getActiveGroupId();
    addMemberToGroup(groupId, memberId, memberName);

    const groupBtn = findGroupButtonById(groupId);
    if (groupBtn) {
      const memberList = groupMembers.get(groupId);
      const count = memberList.length;
      groupBtn.dataset.members = `${count} member${count !== 1 ? 's' : ''}`;
      const membersSpan = groupBtn.querySelector('.group-members');
      if (membersSpan) {
        membersSpan.textContent = groupBtn.dataset.members;
      }
    }
  }

  addMemberForm.reset();
  saveAppState();
});

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const text = chatInput.value.trim();
  if (!text) {
    return;
  }

  addOutgoingMessage(text);
  messageForm.reset();
  chatInput.focus();
});

chatInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  messageForm.requestSubmit();
});

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const requestedId = joinGroupIdInput.value.trim();
  if (!requestedId) {
    return;
  }

  if (groupFormMode === 'create') {
    const newGroupId = getUniqueGroupId(requestedId);
    registerGroupId(newGroupId);
    const groupName = newGroupId;
    addGroupListItem(groupName, newGroupId, '1 members');

    if (newGroupId !== requestedId) {
      joinMessage.textContent = `Group ID ${requestedId} already exists. Created ${newGroupId} instead.`;
    } else {
      joinMessage.textContent = `Created group ${newGroupId} (demo).`;
    }

    saveAppState();
    setChatView(groupName, newGroupId);
    return;
  }

  const existingGroup = findGroupButtonById(requestedId);
  if (existingGroup) {
    joinMessage.textContent = `Joined group ${requestedId} (demo).`;
    setChatView(existingGroup.dataset.groupName, existingGroup.dataset.groupId);
    return;
  }

  const newJoinId = getUniqueGroupId(requestedId);
  registerGroupId(newJoinId);
  const joinedGroup = addGroupListItem(newJoinId, newJoinId, '1 members');

  if (newJoinId !== requestedId) {
    joinMessage.textContent = `Group ID ${requestedId} already exists. Joined ${newJoinId} instead.`;
  } else {
    joinMessage.textContent = `Joined group ${newJoinId} (demo).`;
  }

  saveAppState();
  setChatView(joinedGroup.dataset.groupName, joinedGroup.dataset.groupId);
});

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'c') {
    return;
  }

  if (currentView === 'login') {
    loginCopyIdButton.click();
    return;
  }

  if (currentView === 'home') {
    if (copyIdButton) {
      copyIdButton.click();
    }
    return;
  }

  if (currentView === 'chat') {
    copyGroupIdButton.click();
  }
});

document.querySelectorAll('.chat-bubble').forEach((bubble) => {
  attachBubbleReactions(bubble);
  attachBubbleSwipe(bubble);
});

document.addEventListener('pointerdown', (event) => {
  if (!activeSwipeItem) {
    if (activeListSwipeItem && !activeListSwipeItem.contains(event.target)) {
      closeListSwipeItem(activeListSwipeItem);
    }
    return;
  }

  if (activeSwipeItem.contains(event.target)) {
    if (activeListSwipeItem && !activeListSwipeItem.contains(event.target)) {
      closeListSwipeItem(activeListSwipeItem);
    }
    return;
  }

  closeSwipeItem(activeSwipeItem);

  if (activeListSwipeItem && !activeListSwipeItem.contains(event.target)) {
    closeListSwipeItem(activeListSwipeItem);
  }
});

initializeUniqueGroupIds();
setCurrentGroup(chatGroupName.textContent.trim());
setupRealtimePersistence();

async function bootstrapAppState() {
  if (isDatabaseConfigured()) {
    const remoteState = await pullRemoteState();
    if (remoteState) {
      try {
        localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(remoteState));
      } catch {
        // Keep local flow even when storage write fails.
      }
    }
  }

  loadAppState();
  updateSignupAvailability();
  syncVisibleMessagesForCurrentGroup();
  renderNotes();
  renderCalendar();
  setGroupFormMode('join');
}

void bootstrapAppState();

window.addEventListener('storage', (event) => {
  if (event.key !== APP_STORAGE_KEY) {
    return;
  }
  loadAppState();
});

showView('login');
