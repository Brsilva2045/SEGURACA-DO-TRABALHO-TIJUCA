import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const fallbackFirebaseConfig = {
  apiKey: "AIzaSyCFhS53oA6tjkDgQXpkt9D-m_zgmjGF5cY",
  authDomain: "seguranca-do-trabalho-254f5.firebaseapp.com",
  projectId: "seguranca-do-trabalho-254f5",
  storageBucket: "seguranca-do-trabalho-254f5.firebasestorage.app",
  messagingSenderId: "1040903596383",
  appId: "1:1040903596383:web:3ae44c8b011687c39f6eea",
};

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || fallbackFirebaseConfig.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || fallbackFirebaseConfig.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || fallbackFirebaseConfig.projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || fallbackFirebaseConfig.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || fallbackFirebaseConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || fallbackFirebaseConfig.appId,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
const collaboratorAppName = "collaborator-face";
export const collaboratorFirebaseApp =
  getApps().find((app) => app.name === collaboratorAppName) || initializeApp(firebaseConfig, collaboratorAppName);
export const collaboratorAuth = getAuth(collaboratorFirebaseApp);
export const collaboratorDb = getFirestore(collaboratorFirebaseApp);
export const collaboratorFunctions = getFunctions(
  collaboratorFirebaseApp,
  process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "us-central1"
);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(
  firebaseApp,
  process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "us-central1"
);
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
