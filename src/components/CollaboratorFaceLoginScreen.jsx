"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import {
  Camera,
  CheckCircle2,
  Loader2,
  LogOut,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { playFaceRecognitionSound } from "@/lib/audio";
import {
  getCameraStreamConstraints,
  listVideoInputDevices,
  resolvePreferredCameraId,
  stopCameraStream,
} from "@/lib/camera";
import {
  collaboratorAuth,
  collaboratorFunctions,
  loginCollaboratorAnonymously,
  loginCollaboratorWithCustomToken,
  logoutCollaborator,
  onAuthStateChanged,
  loadWorkspaceData,
} from "@/lib/firebase";
import { useWorkspaceUnit } from "@/lib/useWorkspaceUnit";
import {
  WORKSPACE_UNIT_OPTIONS,
  normalizeWorkspaceUnitId,
  normalizeWorkspaceUnitName,
} from "@/lib/workspace";
import {
  buildFaceVerificationBadge,
  detectFaceMatchFromSource,
  ensureFaceModelsLoaded,
  FACE_MATCH_THRESHOLD,
} from "@/lib/face/faceService";

const brandLogoUrl = "/brand-logo.png";
const mintCollaboratorFaceToken = httpsCallable(collaboratorFunctions, "mintCollaboratorFaceToken");

function getEmployeeFaceCount(employee) {
  if (!employee) return 0;
  if (Array.isArray(employee.faceDescriptors)) {
    return employee.faceDescriptors.length;
  }
  if (Array.isArray(employee.faceDescriptor)) {
    return employee.faceDescriptor.length ? 1 : 0;
  }
  return Number(employee.faceEnrollmentCount || 0);
}

async function loadCollaboratorEmployees(workspaceUnit) {
  const result = await loadWorkspaceData({
    workspaceUnitId: workspaceUnit.workspaceUnitId,
    workspaceUnitName: workspaceUnit.workspaceUnitName,
    collections: ["employees"],
  });

  const employees = result?.data?.collections?.employees || [];

  return employees.map((employee) => {
    const faceDescriptors = Array.isArray(employee.faceDescriptors)
      ? employee.faceDescriptors
      : Array.isArray(employee.faceDescriptor)
        ? employee.faceDescriptor
        : [];

    return {
      ...employee,
      faceDescriptors,
      faceEnrollmentCount: Number(employee.faceEnrollmentCount || faceDescriptors.length || 0),
    };
  });
}

