"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  auth,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  sendResetEmail,
  syncWorkspaceUnitContext,
} from "@/lib/firebase";
import { useFirebaseAuthSession } from "@/lib/firebase/useAuthSession";
import { useWorkspaceUnit } from "@/lib/useWorkspaceUnit";
import { WORKSPACE_UNIT_OPTIONS } from "@/lib/workspace";
import { AuthPanel } from "@/components/SSTEpiFirebaseMVPImpl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

const brandLogoUrl = "/brand-logo.png";

export default function FirebaseLoginScreen() {
  const router = useRouter();
  const { authUser, authReady } = useFirebaseAuthSession();
  const { workspaceUnit, setWorkspaceUnit } = useWorkspaceUnit();
  const [message, setMessage] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    displayName: "",
    email: "",
    password: "",
    resetEmail: "",
  });

  const notify = (title, description, kind = "success") => {
    setMessage({ title, description, kind });
    setTimeout(() => setMessage(null), 3000);
  };

  const notifyError = (title, error, description) => {
    console.error(title, error);
    notify(title, description, "error");
  };

  useEffect(() => {
    if (authReady && authUser) {
      router.replace("/");
    }
  }, [authReady, authUser, router]);

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthBusy(true);

    try {
      if (authMode === "login" || authMode === "register" || authMode === "reset") {
        setWorkspaceUnit(workspaceUnit.workspaceUnitId);
      }

      if (authMode === "login") {
        await loginWithEmail(authForm.email, authForm.password);
        await syncWorkspaceUnitContext({
          workspaceUnitId: workspaceUnit.workspaceUnitId,
          workspaceUnitName: workspaceUnit.workspaceUnitName,
        });
        await auth.currentUser?.getIdToken(true);
        notify("Sessão iniciada", "Login com email e senha concluído.");
        return;
      }

      if (authMode === "register") {
        await registerWithEmail(authForm.email, authForm.password, {
          displayName: authForm.displayName,
        });
        await syncWorkspaceUnitContext({
          workspaceUnitId: workspaceUnit.workspaceUnitId,
          workspaceUnitName: workspaceUnit.workspaceUnitName,
        });
        await auth.currentUser?.getIdToken(true);
        notify("Conta criada", "Seu usuário foi registrado no Firebase Auth.");
        setAuthMode("login");
        return;
      }

      const targetEmail = authForm.resetEmail || authForm.email;
      await sendResetEmail(targetEmail);
      notify("Email enviado", "Verifique a caixa de entrada para redefinir a senha.");
    } catch (error) {
      notifyError("Falha na autenticação", error, "Verifique as credenciais e o provedor habilitado.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthBusy(true);
    try {
      await loginWithGoogle();
      await syncWorkspaceUnitContext({
        workspaceUnitId: workspaceUnit.workspaceUnitId,
        workspaceUnitName: workspaceUnit.workspaceUnitName,
      });
      await auth.currentUser?.getIdToken(true);
      notify("Sessão iniciada", "Login com Google concluído.");
    } catch (error) {
      notifyError("Falha no login Google", error, "Verifique se o provedor Google está habilitado.");
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-3xl border bg-white p-5 shadow-sm sm:flex-row sm:items-center">
          <div className="flex h-[76px] w-[124px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-slate-50 shadow-sm">
            <img
              src={brandLogoUrl}
              alt="Logo do Sistema SST"
              className="h-full w-full object-contain"
              loading="eager"
            />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Sistema SST • EPI</p>
            <h1 className="text-2xl font-semibold tracking-tight">Acesso ao painel</h1>
            <p className="text-sm text-muted-foreground">Entre com Firebase Auth para continuar.</p>
          </div>
        </div>

        {message && (
          <Alert className={message.kind === "error" ? "rounded-2xl border-red-300" : "rounded-2xl border-green-300"}>
            {message.kind === "error" ? <TriangleAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        )}

        {!authReady ? (
          <Alert className="rounded-2xl border-blue-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Verificando sessão</AlertTitle>
            <AlertDescription>Aguarde enquanto o Firebase Auth responde.</AlertDescription>
          </Alert>
        ) : authUser ? (
          <Alert className="rounded-2xl border-blue-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Redirecionando</AlertTitle>
            <AlertDescription>Você já está autenticado. Vamos abrir o dashboard.</AlertDescription>
          </Alert>
        ) : (
          <>
            <Card className="rounded-3xl border-slate-200 shadow-sm">
              <CardContent className="space-y-3 p-6">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recorte da sessão</p>
                  <h2 className="text-lg font-semibold tracking-tight">Escolha a filial antes de entrar</h2>
                  <p className="text-sm text-muted-foreground">
                    O painel vai carregar somente os EPIs, entregas e relatórios desta filial.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-unit">Filial</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {WORKSPACE_UNIT_OPTIONS.map((unit) => {
                      const isActive = workspaceUnit.workspaceUnitId === unit.value;

                      return (
                        <Button
                          key={unit.value}
                          type="button"
                          variant={isActive ? "default" : "outline"}
                          onClick={() => setWorkspaceUnit(unit.value)}
                          className="h-auto justify-start rounded-2xl px-4 py-3 text-left"
                          aria-pressed={isActive}
                          disabled={authBusy}
                        >
                          <span className="flex flex-col items-start">
                            <span className="text-sm font-semibold">{unit.label}</span>
                            <span className={isActive ? "text-xs text-primary-foreground/80" : "text-xs text-muted-foreground"}>
                              {unit.value}
                            </span>
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
            <AuthPanel
              authMode={authMode}
              authBusy={authBusy}
              authForm={authForm}
              setAuthForm={setAuthForm}
              setAuthMode={setAuthMode}
              onSubmit={handleAuthSubmit}
              onGoogleLogin={handleGoogleLogin}
            />
            <div className="flex justify-end">
              <Link
                href="/colaborador"
                className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline"
              >
                Acesso do colaborador
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
