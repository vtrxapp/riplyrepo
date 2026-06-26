importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

// These values are injected at build time via the service worker config.
// They must match your Firebase project exactly.
firebase.initializeApp({
  apiKey:            self.VITE_FIREBASE_API_KEY            || '__FIREBASE_API_KEY__',
  authDomain:        self.VITE_FIREBASE_AUTH_DOMAIN        || '__FIREBASE_AUTH_DOMAIN__',
  projectId:         self.VITE_FIREBASE_PROJECT_ID         || '__FIREBASE_PROJECT_ID__',
  storageBucket:     self.VITE_FIREBASE_STORAGE_BUCKET     || '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: self.VITE_FIREBASE_MESSAGING_SENDER_ID|| '__FIREBASE_MESSAGING_SENDER_ID__',
  appId:             self.VITE_FIREBASE_APP_ID             || '__FIREBASE_APP_ID__',
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
