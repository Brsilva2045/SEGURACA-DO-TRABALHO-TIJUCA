"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, TriangleAlert, UserCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { playFaceRecognitionSound } from "@/lib/audio";
import {
  getCameraStreamConstraints,
  listVideoInputDevices,
  resolvePreferredCameraId,
  stopCameraStream,
} from "@/lib/camera";
import { firebaseApi, loginCollaboratorWithCustomToken, logoutCollaborator, mintCollaboratorFaceToken } from "@/lib/firebase";
import {
  buildFaceVerificationBadge,
  detectFaceMatchFromSource,
  ensureFaceModelsLoaded,
  extractFaceDescriptorsFromFiles,
  FACE_MATCH_THRESHOLD,
} from "@/lib/face/faceService";

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

export function FaceEnrollmentDialog({ open, employee, onOpenChange, onEnrolled, authUser }) {
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [cameraMode, setCameraMode] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState("");
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");

  const syncCameraDevices = async () => {
    const devices = await listVideoInputDevices().catch(() => []);
    setCameraDevices(devices);
    setSelectedCameraId((currentCameraId) => resolvePreferredCameraId(currentCameraId, devices));
    return devices;
  };

  const resetNativeCamera = () => {
    stopCameraStream(cameraStreamRef.current);
    cameraStreamRef.current = null;
    setCameraReady(false);
    setCameraBusy(false);
    setCameraMode(false);
    setCameraError("");
    setCapturedPreviewUrl("");

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadCameraDevices = async () => {
      const devices = await listVideoInputDevices().catch(() => []);
      if (cancelled) return;
      setCameraDevices(devices);
      setSelectedCameraId((currentCameraId) => resolvePreferredCameraId(currentCameraId, devices));
    };

    if (!open) {
      setFiles([]);
      setBusy(false);
      setMessage(null);
      setCameraDevices([]);
      setSelectedCameraId("");
      resetNativeCamera();
      return undefined;
    }

    void loadCameraDevices();

    const handleDeviceChange = () => {
      if (!cancelled) {
        void loadCameraDevices();
      }
    };

    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [open]);

  useEffect(() => () => resetNativeCamera(), []);

  const enrolledCount = getEmployeeFaceCount(employee);

  const startNativeCamera = async (deviceIdOverride) => {
    try {
      setCameraBusy(true);
      setCameraError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("A câmera nativa não está disponível neste navegador.");
      }

      resetNativeCamera();
      setCameraMode(true);

      const stream = await navigator.mediaDevices.getUserMedia(
        getCameraStreamConstraints(
          typeof deviceIdOverride === "string" ? deviceIdOverride : selectedCameraId
        )
      );

      cameraStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      await syncCameraDevices();
      setCameraReady(true);
    } catch (error) {
      setCameraError(error?.message || "Não foi possível abrir a câmera nativa.");
      setCameraMode(false);
    } finally {
      setCameraBusy(false);
    }
  };

  const captureNativePhoto = async () => {
    if (!videoRef.current || !cameraReady) return;

    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Não foi possível capturar a foto.");
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
    if (!blob) {
      setCameraError("Não foi possível gerar a foto capturada.");
      return;
    }

    const fileName = `cadastro-facial-${employee?.registration || employee?.id || "colaborador"}-${Date.now()}.png`;
    const file = new File([blob], fileName, { type: "image/png" });

    setFiles((prev) => [file, ...prev].slice(0, 3));
    setCapturedPreviewUrl(canvas.toDataURL("image/png"));
    setMessage({
      kind: "success",
      title: "Foto capturada",
      description: "A imagem da câmera foi adicionada à lista de cadastro facial.",
    });
  };

  const handleCameraSelectionChange = (event) => {
    const nextCameraId = event.target.value;
    setSelectedCameraId(nextCameraId);
    setCameraError("");

    if (cameraMode) {
      void startNativeCamera(nextCameraId);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!employee?.id) {
      setMessage({
        kind: "error",
        title: "Colaborador inválido",
        description: "Selecione um colaborador antes de cadastrar o rosto.",
      });
      return;
    }

    if (!files.length) {
      setMessage({
        kind: "error",
        title: "Adicione fotos",
        description: "Envie uma ou mais fotos do colaborador para gerar o descritor facial.",
      });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      await ensureFaceModelsLoaded();
      const { descriptors, failedFiles } = await extractFaceDescriptorsFromFiles(files);

      const payload = {
        faceDescriptors: descriptors,
        faceEnrollmentCount: descriptors.length,
        faceEnrollmentSource: "upload",
        faceEnrolledAt: new Date().toISOString(),
        faceEnrolledByUid: authUser?.uid || null,
        faceEnrollmentUpdatedAt: new Date().toISOString(),
        faceEnrollmentUpdatedBy: authUser?.uid || null,
      };

      await firebaseApi.update("employees", employee.id, payload);
      onEnrolled?.({
        employeeId: employee.id,
        payload,
        failedFiles,
        descriptorsCount: descriptors.length,
      });

      setMessage({
        kind: "success",
        title: "Rosto cadastrado",
        description: `${employee.name} agora tem ${descriptors.length} foto(s) base para reconhecimento facial.${
          failedFiles.length ? ` ${failedFiles.length} arquivo(s) foram ignorados.` : ""
        }`,
      });

      onOpenChange?.(false);
    } catch (error) {
      setMessage({
        kind: "error",
        title: "Falha ao cadastrar rosto",
        description: error?.message || "Não foi possível gerar o descritor facial.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-3xl">
        <DialogHeader>
          <DialogTitle>Cadastro facial do colaborador</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-2xl border bg-slate-50 p-4">
            <p className="text-sm text-muted-foreground">Colaborador</p>
            <p className="text-base font-semibold">{employee?.name || "Selecione um colaborador"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Matrícula: {employee?.registration || "N/D"} • Rostos cadastrados: {enrolledCount}
            </p>
          </div>

          <Alert className="rounded-2xl border-blue-200">
            <UserCheck className="h-4 w-4" />
            <AlertTitle>Use fotos já existentes ou a câmera nativa</AlertTitle>
            <AlertDescription>
              Envie 1 a 3 fotos nítidas do colaborador ou tire a foto direto pela câmera do navegador.
            </AlertDescription>
          </Alert>

          {message && (
            <Alert className={message.kind === "error" ? "rounded-2xl border-red-300" : "rounded-2xl border-green-300"}>
              {message.kind === "error" ? <TriangleAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              <AlertTitle>{message.title}</AlertTitle>
              <AlertDescription>{message.description}</AlertDescription>
            </Alert>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label>Fotos do colaborador</Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                disabled={busy}
                onChange={(event) => setFiles(Array.from(event.target.files || []))}
              />
              <p className="text-xs text-muted-foreground">
                Selecione fotos já tiradas do colaborador ou capture uma nova foto pela câmera nativa.
              </p>
            </div>

            <div className="space-y-3 rounded-2xl border bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Câmera nativa</p>
                  <p className="text-xs text-muted-foreground">
                    Abra a câmera do navegador e tire a foto sem sair desta tela.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {cameraMode ? (
                    <Button type="button" variant="outline" onClick={resetNativeCamera} disabled={busy || cameraBusy}>
                      Fechar câmera
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={startNativeCamera} disabled={busy || cameraBusy}>
                      {cameraBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                      Usar câmera
                    </Button>
                  )}

                  {cameraMode ? (
                    <Button type="button" onClick={captureNativePhoto} disabled={busy || cameraBusy || !cameraReady}>
                      <Camera className="mr-2 h-4 w-4" />
                      Tirar foto
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="face-enrollment-camera">Selecionar câmera</Label>
                <select
                  id="face-enrollment-camera"
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none ring-offset-white focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedCameraId}
                  onChange={handleCameraSelectionChange}
                  disabled={busy || cameraBusy}
                >
                  <option value="">Câmera padrão do navegador</option>
                  {cameraDevices.map((device) => (
                    <option key={device.deviceId || device.label} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Escolha a câmera integrada do computador ou uma webcam externa antes de capturar a foto.
                </p>
              </div>

              {cameraError ? <p className="text-xs text-red-600">{cameraError}</p> : null}

              {cameraMode ? (
                <div className="rounded-2xl border bg-slate-950 p-2 text-white">
                  <div className="relative overflow-hidden rounded-xl bg-black">
                    <video
                      ref={videoRef}
                      className="h-[240px] w-full object-contain bg-black"
                      playsInline
                      muted
                      autoPlay
                    />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="h-[160px] w-[120px] rounded-[48%] border border-white/35" />
                    </div>
                    <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white/90">
                      Centralize o rosto
                    </div>
                  </div>
                </div>
              ) : null}

              {capturedPreviewUrl ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Última foto capturada</p>
                  <div className="overflow-hidden rounded-2xl border bg-white">
                    <img src={capturedPreviewUrl} alt="Foto capturada pela câmera" className="w-full" />
                  </div>
                </div>
              ) : null}
            </div>

            {files.length > 0 && (
              <div className="rounded-2xl border bg-white p-4">
                <p className="text-sm font-medium">Arquivos selecionados</p>
                <ScrollArea className="mt-3 max-h-40 pr-3">
                  <ul className="space-y-2">
                    {files.map((file) => (
                      <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">{file.name}</span>
                        <Badge variant="secondary">{Math.round(file.size / 1024)} KB</Badge>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                Salvar cadastro facial
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FaceVerificationPanel({ employees, pendingDelivery, onVerified, authUser }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Posicione o rosto na câmera e toque em Validar face.");
  const [errorMessage, setErrorMessage] = useState("");
  const [recognizedMatch, setRecognizedMatch] = useState(null);
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraDevicesLoaded, setCameraDevicesLoaded] = useState(false);

  const enrolledEmployees = useMemo(
    () =>
      (Array.isArray(employees) ? employees : []).filter((employee) => getEmployeeFaceCount(employee) > 0),
    [employees]
  );

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
    let isMounted = true;

    const startCamera = async () => {
      try {
        setErrorMessage("");
        setCameraReady(false);
        setRecognizedMatch(null);

        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("A câmera não está disponível neste navegador.");
        }

        const stream = await navigator.mediaDevices.getUserMedia(getCameraStreamConstraints(selectedCameraId));

        if (!isMounted) {
          stopCameraStream(stream);
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const devices = await listVideoInputDevices().catch(() => []);
        if (isMounted) {
          setCameraDevices(devices);
          setSelectedCameraId((currentCameraId) => resolvePreferredCameraId(currentCameraId, devices));
        }

        setCameraReady(true);
        setStatus("Câmera pronta. Quando o rosto estiver enquadrado, valide a face.");
      } catch (error) {
        setErrorMessage(error?.message || "Não foi possível abrir a câmera.");
        setStatus("Abra a câmera para continuar.");
      }
    };

    if (!cameraDevicesLoaded) {
      return undefined;
    }

    if (pendingDelivery && enrolledEmployees.length) {
      void startCamera();
    } else if (pendingDelivery && !enrolledEmployees.length) {
      setErrorMessage("Nenhum colaborador possui cadastro facial no sistema.");
      setStatus("Cadastre ao menos um rosto antes de validar por câmera.");
    }

    return () => {
      isMounted = false;
      stopCameraStream(streamRef.current);
      streamRef.current = null;
    };
  }, [pendingDelivery?.id, enrolledEmployees.length, selectedCameraId, cameraDevicesLoaded]);

  const handleCameraSelectionChange = (event) => {
    setSelectedCameraId(event.target.value);
    setCameraReady(false);
    setErrorMessage("");
    setRecognizedMatch(null);
    setStatus("Trocando para a câmera selecionada...");
  };

  const handleVerify = async () => {
    if (!pendingDelivery) return;

    if (!enrolledEmployees.length) {
      setErrorMessage("Nenhum colaborador possui cadastro facial no sistema.");
      return;
    }

    setBusy(true);
    setErrorMessage("");
    setRecognizedMatch(null);
    setStatus("Lendo o rosto...");

    try {
      await ensureFaceModelsLoaded();

      const { bestMatch, matchedEmployee, eligibleEmployeesCount } = await detectFaceMatchFromSource(
        videoRef.current,
        enrolledEmployees,
        FACE_MATCH_THRESHOLD
      );

      if (!matchedEmployee || bestMatch.label === "unknown") {
        throw new Error("Rosto não reconhecido. Tente novamente com a face centralizada.");
      }

      const tokenResponse = await mintCollaboratorFaceToken({
        employeeId: matchedEmployee.id,
        matchDistance: bestMatch.distance,
        verificationMethod: "face_delivery",
      });

      const customToken = tokenResponse?.data?.customToken || tokenResponse?.data?.token;
      if (!customToken) {
        throw new Error("O Firebase não retornou o token facial.");
      }

      const credential = await loginCollaboratorWithCustomToken(customToken);
      if (!credential?.user?.uid) {
        throw new Error("Não foi possível autenticar o colaborador no Firebase.");
      }

      const verifiedAt = new Date();
      const faceBadgeDataUrl = buildFaceVerificationBadge({
        employeeName: matchedEmployee.name,
        registration: matchedEmployee.registration,
        distance: bestMatch.distance,
        verifiedAt,
      });

      setRecognizedMatch({
        employeeName: matchedEmployee.name,
        registration: matchedEmployee.registration || "",
      });
      void playFaceRecognitionSound();
      setStatus(
        `Face reconhecida para ${matchedEmployee.name}. Finalizando a entrega com ${eligibleEmployeesCount} cadastro(s) facial(is).`
      );

      await onVerified?.({
        employee: matchedEmployee,
        collaboratorUid: credential.user.uid,
        customToken,
        faceBadgeDataUrl,
        faceVerifiedAt: verifiedAt.toISOString(),
        faceMatchDistance: bestMatch.distance,
        faceLabel: bestMatch.label,
      });
    } catch (error) {
      setRecognizedMatch(null);
      setErrorMessage(error?.message || "Falha ao validar o rosto.");
      setStatus("Tente novamente com o rosto bem enquadrado na câmera.");

      try {
        await logoutCollaborator();
      } catch {
        // Ignora falha ao limpar sessão facial parcial.
      }
    } finally {
      setBusy(false);
    }
  };

  const hasSupport = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[1.05fr,0.95fr]">
        <div className="min-w-0 space-y-3">
          <div className="space-y-2 rounded-2xl border bg-slate-50 p-3">
            <Label htmlFor="face-verification-camera">Selecionar câmera</Label>
            <select
              id="face-verification-camera"
              className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none ring-offset-white focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              value={selectedCameraId}
              onChange={handleCameraSelectionChange}
              disabled={busy || !hasSupport}
            >
              <option value="">Câmera padrão do navegador</option>
              {cameraDevices.map((device) => (
                <option key={device.deviceId || device.label} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Escolha entre a câmera integrada do computador e uma webcam externa para validar a face.
            </p>
          </div>

          <div className="rounded-2xl border bg-slate-950 p-2 text-white shadow-sm">
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                className="h-[clamp(180px,28vh,230px)] w-full object-contain bg-black"
                playsInline
                muted
                autoPlay
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-[140px] w-[105px] rounded-[48%] border border-white/35 sm:h-[160px] sm:w-[120px]" />
              </div>
              <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white/90">
                Centralize o rosto
              </div>
              {recognizedMatch ? (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-2xl border border-emerald-200 bg-emerald-500/92 px-4 py-3 text-white shadow-lg">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-50/90">
                        Face reconhecida
                      </p>
                      <p className="text-sm font-semibold">{recognizedMatch.employeeName}</p>
                      <p className="text-xs text-emerald-50/90">
                        {recognizedMatch.registration || "Matrícula não informada"} • Finalizando entrega...
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
                setRecognizedMatch(null);
                setStatus("Câmera parada. Reabra a entrega para ativar a leitura novamente.");
              }}
              disabled={!cameraReady || busy}
            >
              Parar câmera
            </Button>
            <Button type="button" onClick={handleVerify} disabled={busy || !hasSupport || !cameraReady || !enrolledEmployees.length}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
              Validar face
            </Button>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="rounded-2xl border bg-slate-50 p-3">
            <p className="text-sm text-muted-foreground">Retirada por face</p>
            <p className="mt-1 text-base font-semibold">
              {pendingDelivery?.itemName || "EPI selecionado"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Quantidade: {pendingDelivery?.quantity || "N/D"}
            </p>
            {pendingDelivery?.note ? (
              <p className="mt-1 text-sm text-muted-foreground">Obs.: {pendingDelivery.note}</p>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Operador: {authUser?.displayName || authUser?.email || "Sessão atual"}
            </p>
          </div>

          <Alert className="rounded-2xl border-blue-200">
            <UserCheck className="h-4 w-4" />
            <AlertTitle>Cadastro facial disponível</AlertTitle>
            <AlertDescription>
              {enrolledEmployees.length} colaborador(es) possuem foto base cadastrada para comparação.
            </AlertDescription>
          </Alert>

          {errorMessage ? (
            <Alert className="rounded-2xl border-red-300">
              <TriangleAlert className="h-4 w-4" />
              <AlertTitle>Não foi possível validar</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : recognizedMatch ? (
            <Alert className="rounded-2xl border-emerald-300 bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle>Face reconhecida</AlertTitle>
              <AlertDescription>
                {recognizedMatch.employeeName} foi identificado com sucesso. O sistema está concluindo a entrega do EPI.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="rounded-2xl border-slate-200">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Guia de uso</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
