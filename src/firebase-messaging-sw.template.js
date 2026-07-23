/* global firebase, clients */
// firebase and clients are service-worker globals provided by the
// importScripts() below and the browser's ServiceWorkerGlobalScope,
// respectively -- not undefined references.
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

// Values injected at build/dev time from VITE_FIREBASE_* env vars (see
// vite.config.js) rather than hardcoded here, so this file doesn't hold a
// literal copy of the config that goes stale if the key is ever rotated.
// Firebase's Web SDK apiKey is designed to be client-visible -- the actual
// access control is Firebase Security Rules plus the key's API/referrer
// restrictions in Google Cloud Console, not keeping this value secret.
firebase.initializeApp({
  apiKey:            '__VITE_FIREBASE_API_KEY__',
  authDomain:        '__VITE_FIREBASE_AUTH_DOMAIN__',
  projectId:         '__VITE_FIREBASE_PROJECT_ID__',
  storageBucket:     '__VITE_FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__VITE_FIREBASE_MESSAGING_SENDER_ID__',
  appId:             '__VITE_FIREBASE_APP_ID__',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'Riply', {
    body: body || '',
    icon: icon || '/logo.png',
    badge: '/logo.png',
    data: payload.data || {},
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
