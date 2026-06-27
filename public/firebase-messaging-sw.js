importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyDh9hKzCOCMf6UoaVsZAVIYkxWWUXEqLOY',
  authDomain:        'rippleapp-76301.firebaseapp.com',
  projectId:         'rippleapp-76301',
  storageBucket:     'rippleapp-76301.firebasestorage.app',
  messagingSenderId: '112083005374',
  appId:             '1:112083005374:web:e818087747301542d793ef',
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
