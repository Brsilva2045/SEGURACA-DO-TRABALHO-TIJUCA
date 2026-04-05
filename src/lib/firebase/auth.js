import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInAnonymously,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { auth, collaboratorAuth } from "./client";

export { auth, onAuthStateChanged };

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

export async function loginWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithEmail(email, password, profile = {}) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);

  if (profile.displayName || profile.photoURL) {
    await updateProfile(credential.user, {
      displayName: profile.displayName || credential.user.displayName || null,
      photoURL: profile.photoURL || credential.user.photoURL || null,
    });
  }

  return credential;
}

export async function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function logout() {
  return signOut(auth);
}

export async function loginCollaboratorWithCustomToken(customToken) {
  return signInWithCustomToken(collaboratorAuth, customToken);
}

export async function loginCollaboratorAnonymously() {
  return signInAnonymously(collaboratorAuth);
}

export async function logoutCollaborator() {
  return signOut(collaboratorAuth);
}

export async function sendResetEmail(email) {
  return sendPasswordResetEmail(auth, email);
}