export default function CollaboratorFaceLoginScreen() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const { workspaceUnit, workspaceUnitLoaded, setWorkspaceUnit } = useWorkspaceUnit();

  const [authReady, setAuthReady] = useState(false);
  const [authBootstrapBusy, setAuthBootstrapBusy] = useState(true);
  const [sessionUser, setSessionUser] = useState(null);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [cameraBusy, setCameraBusy] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Preparando a câmera e carregando o cadastro facial.");
  const [errorMessage, setErrorMessage] = useState("");
  const [message, setMessage] = useState(null);
  const [recognizedEmployee, setRecognizedEmployee] = useState(null);
  const [badgeDataUrl, setBadgeDataUrl] = useState("");
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraDevicesLoaded, setCameraDevicesLoaded] = useState(false);

  const activeEmployees = useMemo(
    () =>
      employees.filter((employee) => {
        const workspaceUnitName = normalizeWorkspaceUnitName(
          employee.workspaceUnitName || employee.unitName || employee.branchName || workspaceUnit.workspaceUnitName
        );
        const workspaceUnitId = normalizeWorkspaceUnitId(
          employee.workspaceUnitId || employee.unitId || employee.branchId || workspaceUnitName
        );

        return workspaceUnitId === workspaceUnit.workspaceUnitId;
      }),
    [employees, workspaceUnit.workspaceUnitId, workspaceUnit.workspaceUnitName]
  );

  const enrolledEmployees = useMemo(
    () => activeEmployees.filter((employee) => getEmployeeFaceCount(employee) > 0),
    [activeEmployees]
  );

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(collaboratorAuth, (user) => {
      if (!isMounted) return;
      setSessionUser(user);
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrapAnonymousSession = async () => {
      if (collaboratorAuth.currentUser) {
        setAuthBootstrapBusy(false);
        return;
      }

      setAuthBootstrapBusy(true);
      try {
        await loginCollaboratorAnonymously();
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error?.message || "Não foi possível preparar a sessão facial.");
        }
      } finally {
        if (!cancelled) {
          setAuthBootstrapBusy(false);
        }
      }
    };

    void bootstrapAnonymousSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authReady || !workspaceUnitLoaded) {
      return;
    }

    let cancelled = false;

    const loadEmployees = async () => {
      setCatalogBusy(true);
      setEmployees([]);

      try {
        const catalog = await loadCollaboratorEmployees(workspaceUnit);
        if (!cancelled) {
          setEmployees(catalog);
          if (catalog.length) {
            setStatusMessage("Cadastro facial carregado. Posicione o rosto para validar.");
            setErrorMessage("");
          } else {
            setStatusMessage("Nenhum colaborador cadastrado nesta filial.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error?.message ||
              "Não foi possível ler a lista de colaboradores da filial. Verifique as permissões do Firebase."
          );
          setStatusMessage("Falha ao carregar colaboradores cadastrados.");
          setEmployees([]);
        }
      } finally {
        if (!cancelled) {
          setCatalogBusy(false);
        }
      }
    };

    void loadEmployees();

    return () => {
      cancelled = true;
    };
  }, [authReady, sessionUser?.uid, workspaceUnit.workspaceUnitId, workspaceUnit.workspaceUnitName, workspaceUnitLoaded]);

  const handleWorkspaceUnitChange = (value) => {
    const nextWorkspaceUnit = setWorkspaceUnit(value);
    setRecognizedEmployee(null);
    setBadgeDataUrl("");
    setErrorMessage("");
    setStatusMessage(`Unidade alterada para ${nextWorkspaceUnit.workspaceUnitName}.`);
    setMessage(null);
  };

  useEffect(() => {
    let cancelled = false;

    const loadCameraDevices = async () => {
      const devices = await listVideoInputDevices().catch(() => []);
      if (cancelled) return;
      setCameraDevices(devices);
      setSelectedCameraId((currentCameraId) => resolvePreferredCameraId(currentCameraId, devices));
      setCameraDevicesLoaded(true);
    };

    setCameraDevicesLoaded(false);
    void loadCameraDevices();

    const handleDeviceChange = () => {
      void loadCameraDevices();
    };

    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("A câmera não está disponível neste navegador.");
        }

        setCameraBusy(true);
        setCameraReady(false);

        const stream = await navigator.mediaDevices.getUserMedia(getCameraStreamConstraints(selectedCameraId));

        if (cancelled) {
          stopCameraStream(stream);
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const devices = await listVideoInputDevices().catch(() => []);
        if (!cancelled) {
          setCameraDevices(devices);
          setSelectedCameraId((currentCameraId) => resolvePreferredCameraId(currentCameraId, devices));
        }

        setCameraReady(true);
        setStatusMessage("Câmera pronta. Valide a face para autenticar o colaborador.");
        setErrorMessage("");
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error?.message || "Não foi possível abrir a câmera.");
          setStatusMessage("Permita o acesso à câmera para continuar.");
        }
      } finally {
        if (!cancelled) {
          setCameraBusy(false);
        }
      }
    };

    if (!cameraDevicesLoaded) {
      return undefined;
    }

    void startCamera();

    return () => {
      cancelled = true;
      stopCameraStream(streamRef.current);
      streamRef.current = null;
    };
  }, [cameraDevicesLoaded, selectedCameraId]);

  const handleCameraSelectionChange = (event) => {
    setSelectedCameraId(event.target.value);
    setErrorMessage("");
    setStatusMessage("Trocando para a câmera selecionada...");
    setMessage(null);
  };

  const handleVerifyFace = async () => {
    if (!cameraReady || verificationBusy || !enrolledEmployees.length) {
      return;
    }

    setVerificationBusy(true);
    setErrorMessage("");
    setMessage(null);
    setStatusMessage("Lendo o rosto e comparando com o cadastro...");

    try {
      await ensureFaceModelsLoaded();

      const { bestMatch, matchedEmployee, eligibleEmployeesCount } = await detectFaceMatchFromSource(
        videoRef.current,
        enrolledEmployees,
        FACE_MATCH_THRESHOLD
      );

      if (!matchedEmployee || bestMatch.label === "unknown") {
        throw new Error("Rosto não reconhecido. Tente novamente com a face bem centralizada.");
      }

      const tokenResponse = await mintCollaboratorFaceToken({
        employeeId: matchedEmployee.id,
        matchDistance: bestMatch.distance,
        verificationMethod: "face_kiosk",
        workspaceUnitId: workspaceUnit.workspaceUnitId,
        workspaceUnitName: workspaceUnit.workspaceUnitName,
      });

      const customToken = tokenResponse?.data?.customToken || tokenResponse?.data?.token;
      if (!customToken) {
        throw new Error("O Firebase não retornou o token facial.");
      }

      const credential = await loginCollaboratorWithCustomToken(customToken);
      if (!credential?.user?.uid) {
        throw new Error("Não foi possível finalizar a autenticação facial.");
      }

      const faceBadge = buildFaceVerificationBadge({
        employeeName: matchedEmployee.name,
        registration: matchedEmployee.registration,
        distance: bestMatch.distance,
        verifiedAt: new Date(),
      });

      void playFaceRecognitionSound();
      setRecognizedEmployee(matchedEmployee);
      setBadgeDataUrl(faceBadge);
      setMessage({
        kind: "success",
        title: "Colaborador autenticado",
        description: `${matchedEmployee.name} foi reconhecido com sucesso em ${eligibleEmployeesCount} cadastro(s) facial(is).`,
      });
      setStatusMessage("Sessão do colaborador ativada.");
    } catch (error) {
      setErrorMessage(error?.message || "Falha ao validar o rosto.");
      setStatusMessage("Tente novamente com a face enquadrada na câmera.");

      try {
        await logoutCollaborator();
        await loginCollaboratorAnonymously();
      } catch {
        // Ignora a limpeza da sessão anônima.
      }
    } finally {
      setVerificationBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutCollaborator();
      await loginCollaboratorAnonymously();
      setRecognizedEmployee(null);
      setBadgeDataUrl("");
      setMessage({
        kind: "success",
        title: "Sessão encerrada",
        description: "O acesso facial voltou para o modo de leitura inicial.",
      });
      setStatusMessage("Aguardando nova leitura facial.");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error?.message || "Não foi possível encerrar a sessão facial.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-4 md:px-6 md:py-6 xl:px-8 xl:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-3xl border bg-white p-4 shadow-sm md:p-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <div className="flex h-[68px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-slate-50 shadow-sm sm:h-[76px] sm:w-[124px]">
              <img
                src={brandLogoUrl}
                alt="Logo do Sistema SST"
                className="h-full w-full object-contain"
                loading="eager"
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Acesso do colaborador</p>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Reconhecimento facial</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Tela separada do painel administrativo para autenticar o colaborador pela câmera.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Badge variant={sessionUser?.isAnonymous ? "outline" : "secondary"} className="rounded-full px-3 py-1">
              {sessionUser?.isAnonymous ? "Sessão anônima" : "Sessão facial ativa"}
            </Badge>
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
            >
              Ir para painel admin
            </Link>
          </div>
        </div>

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="flex flex-col gap-4 p-5 md:p-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recorte da sessão</p>
              <h2 className="text-lg font-semibold tracking-tight">
                Unidade ativa: {workspaceUnit.workspaceUnitName}
              </h2>
              <p className="text-sm text-muted-foreground">
                A leitura facial vai procurar apenas colaboradores desta unidade.
              </p>
            </div>
            <div className="w-full space-y-2 xl:max-w-sm">
              <Label htmlFor="collaborator-workspace-unit">Filial</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {WORKSPACE_UNIT_OPTIONS.map((unit) => {
                  const isActive = workspaceUnit.workspaceUnitId === unit.value;

                  return (
                    <Button
                      key={unit.value}
                      type="button"
                      variant={isActive ? "default" : "outline"}
                      onClick={() => handleWorkspaceUnitChange(unit.value)}
                      className="h-auto justify-start rounded-2xl px-4 py-3 text-left"
                      aria-pressed={isActive}
                      disabled={verificationBusy || cameraBusy || !workspaceUnitLoaded}
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

        {message && (
          <Alert className={message.kind === "error" ? "rounded-2xl border-red-300" : "rounded-2xl border-green-300"}>
            {message.kind === "error" ? <TriangleAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        )}

        {(errorMessage || (!catalogBusy && !enrolledEmployees.length)) && (
          <Alert className="rounded-2xl border-amber-300">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>Validação facial</AlertTitle>
            <AlertDescription>{errorMessage || "Nenhum colaborador possui cadastro facial carregado."}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr),minmax(320px,0.85fr)]">
          <Card className="min-w-0 rounded-3xl shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                Leitura facial
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                A câmera fica neste painel e compara o rosto com o cadastro facial salvo no Firebase.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 rounded-2xl border bg-slate-50 p-3">
                <Label htmlFor="collaborator-face-camera">Selecionar câmera</Label>
                <select
                  id="collaborator-face-camera"
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none ring-offset-white focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedCameraId}
                  onChange={handleCameraSelectionChange}
                  disabled={verificationBusy || cameraBusy || !workspaceUnitLoaded}
                >
                  <option value="">Câmera padrão do navegador</option>
                  {cameraDevices.map((device) => (
                    <option key={device.deviceId || device.label} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Escolha a câmera integrada do computador ou uma webcam externa para a autenticação facial.
                </p>
              </div>

              <div className="rounded-2xl border bg-slate-950 p-3 text-white">
                <div className="relative overflow-hidden rounded-xl bg-black">
                  <video
                    ref={videoRef}
                    className="aspect-[4/3] w-full object-cover sm:aspect-video xl:aspect-[16/10] 2xl:aspect-video"
                    playsInline
                    muted
                    autoPlay
                  />
                  {recognizedEmployee ? (
                    <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-2xl border border-emerald-200 bg-emerald-500/92 px-4 py-3 text-white shadow-lg">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 shrink-0" />
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-50/90">
                            Face reconhecida
                          </p>
                          <p className="text-sm font-semibold">{recognizedEmployee.name}</p>
                          <p className="text-xs text-emerald-50/90">
                            {recognizedEmployee.registration || "Matrícula não informada"} • Sessão liberada
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    stopCameraStream(streamRef.current);
                    streamRef.current = null;
                    setCameraReady(false);
                    setStatusMessage("Câmera parada.");
                  }}
                  disabled={cameraBusy || verificationBusy}
                >
                  Parar câmera
                </Button>
                <Button
                  type="button"
                  onClick={handleVerifyFace}
                  disabled={verificationBusy || cameraBusy || !cameraReady || !enrolledEmployees.length}
                >
                  {verificationBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  Validar face
                </Button>
              </div>

              <Alert className={recognizedEmployee ? "rounded-2xl border-emerald-300 bg-emerald-50" : "rounded-2xl border-slate-200"}>
                <UserCheck className={recognizedEmployee ? "h-4 w-4 text-emerald-600" : "h-4 w-4"} />
                <AlertTitle>Status</AlertTitle>
                <AlertDescription>
                  {authBootstrapBusy
                    ? "Preparando sessão facial anônima."
                    : catalogBusy
                      ? "Carregando colaboradores com face cadastrada."
                      : statusMessage}
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-1">
            <Card className="min-w-0 rounded-3xl shadow-sm">
              <CardHeader>
                <CardTitle>Resumo da sessão</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border bg-slate-50 p-4">
                  <p className="text-sm text-muted-foreground">Cadastro facial disponível</p>
                  <p className="mt-1 text-2xl font-semibold">{enrolledEmployees.length}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Colaboradores prontos para comparação por câmera.
                  </p>
                </div>

                <div className="rounded-2xl border bg-slate-50 p-4">
                  <p className="text-sm text-muted-foreground">Autenticado como</p>
                  <p className="mt-1 font-semibold">
                    {recognizedEmployee?.name || sessionUser?.displayName || sessionUser?.email || "Aguardando leitura"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {recognizedEmployee?.registration || "Sessão ainda não validada por face"}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={handleLogout} disabled={authBootstrapBusy}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Encerrar sessão
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-3xl shadow-sm">
              <CardHeader>
                <CardTitle>Confirmação visual</CardTitle>
              </CardHeader>
              <CardContent>
                {badgeDataUrl ? (
                  <div className="overflow-hidden rounded-2xl border bg-white">
                    <img src={badgeDataUrl} alt="Comprovante de autenticação facial" className="w-full" />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed bg-slate-50 p-6 text-sm text-muted-foreground">
                    Depois da leitura facial, esta área mostra uma confirmação visual da autenticação.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-3xl shadow-sm md:col-span-2 xl:col-span-1">
              <CardHeader>
                <CardTitle>Colaboradores com face</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[220px] pr-3">
                  <div className="space-y-3">
                    {enrolledEmployees.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum colaborador com cadastro facial carregado.</p>
                    ) : (
                      enrolledEmployees.map((employee) => (
                        <div key={employee.id} className="rounded-2xl border p-3">
                          <p className="font-medium">{employee.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {employee.registration || "Sem matrícula"} • {employee.company || "Sem empresa"} •{" "}
                            {employee.lotacao || employee.sector || "Sem lotação"}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>

        {sessionUser && !sessionUser.isAnonymous && (
          <Alert className="rounded-2xl border-green-300">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Autenticação concluída</AlertTitle>
            <AlertDescription>
              O colaborador está autenticado neste navegador via custom token do Firebase.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
