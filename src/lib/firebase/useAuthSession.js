"use client";

import { useEffect, useState } from "react";
import { auth, onAuthStateChanged } from "@/lib/firebase";

export function useFirebaseAuthSession() {
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
    });

    return unsubscribe;
  }, []);

  return { authUser, authReady };
}
