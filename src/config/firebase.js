// src/config/firebase.js
import admin from 'firebase-admin';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

let auth = null;
let messaging = null;
let isFirebaseAvailable = false;

try {
  // Dynamic import to avoid crashing when firebase-admin isn't installed
  const adminModule = (await import('firebase-admin')).default;
  const { getAuth } = await import('firebase-admin/auth');
  const { getMessaging } = await import('firebase-admin/messaging');

  // Build service account only if env vars are present
  const hasServiceAccount =
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_PRIVATE_KEY &&
    process.env.FIREBASE_CLIENT_EMAIL;

  let app;
  if (hasServiceAccount) {
    const serviceAccount = {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
    };

    try {
      app = adminModule.initializeApp({
        credential: adminModule.credential.cert(serviceAccount)
      });
      isFirebaseAvailable = true;
      console.info('Firebase Admin initialized with service account.');
    } catch (initErr) {
      console.warn('Failed to initialize Firebase Admin with service account. Attempting default initialization.', initErr?.message || initErr);
      try {
        app = adminModule.initializeApp();
        isFirebaseAvailable = true;
        console.info('Firebase Admin initialized with default credentials.');
      } catch (defaultErr) {
        console.warn('Default Firebase Admin initialization failed. Firebase features will be disabled.', defaultErr?.message || defaultErr);
      }
    }
  } else {
    // Try default initialization (e.g., when running on GCP or using ADC)
    try {
      app = adminModule.initializeApp();
      isFirebaseAvailable = true;
      console.info('Firebase Admin initialized with default credentials (no service account env vars).');
    } catch (err) {
      console.warn('Firebase environment variables not set and default initialization failed. Firebase features will be disabled.');
    }
  }

  if (app) {
    auth = getAuth(app);
    messaging = getMessaging(app);
  }
} catch (err) {
  // firebase-admin package missing or dynamic import failed
  console.warn('firebase-admin not available or failed to import. Firebase Auth & Messaging disabled.', err?.message || err);
}

export { auth, messaging, isFirebaseAvailable };