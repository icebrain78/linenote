import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getAuth, signInAnonymously, type Auth, type User } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getValue, type RemoteConfig } from 'firebase/remote-config';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let remoteConfig: RemoteConfig | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);

  // Enable App Check debug token in development
  if (import.meta.env.DEV) {
    const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken && debugToken !== 'true' ? debugToken : true;
  }

  const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (recaptchaSiteKey) {
    try {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn('App Check initialization warning:', err);
    }
  }

  auth = getAuth(app);

  // Offline-capable Firestore with persistent local cache (M4)
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });

  remoteConfig = getRemoteConfig(app);
  remoteConfig.settings.minimumFetchIntervalMillis = 60_000;
  remoteConfig.defaultConfig = {
    sensitive_patterns: JSON.stringify([
      '\\b[A-Z]{2}-\\d{3,5}\\b', // Drawing numbers like EN-2231
      '(₩|\\$|KRW|USD)\\s?\\d[\\d,.]*', // Unit prices
      '\\bCUST-[A-Z0-9]{2,8}\\b', // Customer codes
    ]),
    customer_names: JSON.stringify([
      'ACME-77',
      'ACME Corp',
      'Apex Enclosure',
      'Nordic Rack',
      'Kestrel Power',
    ]),
    structurer_mode: 'prefer_on_device',
    cloud_model: 'gemini-3.5-flash-lite',
  };
}

export { app, appCheck, auth, db, remoteConfig };

export async function ensureAnonymousAuth(): Promise<User | null> {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (err) {
    console.warn('Anonymous auth failed (offline or config issue):', err);
    return null;
  }
}

export interface RemotePolicyConfig {
  sensitivePatterns: string[];
  customerNames: string[];
  structurerMode: string;
  cloudModel: string;
}

const DEFAULT_POLICY: RemotePolicyConfig = {
  sensitivePatterns: [
    '\\b[A-Z]{2}-\\d{3,5}\\b',
    '(₩|\\$|KRW|USD)\\s?\\d[\\d,.]*',
    '\\bCUST-[A-Z0-9]{2,8}\\b',
  ],
  customerNames: ['ACME-77', 'ACME Corp', 'Apex Enclosure', 'Nordic Rack', 'Kestrel Power'],
  structurerMode: 'prefer_on_device',
  cloudModel: 'gemini-3.5-flash-lite',
};

let cachedPolicy: RemotePolicyConfig = { ...DEFAULT_POLICY };

export async function refreshRemotePolicy(): Promise<RemotePolicyConfig> {
  if (!remoteConfig) return cachedPolicy;
  try {
    await fetchAndActivate(remoteConfig);
    const patternsRaw = getValue(remoteConfig, 'sensitive_patterns').asString();
    const customersRaw = getValue(remoteConfig, 'customer_names').asString();
    const structurerMode = getValue(remoteConfig, 'structurer_mode').asString() || DEFAULT_POLICY.structurerMode;
    const cloudModel = getValue(remoteConfig, 'cloud_model').asString() || DEFAULT_POLICY.cloudModel;

    cachedPolicy = {
      sensitivePatterns: JSON.parse(patternsRaw || '[]'),
      customerNames: JSON.parse(customersRaw || '[]'),
      structurerMode,
      cloudModel,
    };
  } catch (err) {
    console.warn('Remote Config fetch failed, using defaults:', err);
  }
  return cachedPolicy;
}

export function getRemotePolicy(): RemotePolicyConfig {
  return cachedPolicy;
}
