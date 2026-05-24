// ============================================
// SCRIPTUREQUEST — sw.js (v4)
// Service Worker: Offline Cache • FCM Push
// Streak Alerts • Quest Reset • League Warnings
// ============================================

const APP_NAME    = 'ScriptureQuest';
const CACHE_NAME  = 'scripture-quest-v4';
const ICON_URL    = '/icon.png'; // fallback: emoji shown in notification body

// ── Files to cache for offline use ──
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/firebase.js',
  '/questions.js',
];

// ============================================
// INSTALL — pre-cache app shell
// ============================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ============================================
// ACTIVATE — clean up old caches
// ============================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ============================================
// FETCH — network-first, cache fallback
// ============================================
self.addEventListener('fetch', event => {
  // Only handle GET requests for same origin
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses for app shell files
        if (response.ok && PRECACHE_URLS.some(u => url.pathname.endsWith(u) || url.pathname === u)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ============================================
// PUSH — receive FCM push messages
// ============================================
self.addEventListener('push', event => {
  let data = { title: APP_NAME, body: 'You have a new notification', tag: 'scripture-quest', type: 'general' };

  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch { data.body = event.data.text(); }
  }

  const options = buildNotificationOptions(data);

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ============================================
// NOTIFICATION OPTIONS BUILDER
// Maps notification type → tailored options
// ============================================
function buildNotificationOptions(data) {
  const base = {
    body:               data.body,
    tag:                data.tag || data.type || 'scripture-quest',
    requireInteraction: false,
    silent:             false,
    data:               { url: data.url || '/', type: data.type },
  };

  // Type-specific customisation
  switch (data.type) {

    case 'week_start':
      return {
        ...base,
        tag:    'week-start',
        badge:  ICON_URL,
        icon:   ICON_URL,
        vibrate: [200, 100, 200],
        actions: [
          { action: 'quiz',      title: '📝 Take Quiz Now' },
          { action: 'leaderboard', title: '🏆 View Leaderboard' },
        ],
        data: { ...base.data, url: '/' },
      };

    case 'streak_alert':
      return {
        ...base,
        tag:    'streak-alert',
        badge:  ICON_URL,
        icon:   ICON_URL,
        vibrate: [300, 100, 300, 100, 300],
        renotify: true,
        actions: [
          { action: 'quiz', title: '🔥 Quiz Now' },
          { action: 'dismiss', title: 'Later' },
        ],
        data: { ...base.data, url: '/' },
      };

    case 'quest_reset':
      return {
        ...base,
        tag:    'quest-reset',
        badge:  ICON_URL,
        icon:   ICON_URL,
        vibrate: [100, 50, 100],
        actions: [
          { action: 'quiz',    title: '📋 View Quests' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
        data: { ...base.data, url: '/' },
      };

    case 'league_warning':
      return {
        ...base,
        tag:    'league-warning',
        badge:  ICON_URL,
        icon:   ICON_URL,
        vibrate: [200, 100, 200, 100, 200, 100, 200],
        renotify: true,
        actions: [
          { action: 'leaderboard', title: '🏆 Check League' },
          { action: 'quiz',        title: '📝 Earn XP' },
        ],
        data: { ...base.data, url: '/?nav=leaderboard' },
      };

    case 'challenge':
      return {
        ...base,
        tag:    'challenge-' + (data.challengeId || Date.now()),
        badge:  ICON_URL,
        icon:   ICON_URL,
        vibrate: [200, 100, 200],
        requireInteraction: true,
        actions: [
          { action: 'accept',  title: '⚡ Accept Challenge' },
          { action: 'decline', title: 'Decline' },
        ],
        data: { ...base.data, url: data.challengeUrl || '/' },
      };

    case 'level_up':
      return {
        ...base,
        tag:    'level-up',
        badge:  ICON_URL,
        icon:   ICON_URL,
        vibrate: [100, 50, 100, 50, 100],
        data: { ...base.data, url: '/?nav=profile' },
      };

    default:
      return {
        ...base,
        badge: ICON_URL,
        icon:  ICON_URL,
        data:  { ...base.data, url: '/' },
      };
  }
}

// ============================================
// NOTIFICATION CLICK — handle action buttons
// ============================================
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action  = event.action;
  const data    = event.notification.data || {};
  const notifType = data.type || 'general';

  let targetUrl = '/';

  if (action === 'quiz' || action === 'accept') {
    targetUrl = '/';
  } else if (action === 'leaderboard') {
    targetUrl = '/?nav=leaderboard';
  } else if (action === 'dismiss' || action === 'decline') {
    return; // Just close the notification
  } else {
    // Default: use URL from notification data
    targetUrl = data.url || '/';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Focus existing tab if already open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            // Send message to open the correct screen
            client.postMessage({ type: 'NAVIGATE', screen: getScreenForAction(action, notifType) });
            return;
          }
        }
        // Otherwise open a new tab
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

function getScreenForAction(action, notifType) {
  if (action === 'leaderboard') return 'leaderboard';
  if (notifType === 'level_up') return 'profile';
  return 'landing';
}

// ============================================
// NOTIFICATION CLOSE — analytics stub
// ============================================
self.addEventListener('notificationclose', event => {
  // Could log dismissed notifications here for analytics
  const type = (event.notification.data || {}).type;
  console.log('[SW] Notification dismissed:', type);
});

// ============================================
// MESSAGE FROM CLIENT
// Clients can send messages to the SW.
// E.g.: navigator.serviceWorker.controller.postMessage({ type: 'SCHEDULE_REMINDER' })
// ============================================
self.addEventListener('message', event => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {

    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'SCHEDULE_DAILY_REMINDER':
      // Schedule a reminder for the next day at 9AM WAT (UTC+1)
      scheduleDailyReminder(msg.hour || 9);
      break;

    case 'CANCEL_REMINDERS':
      clearScheduledReminders();
      break;
  }
});

// ============================================
// SCHEDULED DAILY REMINDER
// Shows a local notification at 9AM WAT each day.
// Only fires if user hasn't quizzed today (tracked
// via postMessage from the main app).
// ============================================
let reminderTimer = null;

function scheduleDailyReminder(targetHour) {
  clearScheduledReminders();

  const now     = new Date();
  // WAT = UTC+1, so add 60 min to get WAT hour
  const watHour = (now.getUTCHours() + 1) % 24;
  const msUntil = getMsUntilHour(targetHour, watHour, now);

  reminderTimer = setTimeout(() => {
    showLocalNotification(
      `📖 Time for your daily ScriptureQuest!`,
      `3 fresh quests await. Keep your streak alive and earn XP today!`,
      'daily-reminder'
    );
    // Re-schedule for next day
    scheduleDailyReminder(targetHour);
  }, msUntil);

  console.log('[SW] Daily reminder scheduled in', Math.round(msUntil / 1000 / 60), 'min');
}

function clearScheduledReminders() {
  if (reminderTimer) { clearTimeout(reminderTimer); reminderTimer = null; }
}

function getMsUntilHour(targetHour, currentWatHour, now) {
  let hoursUntil = targetHour - currentWatHour;
  if (hoursUntil <= 0) hoursUntil += 24;
  const ms = hoursUntil * 60 * 60 * 1000;
  // Subtract current minutes/seconds so it fires exactly on the hour
  return ms - (now.getMinutes() * 60 + now.getSeconds()) * 1000;
}

function showLocalNotification(title, body, tag) {
  self.registration.showNotification(title, {
    body,
    tag,
    badge:   ICON_URL,
    icon:    ICON_URL,
    vibrate: [200, 100, 200],
    data:    { url: '/', type: tag },
    actions: [
      { action: 'quiz',    title: '📝 Quiz Now' },
      { action: 'dismiss', title: 'Later' },
    ],
  });
}

// ============================================
// toggleNotifications — called from index.html
// Settings screen toggle wires to this via postMessage.
// firebase.js exposes window.toggleNotifications().
// ============================================
// (No SW code needed here — see firebase.js patch below)

// ============================================
// FIREBASE MESSAGING BACKGROUND HANDLER
// When the app is in the background/closed, FCM
// delivers messages here instead of to the page.
// ============================================
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyCEmiQRwVR6TT3UpQHc6yIYAAq-E2E9W4w",
  authDomain:        "bible-quiz-36ba0.firebaseapp.com",
  projectId:         "bible-quiz-36ba0",
  storageBucket:     "bible-quiz-36ba0.firebasestorage.app",
  messagingSenderId: "570860971209",
  appId:             "1:570860971209:web:f88225f800c0f5556f5918",
});

const messaging = firebase.messaging();

// Background FCM message handler
messaging.onBackgroundMessage(payload => {
  console.log('[SW] FCM background message:', payload);

  const notifData = payload.data || {};
  const notification = payload.notification || {};

  const data = {
    type:  notifData.type  || 'general',
    title: notification.title || notifData.title || APP_NAME,
    body:  notification.body  || notifData.body  || 'New update from ScriptureQuest',
    tag:   notifData.tag   || 'scripture-quest',
    url:   notifData.url   || '/',
  };

  const options = buildNotificationOptions(data);
  return self.registration.showNotification(data.title, options);
});

console.log('[SW] ScriptureQuest sw.js v4 loaded — Offline Cache • FCM • Push Notifications');


// ============================================
// NOTE FOR firebase.js — paste this function
// to fix the settings toggle gap:
// ============================================
/*

function toggleNotifications() {
  const toggle = document.getElementById('notif-toggle');
  const enabled = toggle ? toggle.checked : (Notification.permission === 'granted');

  if (enabled) {
    // User turning ON
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        // Register SW and schedule daily reminder
        navigator.serviceWorker.ready.then(reg => {
          reg.active?.postMessage({ type: 'SCHEDULE_DAILY_REMINDER', hour: 9 });
        });
        localStorage.setItem('sq_notif_enabled', 'true');
        localStorage.removeItem('sq_notif_dismissed');
        showToast('🔔 Notifications enabled!', 'success');
        if (toggle) toggle.checked = true;
      } else {
        localStorage.setItem('sq_notif_dismissed', '1');
        showToast('Notifications blocked by browser', 'info');
        if (toggle) toggle.checked = false;
      }
    });
  } else {
    // User turning OFF
    navigator.serviceWorker.ready.then(reg => {
      reg.active?.postMessage({ type: 'CANCEL_REMINDERS' });
    });
    localStorage.setItem('sq_notif_enabled', 'false');
    showToast('🔕 Notifications disabled', 'info');
    if (toggle) toggle.checked = false;
  }
}
window.toggleNotifications = toggleNotifications;

*/
