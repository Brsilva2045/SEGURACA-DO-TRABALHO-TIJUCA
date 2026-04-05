"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  auth,
  finalizeFaceDelivery,
  firebaseApi,
  loadWorkspaceData,
  logout,
  logoutCollaborator,
  registerAuditLog,
  syncWorkspaceUnitContext,
} from "@/lib/firebase";
import { useFirebaseAuthSession } from "@/lib/firebase/useAuthSession";
import { useWorkspaceUnit } from "@/lib/useWorkspaceUnit";
import { formatDateTimePtBr } from "@/lib/date";
import { enrichGeoLocationWithAddress, formatGeoLocationSummary } from "@/lib/geolocation";
import { buildEmployeeFichaFilename, generateEmployeeFichaPdf } from "@/lib/pdf/epiFicha";
import { generateDeliveryReceiptPdf } from "@/lib/pdf/deliveryReceipt";
import { buildReportsPdfFilename, generateReportsPdf } from "@/lib/pdf/reports";
import { FaceEnrollmentDialog, FaceVerificationPanel } from "@/components/FaceBiometrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DEFAULT_WORKSPACE_UNIT_ID,
  DEFAULT_WORKSPACE_UNIT_NAME,
  WORKSPACE_UNIT_OPTIONS,
  normalizeWorkspaceUnitId,
  normalizeWorkspaceUnitName,
} from "@/lib/workspace";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Factory,
  FileText,
  Download,
  Camera,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Package,
  Plus,
  PencilLine,
  Search,
  Layers3,
  TriangleAlert,
  Trash2,
  UserCheck,
} from "lucide-react";

const brandLogoUrl = "/brand-logo.png";
const PANEL_TABS = [
  { value: "dashboard", label: "Dashboard", icon: BarChart3 },
  { value: "colaboradores", label: "Colaboradores", icon: UserCheck },
  { value: "epis", label: "EPI e estoque", icon: Package },
  { value: "entregas", label: "Entregas", icon: ClipboardList },
  { value: "ocorrencias", label: "Ocorrências", icon: TriangleAlert },
  { value: "relatorios", label: "Relatórios", icon: FileText },
];

/**
 * MVP — Sistema SST / EPI com Firebase
 *
 * O app abaixo é um frontend único para demonstrar:
 * - dashboard
 * - cadastro de colaboradores
 * - cadastro de EPI
 * - entrada e saída de estoque
 * - entrega de EPI com assinatura na tela
 * - registro de ocorrências
 *
 * Integração Firebase modular:
 * 1) `src/lib/firebase/auth.js` cuida do Auth
 * 2) `src/lib/firebase/firestore.js` centraliza Firestore
 * 3) `src/lib/firebase/storage.js` faz upload da assinatura
 * 4) `functions/index.js` expõe Cloud Functions
 */

const initialEmployees = [
  {
    id: "emp-001",
    name: "Carlos Souza",
    registration: "EMP-001",
    company: "Tijuca Alimentos",
    role: "Operador",
    lotacao: "Produção",
    sector: "Produção",
    status: "Ativo",
  },
  {
    id: "emp-002",
    name: "Mariana Lima",
    registration: "EMP-002",
    company: "Tijuca Alimentos",
    role: "Conferente",
    lotacao: "Logística",
    sector: "Logística",
    status: "Ativo",
  },
];

const initialEpis = [
  {
    id: "epi-001",
    name: "Luva nitrílica",
    caNumber: "12345",
    category: "Mãos",
    unit: "par",
    minimumStock: 20,
    stock: 48,
    workspaceUnitId: DEFAULT_WORKSPACE_UNIT_ID,
    workspaceUnitName: DEFAULT_WORKSPACE_UNIT_NAME,
    active: true,
  },
  {
    id: "epi-002",
    name: "Óculos de proteção",
    caNumber: "67890",
    category: "Olhos",
    unit: "un",
    minimumStock: 15,
    stock: 12,
    workspaceUnitId: DEFAULT_WORKSPACE_UNIT_ID,
    workspaceUnitName: DEFAULT_WORKSPACE_UNIT_NAME,
    active: true,
  },
];

const initialOccurrences = [
  {
    id: "occ-001",
    type: "Quase acidente",
    title: "Piso escorregadio no recebimento",
    sector: "Logística",
    severity: "Média",
    description: "Colaborador quase escorregou ao movimentar pallet.",
    status: "Aberta",
    workspaceUnitId: DEFAULT_WORKSPACE_UNIT_ID,
    workspaceUnitName: DEFAULT_WORKSPACE_UNIT_NAME,
    createdAt: formatDateTimePtBr(new Date()),
  },
];

const initialDeliveries = [];
const initialMovements = [];
const emptyEpiForm = {
  name: "",
  caNumber: "",
  category: "",
  unit: "un",
  minimumStock: "",
  stock: "",
};

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const normalizeFieldKey = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const resolveWorkspaceUnitContext = (record = {}) => {
  const workspaceUnitName = normalizeWorkspaceUnitName(
    record.workspaceUnitName || record.unitName || record.branchName || DEFAULT_WORKSPACE_UNIT_NAME
  );
  const workspaceUnitId = normalizeWorkspaceUnitId(record.workspaceUnitId || record.branchId || workspaceUnitName);

  return {
    workspaceUnitId,
    workspaceUnitName,
  };
};

const attachWorkspaceUnitContext = (record = {}, fallbackName = DEFAULT_WORKSPACE_UNIT_NAME) => {
  const workspaceUnitName = normalizeWorkspaceUnitName(record.workspaceUnitName || fallbackName);
  const workspaceUnitId = normalizeWorkspaceUnitId(record.workspaceUnitId || workspaceUnitName);

  return {
    ...record,
    workspaceUnitId,
    workspaceUnitName,
  };
};

const normalizeSearchText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const tokenizeSearchText = (value = "") =>
  normalizeSearchText(value)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

const buildEmployeeSearchProfile = (employee = {}) => {
  const fields = [employee.name, employee.registration, employee.company, employee.lotacao, employee.sector, employee.role]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);

  const nameTokens = tokenizeSearchText(employee.name);

  return {
    nameKey: normalizeFieldKey(employee.name),
    registrationKey: normalizeFieldKey(employee.registration),
    searchableKey: normalizeFieldKey(fields.join(" ")),
    nameCollapsed: nameTokens.join(""),
    nameTokens,
    tokens: fields.flatMap((field) => field.split(/\s+/)).filter(Boolean),
    initials: nameTokens.map((token) => token[0]).join(""),
  };
};

const scoreDeliveryEmployeeMatch = (employee, rawTerm = "") => {
  const termText = normalizeSearchText(rawTerm);
  if (!termText) {
    return -1;
  }

  const termKey = normalizeFieldKey(rawTerm);
  const termTokens = tokenizeSearchText(rawTerm);
  const termCollapsed = termTokens.join("");
  const profile = buildEmployeeSearchProfile(employee);

  let score = -1;

  if (profile.nameKey && profile.nameKey === termKey) {
    score = Math.max(score, 1000);
  }

  if (profile.registrationKey && profile.registrationKey === termKey) {
    score = Math.max(score, 990);
  }

  if (termCollapsed) {
    if (profile.nameCollapsed === termCollapsed) {
      score = Math.max(score, 980);
    }

    if (profile.nameCollapsed.startsWith(termCollapsed)) {
      score = Math.max(score, 920);
    }

    if (profile.initials.startsWith(termCollapsed)) {
      score = Math.max(score, 900);
    }

    if (profile.searchableKey.startsWith(termCollapsed)) {
      score = Math.max(score, 880);
    }

    if (profile.searchableKey.includes(termCollapsed)) {
      score = Math.max(score, 760);
    }
  }

  if (termTokens.length > 0) {
    const allTokensMatched = termTokens.every((queryToken) =>
      profile.tokens.some((token) => token.startsWith(queryToken) || token.includes(queryToken))
    );

    if (allTokensMatched) {
      const tokenSpecificity = termTokens.reduce((acc, queryToken) => {
        if (profile.tokens.some((token) => token === queryToken)) {
          return acc + 2;
        }

        if (profile.tokens.some((token) => token.startsWith(queryToken))) {
          return acc + 1;
        }

        return acc;
      }, 0);

      score = Math.max(score, 700 + termTokens.length * 25 + tokenSpecificity * 5);
    }
  }

  return score;
};

const splitCsvLine = (line, delimiter) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const detectCsvDelimiter = (line) => {
  const candidates = [";", ",", "\t"];

  return candidates.reduce(
    (best, delimiter) => {
      const count = line.split(delimiter).length - 1;
      return count > best.count ? { delimiter, count } : best;
    },
    { delimiter: ";", count: -1 }
  ).delimiter;
};

const getCsvValue = (row, headers, aliases) => {
  const normalizedHeaders = headers.map(normalizeFieldKey);
  const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
  return index >= 0 ? (row[index] || "").trim() : "";
};

const normalizeEmployeeRecord = (employee = {}, index = 0) => {
  const lotacao = employee.lotacao || employee.sector || employee.setor || "";
  const company = employee.company || employee.empresa || "";
  const registration = employee.registration || employee.matricula || `EMP-${String(index + 1).padStart(3, "0")}`;
  const workspaceUnitName = normalizeWorkspaceUnitName(
    employee.workspaceUnitName || employee.unitName || DEFAULT_WORKSPACE_UNIT_NAME
  );
  const workspaceUnitId = normalizeWorkspaceUnitId(employee.workspaceUnitId || workspaceUnitName);
  const faceDescriptors = Array.isArray(employee.faceDescriptors)
    ? employee.faceDescriptors
    : Array.isArray(employee.faceDescriptor)
      ? employee.faceDescriptor
      : [];

  return {
    id: employee.id || registration || `emp-${index + 1}`,
    name: employee.name || employee.nome || "",
    company,
    role: employee.role || employee.cargo || "",
    lotacao,
    sector: lotacao,
    registration,
    workspaceUnitId,
    workspaceUnitName,
    status: employee.status || "Ativo",
    faceDescriptors,
    faceEnrollmentCount: Number(employee.faceEnrollmentCount || faceDescriptors.length || 0),
    faceEnrolledAt: employee.faceEnrolledAt || "",
  };
};

const parseLocaleDateTime = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const numericDate = new Date(value);
    return Number.isNaN(numericDate.getTime()) ? null : numericDate;
  }

  const text = String(value).trim();
  if (!text) return null;

  if (!text.includes("/")) {
    const directDate = new Date(text);
    if (!Number.isNaN(directDate.getTime())) {
      return directDate;
    }
  }

  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[^\d]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;

  const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
  const parsedDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const getMonthKeyFromValue = (value) => {
  const date = parseLocaleDateTime(value);
  if (!date) return "";

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const formatCount = (value) => new Intl.NumberFormat("pt-BR").format(Number(value || 0));

const captureBrowserGeolocation = async () => {
  const capturedAt = new Date().toISOString();

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return {
      status: "unsupported",
      capturedAt,
      reason: "A localização não está disponível neste navegador.",
    };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const geoLocation = await enrichGeoLocationWithAddress({
          status: "captured",
          capturedAt,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          mapUrl: `https://www.google.com/maps?q=${position.coords.latitude},${position.coords.longitude}`,
        });

        resolve(geoLocation);
      },
      (error) => {
        const reason =
          error?.code === 1
            ? "permission-denied"
            : error?.code === 2
              ? "position-unavailable"
              : error?.code === 3
                ? "timeout"
                : "error";

        resolve({
          status: reason,
          capturedAt,
          reason: error?.message || "Não foi possível obter a localização.",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  });
};

const DELIVERY_GPS_REQUIRED_ERROR = "delivery-gps-required";

const captureRequiredBrowserGeolocation = async () => {
  const geoLocation = await captureBrowserGeolocation();

  if (geoLocation?.status === "captured") {
    return geoLocation;
  }

  const message =
    geoLocation?.status === "permission-denied"
      ? "Permita o acesso ao GPS do aparelho para concluir a entrega."
      : geoLocation?.status === "unsupported"
        ? "Este navegador não disponibiliza geolocalização. Use um aparelho com GPS habilitado."
        : geoLocation?.status === "timeout"
          ? "Não foi possível obter o GPS a tempo. Aguarde o sinal e tente novamente."
          : geoLocation?.status === "position-unavailable"
            ? "O aparelho não conseguiu determinar a localização atual. Verifique o GPS e tente novamente."
            : "A entrega exige GPS capturado no momento da confirmação.";

  const error = new Error(message);
  error.code = DELIVERY_GPS_REQUIRED_ERROR;
  error.geoLocation = geoLocation;
  throw error;
};

function SignaturePad({ onSave }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event.changedTouches?.[0] || event;
    return {
      x: source.clientX - rect.left,
      y: source.clientY - rect.top,
    };
  };

  const applyBrushStyle = (ctx, event) => {
    const pointerType = event.pointerType || "mouse";
    const pressure = Number(event.pressure || 0);

    ctx.strokeStyle = "#111827";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth =
      pointerType === "touch"
        ? 6
        : pointerType === "pen"
          ? Math.max(4, pressure > 0 ? pressure * 7 : 4)
          : 2.5;
  };

  const startDraw = (event) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    const point = getPoint(event);
    applyBrushStyle(ctx, event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    setIsDrawing(true);
  };

  const draw = (event) => {
    if (!isDrawing) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const point = getPoint(event);
    applyBrushStyle(ctx, event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    setHasSigned(true);
  };

  const endDraw = (event) => {
    const canvas = canvasRef.current;
    if (event?.pointerId != null && canvas?.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    setIsDrawing(false);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSigned(false);
  };

  const save = () => {
    if (!hasSigned) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onSave(dataUrl);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-white p-2">
        <div className="overflow-hidden rounded-xl border bg-white">
          <canvas
            ref={canvasRef}
            width={700}
            height={260}
            className="block h-[260px] w-full touch-none bg-white"
            style={{
              touchAction: "none",
              userSelect: "none",
              WebkitTouchCallout: "none",
              WebkitUserSelect: "none",
            }}
            onPointerDown={startDraw}
            onPointerMove={draw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={clear}>
          Limpar assinatura
        </Button>
        <Button type="button" onClick={save} disabled={!hasSigned}>
          Confirmar assinatura
        </Button>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, helper, alert }) {
  const palette = alert
    ? {
        card: "border-red-200 bg-gradient-to-br from-red-50 via-white to-red-100/70",
        title: "text-red-700",
        value: "text-red-950",
        helper: "text-red-600",
        iconWrap: "border-red-200 bg-white/90 text-red-600 shadow-sm",
      }
    : title === "Colaboradores"
      ? {
          card: "border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-100/70",
          title: "text-sky-700",
          value: "text-sky-950",
          helper: "text-sky-700/80",
          iconWrap: "border-sky-200 bg-white/90 text-sky-700 shadow-sm",
        }
      : {
          card: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-100/70",
          title: "text-amber-700",
          value: "text-amber-950",
          helper: "text-amber-700/80",
          iconWrap: "border-amber-200 bg-white/90 text-amber-700 shadow-sm",
        };

  return (
    <Card className={cn("rounded-2xl shadow-sm", palette.card)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={cn("text-sm font-medium", palette.title)}>{title}</p>
            <p className={cn("mt-2 text-3xl font-semibold", palette.value)}>{value}</p>
            <p className={cn("mt-2 text-sm", palette.helper)}>{helper}</p>
          </div>
          <div className={cn("rounded-2xl border p-3", palette.iconWrap)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AuthPanel({ authMode, authBusy, authForm, setAuthForm, setAuthMode, onSubmit, onGoogleLogin }) {
  const modeLabelMap = {
    login: "Entrar",
    register: "Criar conta",
    reset: "Recuperar senha",
  };

  const showResetField = authMode === "reset";

  return (
    <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
      <CardContent className="grid gap-0 p-0 lg:grid-cols-[1.1fr,0.9fr]">
        <div className="relative overflow-hidden bg-slate-950 px-6 py-8 text-white md:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.14),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.94))]" />
          <div className="relative space-y-4">
            <Badge variant="outline" className="border-white/20 bg-white/10 text-white">
              Firebase Auth
            </Badge>
            <div className="space-y-3">
              <h2 className="text-3xl font-semibold tracking-tight">Acesso ao Sistema SST</h2>
              <p className="max-w-xl text-sm leading-6 text-slate-200">
                Entre com Google ou email e senha para carregar os dados reais do Firestore e liberar
                estoque, ocorrências, entregas e assinaturas.
              </p>
            </div>
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Sessão</p>
                <p className="mt-2 text-sm text-slate-100">
                  O painel usa o Firebase Auth antes de escrever no Firestore e no Storage.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Registro</p>
                <p className="mt-2 text-sm text-slate-100">
                  O acesso autenticado liga os dados do usuário aos eventos gerados pelo sistema.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6 md:p-8">
          <div className="flex flex-wrap gap-2">
            {["login", "register", "reset"].map((mode) => (
              <Button
                key={mode}
                type="button"
                variant={authMode === mode ? "default" : "outline"}
                size="sm"
                onClick={() => setAuthMode(mode)}
                disabled={authBusy}
              >
                {modeLabelMap[mode]}
              </Button>
            ))}
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={onGoogleLogin} disabled={authBusy}>
            {authBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
            Entrar com Google
          </Button>

          <form className="space-y-4" onSubmit={onSubmit}>
            {authMode === "register" && (
              <div className="space-y-2">
                <Label>Nome de exibição</Label>
                <Input
                  value={authForm.displayName}
                  onChange={(event) =>
                    setAuthForm((prev) => ({ ...prev, displayName: event.target.value }))
                  }
                  placeholder="Seu nome no sistema"
                  disabled={authBusy}
                  required
                />
              </div>
            )}

            {(authMode === "login" || authMode === "register") && (
              <>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      className="pl-9"
                      type="email"
                      value={authForm.email}
                      onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))}
                      placeholder="voce@empresa.com"
                      disabled={authBusy}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Senha</Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      className="pl-9"
                      type="password"
                      value={authForm.password}
                      onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
                      placeholder="••••••••"
                      disabled={authBusy}
                      required
                    />
                  </div>
                </div>
              </>
            )}

            {showResetField && (
              <div className="space-y-2">
                <Label>Email para redefinição</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-9"
                    type="email"
                    value={authForm.resetEmail}
                    onChange={(event) => setAuthForm((prev) => ({ ...prev, resetEmail: event.target.value }))}
                    placeholder="voce@empresa.com"
                    disabled={authBusy}
                    required
                  />
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={authBusy}>
              {authBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              {modeLabelMap[authMode]}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SSTEpiFirebaseMVP() {
  const router = useRouter();
  const { authUser, authReady } = useFirebaseAuthSession();
  const { workspaceUnit, workspaceUnitLoaded, setWorkspaceUnit } = useWorkspaceUnit();
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [epis, setEpis] = useState([]);
  const [occurrences, setOccurrences] = useState([]);
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [movements, setMovements] = useState(initialMovements);

  const [employeeForm, setEmployeeForm] = useState({
    name: "",
    company: "",
    lotacao: "",
    role: "",
    status: "Ativo",
  });

  const [epiForm, setEpiForm] = useState(emptyEpiForm);
  const [epiEditId, setEpiEditId] = useState("");

  const [occurrenceForm, setOccurrenceForm] = useState({
    type: "Ocorrência",
    title: "",
    sector: "",
    severity: "Baixa",
    description: "",
  });

  const [stockEntryForm, setStockEntryForm] = useState({
    epiId: "",
    quantity: "",
    note: "",
  });

  const [deliveryForm, setDeliveryForm] = useState({
    employeeId: "",
    itemId: "",
    quantity: "1",
    note: "",
  });

  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [pendingDelivery, setPendingDelivery] = useState(null);
  const [receiptBusyDeliveryId, setReceiptBusyDeliveryId] = useState("");
  const [search, setSearch] = useState("");
  const [deliveryEmployeeSearch, setDeliveryEmployeeSearch] = useState("");
  const [reportCollaboratorSearch, setReportCollaboratorSearch] = useState("");
  const [deliveryAuthMode, setDeliveryAuthMode] = useState("signature");
  const [faceEnrollmentOpen, setFaceEnrollmentOpen] = useState(false);
  const [faceEnrollmentEmployee, setFaceEnrollmentEmployee] = useState(null);
  const [reportPdfBusy, setReportPdfBusy] = useState(false);
  const [fichaBusyEmployeeId, setFichaBusyEmployeeId] = useState("");
  const [expandedStockItemId, setExpandedStockItemId] = useState("");
  const [workspaceUnitDraft, setWorkspaceUnitDraft] = useState(DEFAULT_WORKSPACE_UNIT_ID);
  const [message, setMessage] = useState(null);
  const [canPersistOccurrences, setCanPersistOccurrences] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [employeeImportBusy, setEmployeeImportBusy] = useState(false);

  const authDisplayName = authUser?.displayName || authUser?.email || "Usuário autenticado";
  const authDisplayInitial = authDisplayName.trim().charAt(0).toUpperCase() || "U";

  const notify = (title, description, kind = "success") => {
    setMessage({ title, description, kind });
    setTimeout(() => setMessage(null), 3000);
  };

  const notifyError = (title, error, description) => {
    console.error(title, error);
    notify(title, description, "error");
  };

  useEffect(() => {
    if (workspaceUnitLoaded) {
      setWorkspaceUnitDraft(workspaceUnit.workspaceUnitId);
    }
  }, [workspaceUnitLoaded, workspaceUnit.workspaceUnitId]);

  useEffect(() => {
    if (authReady && !authUser) {
      router.replace("/login");
    }
  }, [authReady, authUser, router]);

  useEffect(() => {
    let isMounted = true;

    const hydrateWorkspaceCollections = (collections = {}) => {
      const employeesData = Array.isArray(collections.employees) ? collections.employees : [];
      const episData = Array.isArray(collections.epi_items) ? collections.epi_items : [];
      const occurrencesData = Array.isArray(collections.occurrences) ? collections.occurrences : [];
      const deliveriesData = Array.isArray(collections.deliveries) ? collections.deliveries : [];
      const movementsData = Array.isArray(collections.stock_movements) ? collections.stock_movements : [];

      setEmployees(
        employeesData
          .map((employee, index) =>
            normalizeEmployeeRecord(
              attachWorkspaceUnitContext(employee, workspaceUnit.workspaceUnitName),
              index
            )
          )
          .filter((employee) => employee.workspaceUnitId === workspaceUnit.workspaceUnitId)
      );
      setEpis(
        episData
          .map((item) => attachWorkspaceUnitContext(item))
          .filter((item) => item.workspaceUnitId === workspaceUnit.workspaceUnitId)
      );
      setOccurrences(
        occurrencesData
          .map((item) => attachWorkspaceUnitContext(item))
          .filter((item) => item.workspaceUnitId === workspaceUnit.workspaceUnitId)
      );

      const normalizedDeliveries = deliveriesData
        .map((item) => ({
          ...attachWorkspaceUnitContext(item),
          signatureDataUrl: item.signatureDataUrl || "",
          signatureImageUrl: item.signatureImageUrl || "",
          geoLocation: item.geoLocation || null,
          receiptPdfUrl:
            item.receiptPdfUrl && !String(item.receiptPdfUrl).includes("TODO-cloud-function-pdf")
              ? item.receiptPdfUrl
              : "",
          receiptGeneratedAt: item.receiptGeneratedAt || "",
        }))
        .filter((item) => item.workspaceUnitId === workspaceUnit.workspaceUnitId);

      setDeliveries(normalizedDeliveries);
      setMovements(
        movementsData
          .map((item) => attachWorkspaceUnitContext(item))
          .filter((item) => item.workspaceUnitId === workspaceUnit.workspaceUnitId)
      );
      setCanPersistOccurrences(true);

      return normalizedDeliveries;
    };

    const loadInitialData = async () => {
      if (!authReady) {
        return;
      }

      if (!workspaceUnitLoaded) {
        return;
      }

      if (!authUser) {
        if (!isMounted) return;
        setEmployees(
          initialEmployees
            .map((employee, index) =>
              normalizeEmployeeRecord(
                attachWorkspaceUnitContext(employee, workspaceUnit.workspaceUnitName),
                index
              )
            )
            .filter((employee) => employee.workspaceUnitId === workspaceUnit.workspaceUnitId)
        );
        setEpis(
          initialEpis
            .map((item) => attachWorkspaceUnitContext(item))
            .filter((item) => item.workspaceUnitId === workspaceUnit.workspaceUnitId)
        );
        setOccurrences(
          initialOccurrences
            .map((item) => attachWorkspaceUnitContext(item))
            .filter((item) => item.workspaceUnitId === workspaceUnit.workspaceUnitId)
        );
        setDeliveries(initialDeliveries);
        setMovements(initialMovements);
        setCanPersistOccurrences(false);
        setIsBootstrapping(false);
        return;
      }

      setIsBootstrapping(true);
      setEmployees([]);
      setEpis([]);
      setOccurrences([]);
      setDeliveries([]);
      setMovements([]);
      setCanPersistOccurrences(false);

      try {
        if (authUser) {
          await syncWorkspaceUnitContext({
            workspaceUnitId: workspaceUnit.workspaceUnitId,
            workspaceUnitName: workspaceUnit.workspaceUnitName,
          });

          await auth.currentUser?.getIdToken(true);
        }

        let collections = null;

        try {
          const workspaceData = await loadWorkspaceData({
            workspaceUnitId: workspaceUnit.workspaceUnitId,
            workspaceUnitName: workspaceUnit.workspaceUnitName,
            collections: ["employees", "epi_items", "occurrences", "deliveries", "stock_movements"],
          });

          collections = workspaceData?.data?.collections || null;
        } catch (serverError) {
          console.warn("Falha ao carregar dados da filial via callable", serverError);
        }

        if (!collections) {
          const [employeesData, episData, occurrencesData, deliveriesData, movementsData] = await Promise.all([
            firebaseApi.listWorkspace("employees", workspaceUnit),
            firebaseApi.listWorkspace("epi_items", workspaceUnit),
            firebaseApi.listWorkspace("occurrences", workspaceUnit),
            firebaseApi.listWorkspace("deliveries", workspaceUnit),
            firebaseApi.listWorkspace("stock_movements", workspaceUnit),
          ]);

          collections = {
            employees: employeesData,
            epi_items: episData,
            occurrences: occurrencesData,
            deliveries: deliveriesData,
            stock_movements: movementsData,
          };
        }

        if (!isMounted) return;

        const normalizedDeliveries = hydrateWorkspaceCollections(collections);

        const legacyDeliveryIds = normalizedDeliveries
          .filter(
            (delivery) =>
              !String(delivery.signatureDataUrl || "").trim() &&
              String(delivery.signatureImageUrl || "").trim()
          )
          .map((delivery) => delivery.id)
          .filter(Boolean);

        if (legacyDeliveryIds.length) {
          try {
            const migrationResult = await firebaseApi.backfillDeliverySignatures({
              deliveryIds: legacyDeliveryIds,
            });

            const migratedById = new Map(
              (migrationResult?.updatedDeliveries || []).map((delivery) => [delivery.id, delivery])
            );

            if (migratedById.size && isMounted) {
              setDeliveries((prev) =>
                prev.map((item) => {
                  const migrated = migratedById.get(item.id);
                  return migrated ? { ...item, ...migrated } : item;
                })
              );
            }

            if (migrationResult?.migratedCount > 0) {
              notify(
                "Migração concluída",
                `${migrationResult.migratedCount} entrega(s) antiga(s) tiveram a assinatura digital preenchida.`
              );
            }
          } catch (migrationError) {
            console.error("Falha ao migrar assinaturas antigas", migrationError);
            notify(
              "Migração de assinaturas",
              "Não foi possível preencher automaticamente algumas assinaturas antigas. O PDF continuará tentando usar os dados novos.",
              "error"
            );
          }
        }

      } catch (error) {
        console.error("Erro ao carregar Firebase:", error);
        if (isMounted) {
          setEmployees([]);
          setEpis([]);
          setOccurrences([]);
          setDeliveries([]);
          setMovements([]);
          setCanPersistOccurrences(false);
          notify(
            "Dados da filial não carregaram",
            "Não foi possível buscar os dados reais da filial. Verifique as permissões do Firebase.",
            "error"
          );
        }
      } finally {
        if (isMounted) setIsBootstrapping(false);
      }
    };

    loadInitialData();
    return () => {
      isMounted = false;
    };
  }, [authReady, authUser?.uid, workspaceUnit.workspaceUnitId, workspaceUnitLoaded]);

  const filteredEmployees = useMemo(() => {
    const term = search.toLowerCase();
    return employees.filter((emp) =>
      [emp.name, emp.registration, emp.company, emp.lotacao, emp.sector, emp.role]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [employees, search]);

  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees]
  );
  const epiById = useMemo(() => new Map(epis.map((item) => [item.id, item])), [epis]);
  const editingEpi = useMemo(() => epis.find((item) => item.id === epiEditId) || null, [epis, epiEditId]);
  const isEditingEpi = Boolean(editingEpi);
  const currentMonthKey = getMonthKeyFromValue(new Date());
  const reportCollaboratorTerm = normalizeFieldKey(reportCollaboratorSearch);
  const reportCollaboratorLabel = reportCollaboratorSearch.trim() || "Todos os colaboradores";

  const reportDeliveries = useMemo(() => {
    if (!reportCollaboratorTerm) {
      return deliveries;
    }

    return deliveries.filter((delivery) => {
      const employee = employeeById.get(delivery.employeeId);
      const searchable = [
        employee?.name,
        employee?.registration,
        employee?.company,
        employee?.lotacao,
        employee?.sector,
        employee?.role,
        delivery.employeeName,
        delivery.employeeRegistration,
        delivery.note,
      ]
        .join(" ")
        .toLowerCase();

      return normalizeFieldKey(searchable).includes(reportCollaboratorTerm);
    });
  }, [deliveries, employeeById, reportCollaboratorTerm]);

  const reportMovements = useMemo(() => {
    if (!reportCollaboratorTerm) {
      return movements;
    }

    return movements.filter((movement) => {
      const employee = employeeById.get(movement.employeeId);
      const searchable = [
        employee?.name,
        employee?.registration,
        employee?.company,
        employee?.lotacao,
        employee?.sector,
        employee?.role,
        movement.employeeName,
        movement.employeeRegistration,
        movement.note,
        movement.epiName,
        movement.type,
      ]
        .join(" ")
        .toLowerCase();

      return normalizeFieldKey(searchable).includes(reportCollaboratorTerm);
    });
  }, [movements, employeeById, reportCollaboratorTerm]);

  const reportDeliveriesThisMonth = useMemo(
    () => reportDeliveries.filter((item) => getMonthKeyFromValue(item.createdAt) === currentMonthKey),
    [reportDeliveries, currentMonthKey]
  );
  const occurrencesThisMonth = useMemo(
    () => occurrences.filter((item) => getMonthKeyFromValue(item.createdAt) === currentMonthKey),
    [occurrences, currentMonthKey]
  );

  const totalDeliveriesThisMonth = reportDeliveriesThisMonth.length;
  const totalDeliveryQuantityThisMonth = reportDeliveriesThisMonth.reduce(
    (acc, item) => acc + Number(item.quantity || 0),
    0
  );
  const totalOccurrencesThisMonth = occurrencesThisMonth.length;
  const openOccurrencesThisMonth = occurrencesThisMonth.filter(
    (item) => normalizeFieldKey(item.status) === "aberta"
  ).length;

  const topConsumedEpis = useMemo(() => {
    const rows = new Map();

    reportDeliveries.forEach((delivery) => {
      const epi = epiById.get(delivery.itemId);
      const key = delivery.itemId || delivery.itemName || `epi-${delivery.id}`;
      const quantity = Number(delivery.quantity || 0);

      const currentRow =
        rows.get(key) ||
        {
          id: key,
          itemName: epi?.name || delivery.itemName || "EPI sem nome",
          category: epi?.category || "Sem categoria",
          unit: epi?.unit || "un",
          quantity: 0,
          deliveriesCount: 0,
          employees: new Set(),
        };

      currentRow.quantity += quantity;
      currentRow.deliveriesCount += 1;
      if (delivery.employeeId) {
        currentRow.employees.add(delivery.employeeId);
      }

      rows.set(key, currentRow);
    });

    return [...rows.values()]
      .sort((a, b) => b.quantity - a.quantity || b.deliveriesCount - a.deliveriesCount || a.itemName.localeCompare(b.itemName))
      .slice(0, 10);
  }, [reportDeliveries, epiById]);

  const topSectorConsumption = useMemo(() => {
    const rows = new Map();

    reportDeliveries.forEach((delivery) => {
      const employee = employeeById.get(delivery.employeeId);
      const sector = employee?.lotacao || employee?.sector || delivery.employeeName || "Sem lotação";
      const quantity = Number(delivery.quantity || 0);

      const currentRow =
        rows.get(sector) ||
        {
          sector,
          quantity: 0,
          deliveriesCount: 0,
          employees: new Set(),
        };

      currentRow.quantity += quantity;
      currentRow.deliveriesCount += 1;
      if (delivery.employeeId) {
        currentRow.employees.add(delivery.employeeId);
      }

      rows.set(sector, currentRow);
    });

    return [...rows.values()]
      .sort((a, b) => b.quantity - a.quantity || b.deliveriesCount - a.deliveriesCount || a.sector.localeCompare(b.sector))
      .slice(0, 10);
  }, [reportDeliveries, employeeById]);

  const movementReport = useMemo(() => {
    const rows = new Map();
    let entriesQuantity = 0;
    let entriesCount = 0;
    let exitsQuantity = 0;
    let exitsCount = 0;
    let adjustmentsQuantity = 0;
    let adjustmentsCount = 0;

    const ensureItemRow = (movement) => {
      const epi = epiById.get(movement.epiId);
      const key = movement.epiId || movement.epiName || `movement-${movement.id}`;
      const currentRow =
        rows.get(key) ||
        {
          id: key,
          name: epi?.name || movement.epiName || "EPI sem nome",
          category: epi?.category || "Sem categoria",
          unit: epi?.unit || "un",
          entriesQuantity: 0,
          entriesCount: 0,
          exitsQuantity: 0,
          exitsCount: 0,
          adjustmentsQuantity: 0,
          adjustmentsCount: 0,
          currentStock: epi?.stock ?? null,
        };

      currentRow.currentStock = epi?.stock ?? currentRow.currentStock;
      rows.set(key, currentRow);
      return currentRow;
    };

    reportMovements.forEach((movement) => {
      const quantity = Number(movement.quantity || 0);
      const normalizedType = normalizeFieldKey(movement.type);
      const row = ensureItemRow(movement);

      if (normalizedType === "entrada") {
        entriesQuantity += quantity;
        entriesCount += 1;
        row.entriesQuantity += quantity;
        row.entriesCount += 1;
        return;
      }

      if (normalizedType === "saida") {
        exitsQuantity += quantity;
        exitsCount += 1;
        row.exitsQuantity += quantity;
        row.exitsCount += 1;
        return;
      }

      adjustmentsQuantity += quantity;
      adjustmentsCount += 1;
      row.adjustmentsQuantity += quantity;
      row.adjustmentsCount += 1;
    });

    if (!reportCollaboratorTerm) {
      epis.forEach((epi) => {
        if (!rows.has(epi.id)) {
          rows.set(epi.id, {
            id: epi.id,
            name: epi.name || "EPI sem nome",
            category: epi.category || "Sem categoria",
            unit: epi.unit || "un",
            entriesQuantity: 0,
            entriesCount: 0,
            exitsQuantity: 0,
            exitsCount: 0,
            adjustmentsQuantity: 0,
            adjustmentsCount: 0,
            currentStock: epi.stock ?? null,
          });
        }
      });
    }

    const items = [...rows.values()]
      .filter((item) => !reportCollaboratorTerm || item.entriesCount || item.exitsCount || item.adjustmentsCount)
      .sort(
        (a, b) =>
          b.exitsQuantity - a.exitsQuantity ||
          b.entriesQuantity - a.entriesQuantity ||
          b.adjustmentsQuantity - a.adjustmentsQuantity ||
          a.name.localeCompare(b.name)
      );

    return {
      entriesQuantity,
      entriesCount,
      exitsQuantity,
      exitsCount,
      adjustmentsQuantity,
      adjustmentsCount,
      items,
    };
  }, [reportMovements, reportCollaboratorTerm, epiById, epis]);

  const lowStockCount = epis.filter((item) => item.stock <= item.minimumStock).length;
  const filteredDeliveryEmployees = useMemo(() => {
    const term = deliveryEmployeeSearch.trim();

    if (!term) {
      return [...employees].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
    }

    return employees
      .map((employee) => ({
        employee,
        score: scoreDeliveryEmployeeMatch(employee, term),
      }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }

        return String(a.employee.name || "").localeCompare(String(b.employee.name || ""), "pt-BR");
      })
      .map(({ employee }) => employee);
  }, [employees, deliveryEmployeeSearch]);
  const selectedDeliveryEmployee = useMemo(
    () => employees.find((item) => item.id === deliveryForm.employeeId) || null,
    [deliveryForm.employeeId, employees]
  );
  const deliveryEmployeeSuggestions = useMemo(() => {
    const term = deliveryEmployeeSearch.trim();
    if (!term) return [];

    return filteredDeliveryEmployees.slice(0, 8);
  }, [deliveryEmployeeSearch, filteredDeliveryEmployees]);
  useEffect(() => {
    if (deliveryAuthMode === "face") {
      setDeliveryForm((prev) => ({ ...prev, employeeId: "" }));
      setDeliveryEmployeeSearch("");
    }
  }, [deliveryAuthMode]);
  const reportCollaboratorMatches = useMemo(() => {
    const term = reportCollaboratorTerm;
    if (!term) return [];

    return employees.filter((emp) => {
      const searchable = [
        emp.name,
        emp.registration,
        emp.company,
        emp.lotacao,
        emp.sector,
        emp.role,
      ]
        .join(" ")
        .toLowerCase();

      return normalizeFieldKey(searchable).includes(term);
    });
  }, [employees, reportCollaboratorTerm]);

  const selectedReportCollaborator = useMemo(() => {
    if (reportCollaboratorMatches.length === 1) {
      return reportCollaboratorMatches[0];
    }

    if (!reportCollaboratorTerm) {
      return null;
    }

    const exactMatch = reportCollaboratorMatches.find(
      (emp) =>
        normalizeFieldKey(emp.name) === reportCollaboratorTerm ||
        normalizeFieldKey(emp.registration) === reportCollaboratorTerm
    );

    return exactMatch || null;
  }, [reportCollaboratorMatches, reportCollaboratorTerm]);

  const reportFichaSelectionMessage = useMemo(() => {
    if (!reportCollaboratorTerm) return "";
    if (selectedReportCollaborator) {
      return `Ficha pronta para ${selectedReportCollaborator.name}.`;
    }
    if (reportCollaboratorMatches.length > 1) {
      return "Refine a busca para deixar um único colaborador e baixar a ficha.";
    }
    return "Nenhum colaborador encontrado com esse filtro.";
  }, [reportCollaboratorMatches.length, reportCollaboratorTerm, selectedReportCollaborator]);

  const handleDownloadReports = async () => {
    if (reportPdfBusy) return;

    setReportPdfBusy(true);

    try {
      const pdfBytes = await generateReportsPdf({
        generatedAt: new Date(),
        filterLabel: selectedReportCollaborator?.name || reportCollaboratorLabel,
        totals: {
          deliveriesCount: totalDeliveriesThisMonth,
          deliveriesQuantity: totalDeliveryQuantityThisMonth,
          occurrencesCount: totalOccurrencesThisMonth,
          openOccurrencesCount: openOccurrencesThisMonth,
        },
        movementSummary: movementReport,
        topConsumedEpis,
        topSectorConsumption,
        movementItems: movementReport.items,
        logoUrl: brandLogoUrl,
      });

      const blob = new Blob([pdfBytes], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildReportsPdfFilename({
        filterLabel: selectedReportCollaborator?.name || reportCollaboratorLabel,
        generatedAt: new Date(),
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Relatório gerado", "O PDF com os principais indicadores foi baixado.");
    } catch (error) {
      notifyError("Falha ao gerar relatório", error, "Não foi possível criar o PDF do relatório.");
    } finally {
      setReportPdfBusy(false);
    }
  };

  const downloadFichaPdf = async ({ employee, sourceDeliveries, successMessage, errorMessage }) => {
    if (!employee || fichaBusyEmployeeId) return;

    setFichaBusyEmployeeId(employee.id);

    try {
      const pdfBytes = await generateEmployeeFichaPdf({
        employee,
        deliveries: sourceDeliveries,
        epis,
        logoUrl: brandLogoUrl,
      });

      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildEmployeeFichaFilename(employee);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);

      notify("Ficha gerada", successMessage);
    } catch (error) {
      notifyError("Falha ao gerar ficha", error, errorMessage);
    } finally {
      setFichaBusyEmployeeId("");
    }
  };

  const handleDownloadEmployeeFicha = (employee) =>
    downloadFichaPdf({
      employee,
      sourceDeliveries: deliveries,
      successMessage: `PDF da ficha de ${employee.name} foi baixado.`,
      errorMessage: "Não foi possível criar o PDF da ficha do colaborador.",
    });

  const handleDownloadReportFicha = () =>
    downloadFichaPdf({
      employee: selectedReportCollaborator,
      sourceDeliveries: reportDeliveries,
      successMessage: `Histórico de ${selectedReportCollaborator?.name || "colaborador"} baixado em PDF.`,
      errorMessage: "Não foi possível criar a ficha do colaborador a partir dos relatórios.",
    });

  const hasValidReceiptUrl = (value) => Boolean(value && !String(value).includes("TODO-cloud-function-pdf"));

  const resolveDeliveryEmployee = (delivery) => {
    const match = employees.find((employee) => {
      const employeeName = normalizeFieldKey(employee.name);
      const employeeRegistration = normalizeFieldKey(employee.registration);
      const deliveryName = normalizeFieldKey(delivery.employeeName);
      const deliveryRegistration = normalizeFieldKey(delivery.employeeRegistration);

      return (
        (employee.id && employee.id === delivery.employeeId) ||
        (employeeName && employeeName === deliveryName) ||
        (employeeRegistration && employeeRegistration === deliveryRegistration)
      );
    });

    return (
      match || {
        name: delivery.employeeName || "",
        registration: delivery.employeeRegistration || "",
        company: "",
        role: "",
        lotacao: "",
      }
    );
  };

  const persistDeliveryReceipt = async (delivery) => {
    if (!delivery?.id) {
      throw new Error("Entrega inválida para gerar o recibo.");
    }

    const relatedEmployee = resolveDeliveryEmployee(delivery);
    const relatedEpi = epis.find((item) => item.id === delivery.itemId);
    const receiptPayload = {
      receiptPdfPath: `receipts/${delivery.id}.pdf`,
      receiptGeneratedAt: new Date().toISOString(),
      receiptGeneratedBy: authUser?.uid || null,
    };

    const receiptPdfBytes = await generateDeliveryReceiptPdf({
      employee: relatedEmployee,
      delivery,
      epi: relatedEpi,
      logoUrl: brandLogoUrl,
      signatureUrl: delivery.signatureImageUrl || "",
      signatureDataUrl: delivery.signatureDataUrl || "",
    });

    receiptPayload.receiptPdfUrl = await firebaseApi.uploadPdfBytes(receiptPayload.receiptPdfPath, receiptPdfBytes);

    try {
      await firebaseApi.update("deliveries", delivery.id, receiptPayload);
    } catch (updateError) {
      notifyError(
        "Recibo gerado localmente",
        updateError,
        "O PDF foi criado, mas não foi possível salvar o link no Firestore."
      );
    }

    setDeliveries((prev) =>
      prev.map((item) => (item.id === delivery.id ? { ...item, ...receiptPayload } : item))
    );

    return receiptPayload;
  };

    const handleGenerateReceiptForDelivery = async (delivery) => {
      if (!delivery?.id || receiptBusyDeliveryId) return;

      setReceiptBusyDeliveryId(delivery.id);
    try {
      await persistDeliveryReceipt(delivery);
      notify("Recibo gerado", "O PDF foi salvo no Storage e já pode ser baixado.");
    } catch (error) {
      notifyError(
        "Falha ao gerar recibo",
        error,
        "O sistema não conseguiu criar o PDF do recibo dessa entrega."
      );
    } finally {
        setReceiptBusyDeliveryId("");
      }
    };

  const handleLogout = async () => {
    setAuthBusy(true);
    try {
      await logout();
      notify("Sessão encerrada", "Você saiu do Firebase Auth.");
    } catch (error) {
      notifyError("Falha ao sair", error, "Não foi possível encerrar a sessão.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleApplyWorkspaceUnit = () => {
    const nextWorkspaceUnit = setWorkspaceUnit(workspaceUnitDraft);
    setWorkspaceUnitDraft(nextWorkspaceUnit.workspaceUnitId);
    setExpandedStockItemId("");
    notify(
      "Unidade alterada",
      `O painel agora está limitado a ${nextWorkspaceUnit.workspaceUnitName}.`
    );
  };

  const handleEmployeeCsvImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setEmployeeImportBusy(true);

    try {
      const text = await file.text();
      const cleanedText = text.replace(/^\uFEFF/, "").trim();

      if (!cleanedText) {
        notify("Arquivo vazio", "A planilha não tem conteúdo para importar.", "error");
        return;
      }

      const lines = cleanedText
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .filter((line) => line.trim().length > 0);

      if (lines.length < 2) {
        notify(
          "CSV sem dados",
          "Inclua um cabeçalho com Nome, Empresa, Cargo e Lotação e pelo menos uma linha de colaboradores.",
          "error"
        );
        return;
      }

      const delimiter = detectCsvDelimiter(lines[0]);
      const headers = splitCsvLine(lines[0], delimiter);
      const headerKeys = headers.map(normalizeFieldKey);
      const requiredHeaders = ["nome", "empresa", "cargo", "lotacao"];
      const hasExpectedHeader = requiredHeaders.every((header) => headerKeys.includes(header));

      if (!hasExpectedHeader) {
        notify(
          "Cabeçalho não encontrado",
          "A primeira linha precisa conter Nome, Empresa, Cargo e Lotação.",
          "error"
        );
        return;
      }

      const csvRows = lines.slice(1).map((line) => splitCsvLine(line, delimiter));
      const importedEmployees = [];
      const skippedRows = [];
      const seenKeys = new Set(
        employees.map((employee) =>
          normalizeFieldKey([employee.name, employee.company, employee.role, employee.lotacao].join("|"))
        )
      );

      for (const [rowIndex, row] of csvRows.entries()) {
        const employee = normalizeEmployeeRecord(
          {
            name: getCsvValue(row, headers, ["nome", "colaborador", "funcionario", "funcionarios"]),
            company: getCsvValue(row, headers, ["empresa", "companhia", "razaosocial"]),
            role: getCsvValue(row, headers, ["cargo", "funcao", "ocupacao"]),
            lotacao: getCsvValue(row, headers, ["lotacao", "setor", "departamento", "unidade"]),
            workspaceUnitId: workspaceUnit.workspaceUnitId,
            workspaceUnitName: workspaceUnit.workspaceUnitName,
            registration:
              getCsvValue(row, headers, ["matricula", "registro", "registration"]) ||
              `CSV-${String(rowIndex + 1).padStart(3, "0")}`,
            status: "Ativo",
          },
          importedEmployees.length
        );

        const key = normalizeFieldKey([employee.name, employee.company, employee.role, employee.lotacao].join("|"));
        if (!employee.name || seenKeys.has(key)) {
          skippedRows.push(rowIndex + 2);
          continue;
        }

        seenKeys.add(key);
        importedEmployees.push(employee);
      }

      if (!importedEmployees.length) {
        notify(
          "Nada para importar",
          skippedRows.length
            ? "Todas as linhas estavam vazias ou duplicadas."
            : "Nenhuma linha válida foi encontrada na planilha.",
          "error"
        );
        return;
      }

      const createdEmployees = [];
      for (const employee of importedEmployees) {
        const created = await firebaseApi.create("employees", employee);
        createdEmployees.push(normalizeEmployeeRecord(created, createdEmployees.length));
      }

      setEmployees((prev) => [...createdEmployees, ...prev]);
      notify(
        "Planilha importada",
        `${createdEmployees.length} colaboradores adicionados${skippedRows.length ? `, ${skippedRows.length} linha(s) ignorada(s)` : ""}.`
      );
    } catch (error) {
      notifyError("Falha ao importar planilha", error, "Verifique se o CSV tem as colunas Nome, Empresa, Cargo e Lotação.");
    } finally {
      setEmployeeImportBusy(false);
    }
  };

  const addEmployee = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        name: employeeForm.name.trim(),
        company: employeeForm.company.trim(),
        sector: employeeForm.lotacao.trim(),
        lotacao: employeeForm.lotacao.trim(),
        role: employeeForm.role.trim(),
        registration: `EMP-${Date.now()}`,
        workspaceUnitId: workspaceUnit.workspaceUnitId,
        workspaceUnitName: workspaceUnit.workspaceUnitName,
        status: employeeForm.status,
      };
      const created = await firebaseApi.create("employees", payload);
      setEmployees((prev) => [normalizeEmployeeRecord(created, 0), ...prev]);
      setEmployeeForm({ name: "", company: "", lotacao: "", role: "", status: "Ativo" });
      notify("Colaborador cadastrado", "Registro incluído com sucesso.");
    } catch (error) {
      notifyError("Falha ao cadastrar colaborador", error, "Não foi possível salvar no Firebase.");
    }
  };

  const addEpi = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        name: epiForm.name,
        caNumber: epiForm.caNumber,
        category: epiForm.category,
        unit: epiForm.unit,
        minimumStock: Number(epiForm.minimumStock || 0),
        workspaceUnitId: workspaceUnit.workspaceUnitId,
        workspaceUnitName: workspaceUnit.workspaceUnitName,
        active: editingEpi?.active ?? true,
      };

      if (epiEditId) {
        const updated = await firebaseApi.update("epi_items", epiEditId, payload);
        setEpis((prev) =>
          prev.map((item) =>
            item.id === epiEditId
              ? {
                  ...item,
                  ...payload,
                  stock: item.stock,
                }
              : item
          )
        );
        setEpiEditId("");
        setEpiForm(emptyEpiForm);
        notify("EPI atualizado", "As informações do item cadastrado foram alteradas.");
        return updated;
      }

      const created = await firebaseApi.create("epi_items", {
        ...payload,
        stock: Number(epiForm.stock || 0),
        active: true,
      });
      setEpis((prev) => [attachWorkspaceUnitContext(created), ...prev]);
      setEpiForm(emptyEpiForm);
      notify("EPI cadastrado", "Item incluído com estoque inicial.");
    } catch (error) {
      notifyError(
        epiEditId ? "Falha ao atualizar EPI" : "Falha ao cadastrar EPI",
        error,
        "Não foi possível salvar o item no Firebase."
      );
    }
  };

  const handleStartEditEpi = (item) => {
    if (!item) return;

    setEpiEditId(item.id);
    setEpiForm({
      name: item.name || "",
      caNumber: item.caNumber || "",
      category: item.category || "",
      unit: item.unit || "un",
      minimumStock: String(item.minimumStock ?? ""),
      stock: String(item.stock ?? ""),
    });
  };

  const handleCancelEditEpi = () => {
    setEpiEditId("");
    setEpiForm(emptyEpiForm);
  };

  const addOccurrence = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        ...occurrenceForm,
        status: "Aberta",
        workspaceUnitId: workspaceUnit.workspaceUnitId,
        workspaceUnitName: workspaceUnit.workspaceUnitName,
        createdAt: formatDateTimePtBr(new Date()),
      };
      const created = await firebaseApi.create("occurrences", payload);
      setOccurrences((prev) => [attachWorkspaceUnitContext(created), ...prev]);
      setOccurrenceForm({ type: "Ocorrência", title: "", sector: "", severity: "Baixa", description: "" });
      notify("Ocorrência registrada", "A ocorrência foi salva para acompanhamento.");
    } catch (error) {
      notifyError("Falha ao registrar ocorrência", error, "Não foi possível salvar a ocorrência no Firebase.");
    }
  };

  const addStockEntry = async (event) => {
    event.preventDefault();
    try {
      const epi = epis.find((item) => item.id === stockEntryForm.epiId);
      const qty = Number(stockEntryForm.quantity || 0);
      if (!epi || qty <= 0) {
        notify("Entrada inválida", "Selecione um EPI e informe uma quantidade válida.", "error");
        return;
      }

      const nextStock = Number(epi.stock) + qty;
      const movement = {
        type: "entrada",
        epiId: epi.id,
        epiName: epi.name,
        quantity: qty,
        note: stockEntryForm.note,
        workspaceUnitId: workspaceUnit.workspaceUnitId,
        workspaceUnitName: workspaceUnit.workspaceUnitName,
        createdAt: formatDateTimePtBr(new Date()),
      };

      await firebaseApi.update("epi_items", epi.id, { stock: nextStock });
      const createdMovement = await firebaseApi.create("stock_movements", movement);

      setEpis((prev) => prev.map((item) => (item.id === epi.id ? { ...item, stock: nextStock } : item)));
      setMovements((prev) => [attachWorkspaceUnitContext(createdMovement), ...prev]);
      setStockEntryForm({ epiId: "", quantity: "", note: "" });
      notify("Entrada registrada", `Estoque de ${epi.name} atualizado.`);
    } catch (error) {
      notifyError("Falha ao registrar entrada", error, "Não foi possível atualizar o estoque no Firebase.");
    }
  };

  const startDelivery = (event) => {
    event.preventDefault();
    const epi = epis.find((item) => item.id === deliveryForm.itemId);
    const qty = Number(deliveryForm.quantity || 0);

    if (!epi || qty <= 0) {
      notify("Entrega inválida", "Preencha EPI e quantidade válidos.", "error");
      return;
    }

    if (epi.stock < qty) {
      notify("Estoque insuficiente", `Saldo atual de ${epi.name}: ${epi.stock}.`, "error");
      return;
    }

    if (deliveryAuthMode === "face") {
      const hasFaceEnrollment = employees.some((employee) => {
        const descriptorCount = Array.isArray(employee.faceDescriptors)
          ? employee.faceDescriptors.length
          : Array.isArray(employee.faceDescriptor)
            ? employee.faceDescriptor.length
            : Number(employee.faceEnrollmentCount || 0);
        return descriptorCount > 0;
      });

      if (!hasFaceEnrollment) {
        notify(
          "Cadastro facial ausente",
          "Cadastre pelo menos um colaborador com fotos base antes de usar o reconhecimento facial.",
          "error"
        );
        return;
      }

      setPendingDelivery({
        itemId: epi.id,
        itemName: epi.name,
        quantity: qty,
        note: deliveryForm.note,
        workspaceUnitId: workspaceUnit.workspaceUnitId,
        workspaceUnitName: workspaceUnit.workspaceUnitName,
        createdAt: formatDateTimePtBr(new Date()),
        verificationMethod: "face",
      });
      setDeliveryModalOpen(true);
      return;
    }

    const employee = employees.find((item) => item.id === deliveryForm.employeeId);

    if (!employee) {
      notify("Entrega inválida", "Selecione um colaborador para confirmar por assinatura.", "error");
      return;
    }

    setPendingDelivery({
      employeeId: employee.id,
      employeeName: employee.name,
      employeeRegistration: employee.registration,
      itemId: epi.id,
      itemName: epi.name,
      quantity: qty,
      note: deliveryForm.note,
      workspaceUnitId: workspaceUnit.workspaceUnitId,
      workspaceUnitName: workspaceUnit.workspaceUnitName,
      createdAt: formatDateTimePtBr(new Date()),
      verificationMethod: "signature",
    });
    setDeliveryModalOpen(true);
  };

  const confirmDeliveryWithSignature = async (signatureDataUrl) => {
    if (!pendingDelivery) return;

    try {
      const signatureCapturedAt = new Date().toISOString();
      const createdAtLabel = formatDateTimePtBr(signatureCapturedAt);
      const geoLocation = await captureRequiredBrowserGeolocation();
      const signatureUrl = await firebaseApi.uploadBase64(
        `signatures/${Date.now()}-${pendingDelivery.employeeId}.png`,
        signatureDataUrl
      );

      const currentEpi = epis.find((item) => item.id === pendingDelivery.itemId);
      const nextStock = Number(currentEpi?.stock || 0) - Number(pendingDelivery.quantity || 0);

      const deliveryRecord = {
        ...pendingDelivery,
        workspaceUnitId: pendingDelivery.workspaceUnitId || workspaceUnit.workspaceUnitId,
        workspaceUnitName: pendingDelivery.workspaceUnitName || workspaceUnit.workspaceUnitName,
        signatureStatus: "signed",
        signatureDataUrl,
        signatureImageUrl: signatureUrl,
        signatureCapturedAt,
        geoLocation,
        deliveredBy: "Usuário logado",
        hash: `hash-${Date.now()}`,
        createdAt: createdAtLabel,
      };

      const movement = {
        type: "saida",
        epiId: pendingDelivery.itemId,
        epiName: pendingDelivery.itemName,
        quantity: pendingDelivery.quantity,
        employeeId: pendingDelivery.employeeId,
        employeeName: pendingDelivery.employeeName,
        workspaceUnitId: pendingDelivery.workspaceUnitId || workspaceUnit.workspaceUnitId,
        workspaceUnitName: pendingDelivery.workspaceUnitName || workspaceUnit.workspaceUnitName,
        createdAt: createdAtLabel,
        note: pendingDelivery.note,
      };

      await firebaseApi.update("epi_items", pendingDelivery.itemId, { stock: nextStock });
      const createdDelivery = await firebaseApi.create("deliveries", deliveryRecord);
      const createdMovement = await firebaseApi.create("stock_movements", movement);
      try {
        await registerAuditLog({
          action: "delivery_created",
          entityId: createdDelivery.id,
          employeeId: deliveryRecord.employeeId,
          itemId: deliveryRecord.itemId,
          metadata: {
            workspaceUnitId: pendingDelivery.workspaceUnitId || workspaceUnit.workspaceUnitId,
            workspaceUnitName: pendingDelivery.workspaceUnitName || workspaceUnit.workspaceUnitName,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (auditError) {
        console.warn("Falha ao registrar audit log da entrega com assinatura", auditError);
      }

      setDeliveries((prev) => [attachWorkspaceUnitContext(createdDelivery), ...prev]);
      setMovements((prev) => [attachWorkspaceUnitContext(createdMovement), ...prev]);
      setEpis((prev) =>
        prev.map((item) =>
          item.id === pendingDelivery.itemId ? { ...item, stock: nextStock } : item
        )
      );

      let receiptGenerated = false;
      try {
        await persistDeliveryReceipt({
          ...createdDelivery,
          signatureDataUrl,
          signatureImageUrl: signatureUrl,
          geoLocation,
          signatureStatus: "signed",
        });
        receiptGenerated = true;
      } catch (receiptError) {
        console.error("Falha ao gerar recibo da entrega", receiptError);
      }

      setDeliveryForm({ employeeId: "", itemId: "", quantity: "1", note: "" });
      setDeliveryEmployeeSearch("");
      setPendingDelivery(null);
      setDeliveryModalOpen(false);
      notify(
        "Entrega concluída",
        receiptGenerated
          ? "Saída registrada com assinatura e recibo PDF gerado."
          : "Saída registrada com assinatura. O recibo PDF ficou pendente."
      );
    } catch (error) {
      if (error?.code === DELIVERY_GPS_REQUIRED_ERROR) {
        notify("GPS obrigatório", error.message, "error");
        return;
      }

      notifyError("Falha ao concluir entrega", error, "A entrega não pôde ser salva no Firebase.");
    }
  };

  const confirmDeliveryWithFace = async ({
    employee,
    collaboratorUid,
    faceBadgeDataUrl,
    faceVerifiedAt,
    faceMatchDistance,
  }) => {
    if (!pendingDelivery || !employee?.id) return;

    try {
      const geoLocation = await captureRequiredBrowserGeolocation();
      const finalizeResult = await finalizeFaceDelivery({
        pendingDelivery,
        employee,
        collaboratorUid,
        faceBadgeDataUrl,
        faceVerifiedAt,
        faceMatchDistance,
        deliveredBy: authUser?.displayName || authUser?.email || "Usuário logado",
        geoLocation,
      });

      const createdDelivery = finalizeResult?.data?.delivery || null;
      const createdMovement = finalizeResult?.data?.movement || null;
      const nextStock = Number(finalizeResult?.data?.nextStock);

      if (!createdDelivery?.id || !createdMovement?.id || Number.isNaN(nextStock)) {
        throw new Error("A função de entrega por face não retornou os dados esperados.");
      }

      setDeliveries((prev) => [attachWorkspaceUnitContext(createdDelivery), ...prev]);
      setMovements((prev) => [attachWorkspaceUnitContext(createdMovement), ...prev]);
      setEpis((prev) =>
        prev.map((item) =>
          item.id === pendingDelivery.itemId ? { ...item, stock: nextStock } : item
        )
      );

      let receiptGenerated = false;
      try {
        await persistDeliveryReceipt({
          ...createdDelivery,
          signatureStatus: "face_verified",
          verificationMethod: "face",
        });
        receiptGenerated = true;
      } catch (receiptError) {
        console.error("Falha ao gerar recibo da entrega por face", receiptError);
      } finally {
        try {
          await logoutCollaborator();
        } catch (logoutError) {
          console.warn("Não foi possível encerrar a sessão facial temporária", logoutError);
        }
      }

      setDeliveryForm({ employeeId: "", itemId: "", quantity: "1", note: "" });
      setDeliveryEmployeeSearch("");
      setPendingDelivery(null);
      setDeliveryModalOpen(false);
      setDeliveryAuthMode("signature");
      notify(
        "Entrega concluída por face",
        receiptGenerated
          ? "O colaborador foi autenticado por reconhecimento facial e o recibo PDF foi gerado."
          : "O colaborador foi autenticado por reconhecimento facial, mas o recibo PDF ficou pendente."
      );
    } catch (error) {
      if (error?.code === DELIVERY_GPS_REQUIRED_ERROR) {
        notify("GPS obrigatório", error.message, "error");
        try {
          await logoutCollaborator();
        } catch {
          // Ignora falha ao limpar a sessão facial.
        }
        throw error;
      }

      notifyError(
        "Falha ao concluir entrega por face",
        error,
        "A autenticação facial ocorreu, mas a entrega não pôde ser salva no Firebase."
      );
      try {
        await logoutCollaborator();
      } catch {
        // Ignora falha ao limpar a sessão facial.
      }
      throw error;
    }
  };

  const handleDeliveryEmployeeSearchChange = (value) => {
    setDeliveryEmployeeSearch(value);
    setDeliveryForm((prev) => (prev.employeeId ? { ...prev, employeeId: "" } : prev));
  };

  const handleDeliveryEmployeeSearchKeyDown = (event) => {
    if (event.key !== "Enter") {
      return;
    }

    if (!deliveryEmployeeSuggestions.length) {
      return;
    }

    event.preventDefault();
    handleDeliveryEmployeeSuggestionSelect(deliveryEmployeeSuggestions[0]);
  };

  const handleDeliveryEmployeeSuggestionSelect = (employee) => {
    if (!employee) return;

    setDeliveryEmployeeSearch(employee.name || "");
    setDeliveryForm((prev) => ({
      ...prev,
      employeeId: employee.id,
    }));
  };

  const handleDeliveryEmployeeSelectChange = (employeeId) => {
    const employee = employees.find((item) => item.id === employeeId);

    setDeliveryForm((prev) => ({
      ...prev,
      employeeId,
    }));
    setDeliveryEmployeeSearch(employee?.name || "");
  };

  const handleOpenFaceEnrollment = (employee) => {
    setFaceEnrollmentEmployee(employee || null);
    setFaceEnrollmentOpen(true);
  };

  const handleDeliveryModalOpenChange = (nextOpen) => {
    setDeliveryModalOpen(nextOpen);

    if (!nextOpen) {
      setPendingDelivery(null);
      setDeliveryAuthMode("signature");
      void logoutCollaborator().catch(() => {});
    }
  };

  const handleFaceEnrollmentSaved = ({ employeeId, payload, descriptorsCount }) => {
    setEmployees((prev) =>
      prev.map((employee) =>
        employee.id === employeeId
          ? {
              ...employee,
              ...payload,
              faceDescriptors: payload?.faceDescriptors || employee.faceDescriptors || [],
              faceEnrollmentCount:
                Number(descriptorsCount || payload?.faceEnrollmentCount || employee.faceEnrollmentCount || 0),
              faceEnrolledAt: payload?.faceEnrolledAt || employee.faceEnrolledAt || "",
            }
          : employee
      )
    );

    notify(
      "Cadastro facial atualizado",
      "O colaborador agora pode ser autenticado por reconhecimento facial."
    );
  };

  const handleToggleStockItem = (itemId) => {
    setExpandedStockItemId((current) => (current === itemId ? "" : itemId));
  };

  const removeOccurrence = async (id) => {
    try {
      if (canPersistOccurrences) {
        await firebaseApi.remove("occurrences", id);
      }
      setOccurrences((prev) => prev.filter((item) => item.id !== id));
      notify(
        "Ocorrência removida",
        canPersistOccurrences ? "Registro excluído do Firebase." : "Registro excluído da lista local."
      );
    } catch (error) {
      setOccurrences((prev) => prev.filter((item) => item.id !== id));
      notifyError(
        "Ocorrência removida localmente",
        error,
        "Não foi possível sincronizar a exclusão no Firebase."
      );
    }
  };

  const dashboardCards = [
    {
      title: "Colaboradores",
      value: employees.length,
      helper: "Base cadastrada no sistema",
      icon: UserCheck,
    },
    {
      title: "EPIs cadastrados",
      value: epis.length,
      helper: "Itens ativos para controle",
      icon: Package,
    },
    {
      title: "Estoque mínimo",
      value: lowStockCount,
      helper: lowStockCount > 0 ? "Itens exigindo reposição" : "Sem alertas no momento",
      icon: TriangleAlert,
      alert: lowStockCount > 0,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-3xl border bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-[76px] w-[124px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-slate-50 shadow-sm">
              <img
                src={brandLogoUrl}
                alt="Logo do Sistema SST"
                className="h-full w-full object-contain"
                loading="eager"
              />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Sistema SST • EPI</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Painel web responsivo com estoque, ocorrências, entrega de EPI e assinatura na tela.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Projeto Firebase: <strong>seguranca-do-trabalho-254f5</strong>
              </p>
            </div>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-4 shadow-sm">
            {authReady ? (
              authUser ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                      {authDisplayInitial}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{authDisplayName}</p>
                      <p className="text-xs text-muted-foreground">Sessão Firebase ativa</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="rounded-xl px-3 py-2">
                    Conectado
                  </Badge>
                  <div className="rounded-2xl border bg-white p-4 shadow-sm">
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Filial ativa</p>
                        <p className="mt-1 font-semibold">{workspaceUnit.workspaceUnitName}</p>
                      </div>
                      <Label htmlFor="workspace-unit-switch">Trocar filial</Label>
                      <select
                        id="workspace-unit-switch"
                        value={workspaceUnitDraft}
                        onChange={(event) => setWorkspaceUnitDraft(event.target.value)}
                        className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none ring-offset-white focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {WORKSPACE_UNIT_OPTIONS.map((unit) => (
                          <option key={unit.value} value={unit.value}>
                            {unit.label}
                          </option>
                        ))}
                      </select>
                      <Button type="button" variant="outline" className="w-full" onClick={handleApplyWorkspaceUnit}>
                        Aplicar unidade
                      </Button>
                    </div>
                  </div>
                  <Button type="button" variant="outline" className="w-full" onClick={handleLogout} disabled={authBusy}>
                    {authBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
                    Sair
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Badge variant="outline" className="rounded-xl px-3 py-2">
                    Redirecionando para login
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    Você será enviado para a página de acesso em instantes.
                  </p>
                </div>
              )
            ) : (
              <div className="space-y-3">
                <Badge variant="outline" className="rounded-xl px-3 py-2">
                  Verificando sessão
                </Badge>
                <p className="text-sm text-muted-foreground">Aguarde enquanto o Firebase Auth responde.</p>
              </div>
            )}
          </div>
        </div>

        {authReady && authUser && isBootstrapping && (
          <Alert className="rounded-2xl border-blue-300">
            <FileText className="h-4 w-4" />
            <AlertTitle>Carregando dados da filial</AlertTitle>
            <AlertDescription>Buscando colaboradores, EPI, ocorrências, entregas e movimentações da unidade ativa.</AlertDescription>
          </Alert>
        )}

        {message && (
          <Alert className={cn("rounded-2xl", message.kind === "error" ? "border-red-300" : "border-green-300")}>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        )}

        {!authReady ? (
          <Alert className="rounded-2xl border-blue-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Verificando sessão</AlertTitle>
            <AlertDescription>Aguarde enquanto o Firebase Auth valida o acesso.</AlertDescription>
          </Alert>
        ) : authUser ? (
          <>
        <div className="grid gap-4 md:grid-cols-3">
          {dashboardCards.map((card) => (
            <StatCard key={card.title} {...card} />
          ))}
        </div>

        <Tabs defaultValue="dashboard" className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-2xl bg-transparent p-0">
            {PANEL_TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="rounded-2xl px-4 py-2.5"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="dashboard">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="rounded-2xl lg:col-span-2">
                <CardHeader>
                  <CardTitle>Últimas entregas</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Colaborador</TableHead>
                        <TableHead>EPI</TableHead>
                        <TableHead>Qtd.</TableHead>
                        <TableHead>Assinatura</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deliveries.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            Nenhuma entrega registrada.
                          </TableCell>
                        </TableRow>
                      ) : (
                        deliveries.slice(0, 5).map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>{item.employeeName}</TableCell>
                            <TableCell>{item.itemName}</TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{item.signatureStatus}</Badge>
                            </TableCell>
                            <TableCell>{item.createdAt}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Alertas rápidos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {epis.filter((item) => item.stock <= item.minimumStock).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sem itens abaixo do mínimo.</p>
                  ) : (
                    epis
                      .filter((item) => item.stock <= item.minimumStock)
                      .map((item) => (
                        <div key={item.id} className="rounded-2xl border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{item.name}</span>
                            <Badge variant="destructive">Baixo estoque</Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Saldo: {item.stock} • Mínimo: {item.minimumStock}
                          </p>
                        </div>
                      ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="colaboradores">
            <div className="grid gap-4 lg:grid-cols-[360px,1fr]">
              <div className="space-y-4">
                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle>Importar planilha CSV</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-2xl border bg-slate-50 p-4">
                      <p className="text-sm font-medium">Colunas esperadas</p>
                      <p className="mt-1 text-sm text-muted-foreground">Nome, Empresa, Cargo e Lotação</p>
                    </div>
                    <Input
                      type="file"
                      accept=".csv,text/csv,.txt"
                      onChange={handleEmployeeCsvImport}
                      disabled={employeeImportBusy}
                    />
                    <p className="text-xs text-muted-foreground">
                      Delimitador aceito: ponto e vírgula ou vírgula. A primeira linha precisa ser o cabeçalho.
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle>Novo colaborador</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-4" onSubmit={addEmployee}>
                      <div className="space-y-2">
                        <Label>Nome</Label>
                        <Input
                          value={employeeForm.name}
                          onChange={(e) => setEmployeeForm((prev) => ({ ...prev, name: e.target.value }))}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Empresa</Label>
                        <Input
                          value={employeeForm.company}
                          onChange={(e) => setEmployeeForm((prev) => ({ ...prev, company: e.target.value }))}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Cargo</Label>
                        <Input
                          value={employeeForm.role}
                          onChange={(e) => setEmployeeForm((prev) => ({ ...prev, role: e.target.value }))}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Lotação</Label>
                        <Input
                          value={employeeForm.lotacao}
                          onChange={(e) => setEmployeeForm((prev) => ({ ...prev, lotacao: e.target.value }))}
                          required
                        />
                      </div>
                      <Button className="w-full" type="submit">
                        <Plus className="mr-2 h-4 w-4" />
                        Salvar colaborador
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        A matrícula é gerada automaticamente no cadastro.
                      </p>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Lista de colaboradores</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Buscar por nome, empresa, cargo ou lotação..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <ScrollArea className="h-[460px] pr-4">
                    <div className="space-y-3">
                      {filteredEmployees.map((item) => (
                        <div key={item.id} className="rounded-2xl border p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">{item.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {item.company || "Sem empresa"} • {item.role || "Sem cargo"} • {item.lotacao || "Sem lotação"}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">{item.status}</Badge>
                              <Badge variant={item.faceDescriptors?.length ? "secondary" : "outline"}>
                                {item.faceDescriptors?.length ? `Face ${item.faceEnrollmentCount || item.faceDescriptors.length}` : "Face pendente"}
                              </Badge>
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                onClick={() => handleOpenFaceEnrollment(item)}
                              >
                                <Camera className="h-4 w-4" />
                                <span>Cadastro facial</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                onClick={() => void handleDownloadEmployeeFicha(item)}
                                disabled={fichaBusyEmployeeId === item.id}
                              >
                                {fichaBusyEmployeeId === item.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Download className="h-4 w-4" />
                                )}
                                <span>Ficha PDF</span>
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="epis">
            <div className="grid gap-4 xl:grid-cols-[380px,380px,1fr]">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>{isEditingEpi ? "Editar EPI" : "Novo EPI"}</CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditingEpi ? (
                    <Alert className="mb-4 rounded-2xl border-sky-200 bg-sky-50/60">
                      <PencilLine className="h-4 w-4" />
                      <AlertTitle>Editando EPI cadastrado</AlertTitle>
                      <AlertDescription>
                        O saldo atual não é alterado aqui. Use a entrada de estoque para ajustar quantidade.
                      </AlertDescription>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={handleCancelEditEpi}>
                          Cancelar edição
                        </Button>
                      </div>
                    </Alert>
                  ) : null}
                  <form className="space-y-4" onSubmit={addEpi}>
                    <div className="space-y-2">
                      <Label>Descrição</Label>
                      <Input value={epiForm.name} onChange={(e) => setEpiForm((prev) => ({ ...prev, name: e.target.value }))} required />
                    </div>
                    <div className="space-y-2">
                      <Label>CA</Label>
                      <Input value={epiForm.caNumber} onChange={(e) => setEpiForm((prev) => ({ ...prev, caNumber: e.target.value }))} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Categoria</Label>
                      <Input value={epiForm.category} onChange={(e) => setEpiForm((prev) => ({ ...prev, category: e.target.value }))} required />
                    </div>
                    <div className={cn("grid gap-3", isEditingEpi ? "grid-cols-1" : "grid-cols-2")}>
                      <div className="space-y-2">
                        <Label>Unidade</Label>
                        <Input value={epiForm.unit} onChange={(e) => setEpiForm((prev) => ({ ...prev, unit: e.target.value }))} />
                      </div>
                      {isEditingEpi ? (
                        <div className="rounded-2xl border bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo atual</p>
                          <p className="mt-1 font-medium">
                            {editingEpi?.stock ?? 0} {editingEpi?.unit || epiForm.unit || "un"}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Ajuste o estoque pela entrada de estoque, não por esta edição.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label>Estoque inicial</Label>
                          <Input
                            type="number"
                            value={epiForm.stock}
                            onChange={(e) => setEpiForm((prev) => ({ ...prev, stock: e.target.value }))}
                          />
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Estoque mínimo</Label>
                      <Input type="number" value={epiForm.minimumStock} onChange={(e) => setEpiForm((prev) => ({ ...prev, minimumStock: e.target.value }))} />
                    </div>
                    <Button className="w-full" type="submit">
                      {isEditingEpi ? "Salvar alterações" : "Salvar EPI"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Entrada de estoque</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={addStockEntry}>
                    <div className="space-y-2">
                      <Label>EPI</Label>
                      <select
                        className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={stockEntryForm.epiId}
                        onChange={(e) => setStockEntryForm((prev) => ({ ...prev, epiId: e.target.value }))}
                      >
                        <option value="">Selecione</option>
                        {epis.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Quantidade</Label>
                      <Input type="number" value={stockEntryForm.quantity} onChange={(e) => setStockEntryForm((prev) => ({ ...prev, quantity: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Observação</Label>
                      <Textarea value={stockEntryForm.note} onChange={(e) => setStockEntryForm((prev) => ({ ...prev, note: e.target.value }))} />
                    </div>
                    <Button className="w-full" type="submit">Lançar entrada</Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Itens e saldo</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[280px] pr-4">
                    <div className="space-y-3">
                      {epis.length === 0 ? (
                        <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">
                          Nenhum EPI cadastrado.
                        </div>
                      ) : (
                        epis.map((item) => {
                          const isExpanded = expandedStockItemId === item.id;
                          const isLowStock = Number(item.stock || 0) <= Number(item.minimumStock || 0);

                          return (
                            <div key={item.id} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-50"
                                onClick={() => handleToggleStockItem(item.id)}
                              >
                                <div className="min-w-0">
                                  <p className="font-medium text-slate-900">{item.name}</p>
                                  <p className="text-xs text-muted-foreground">{item.category || "Sem categoria"}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                                  <span className={cn("rounded-full border px-2 py-1 text-xs font-medium", isLowStock && "border-red-200 bg-red-50 text-red-700")}>
                                    {isLowStock ? "Saldo baixo" : "Saldo ok"}
                                  </span>
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </div>
                              </button>

                              {isExpanded ? (
                                <div className="border-t bg-slate-50 px-4 py-4">
                                  <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-xl border bg-white p-3">
                                      <p className="text-xs uppercase tracking-wide text-muted-foreground">CA</p>
                                      <p className="mt-1 font-medium">{item.caNumber || "N/D"}</p>
                                    </div>
                                    <div className="rounded-xl border bg-white p-3">
                                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo</p>
                                      <p className={cn("mt-1 font-medium", isLowStock && "text-red-600")}>
                                        {item.stock} {item.unit}
                                      </p>
                                    </div>
                                    <div className="rounded-xl border bg-white p-3">
                                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Mínimo</p>
                                      <p className="mt-1 font-medium">{item.minimumStock}</p>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleStartEditEpi(item)}
                                    >
                                      <PencilLine className="h-4 w-4" />
                                      Editar cadastro
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="entregas">
              <div className="grid gap-4 lg:grid-cols-[420px,1fr]">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Nova entrega de EPI</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={startDelivery}>
                    <div className="space-y-2">
                      <Label>Modo de confirmação</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={deliveryAuthMode === "signature" ? "default" : "outline"}
                          onClick={() => setDeliveryAuthMode("signature")}
                        >
                          Assinatura
                        </Button>
                        <Button
                          type="button"
                          variant={deliveryAuthMode === "face" ? "default" : "outline"}
                          onClick={() => setDeliveryAuthMode("face")}
                        >
                          Face
                        </Button>
                      </div>
                    </div>

                    {deliveryAuthMode === "signature" ? (
                      <>
                        <div className="space-y-2">
                          <Label>Buscar colaborador</Label>
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              className="pl-9"
                              placeholder="Buscar por nome, empresa, cargo ou lotação..."
                              value={deliveryEmployeeSearch}
                              onChange={(e) => handleDeliveryEmployeeSearchChange(e.target.value)}
                              onKeyDown={handleDeliveryEmployeeSearchKeyDown}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Você pode digitar nome parcial, sobrenome, matrícula ou palavras fora de ordem.
                          </p>
                          {deliveryEmployeeSearch.trim() && selectedDeliveryEmployee ? null : deliveryEmployeeSuggestions.length > 0 ? (
                            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                              <ScrollArea className="max-h-56">
                                <div className="divide-y">
                                  {deliveryEmployeeSuggestions.map((employee) => (
                                    <button
                                      key={employee.id}
                                      type="button"
                                      className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition hover:bg-slate-50"
                                      onClick={() => handleDeliveryEmployeeSuggestionSelect(employee)}
                                    >
                                      <span className="text-sm font-medium text-slate-900">{employee.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {employee.registration || "Sem matrícula"} • {employee.company || "Sem empresa"} •{" "}
                                        {employee.lotacao || employee.sector || "Sem lotação"}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </ScrollArea>
                            </div>
                          ) : deliveryEmployeeSearch.trim() ? (
                            <p className="text-xs text-muted-foreground">Nenhum colaborador encontrado.</p>
                          ) : null}
                        </div>
                        <div className="space-y-2">
                          <Label>Colaborador</Label>
                          <select
                            className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                            value={deliveryForm.employeeId}
                            onChange={(e) => handleDeliveryEmployeeSelectChange(e.target.value)}
                          >
                            <option value="">Selecione</option>
                            {filteredDeliveryEmployees.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} • {item.company || "Sem empresa"} • {item.lotacao || "Sem lotação"}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    ) : (
                      <Alert className="rounded-2xl border-blue-200">
                        <UserCheck className="h-4 w-4" />
                        <AlertTitle>Retirada por face</AlertTitle>
                        <AlertDescription>
                          O colaborador será reconhecido pela câmera e a entrega ficará vinculada ao rosto autenticado.
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-2">
                      <Label>EPI</Label>
                      <select
                        className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={deliveryForm.itemId}
                        onChange={(e) => setDeliveryForm((prev) => ({ ...prev, itemId: e.target.value }))}
                      >
                        <option value="">Selecione</option>
                        {epis.map((item) => (
                          <option key={item.id} value={item.id}>{item.name} • saldo {item.stock}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Quantidade</Label>
                      <Input type="number" min="1" value={deliveryForm.quantity} onChange={(e) => setDeliveryForm((prev) => ({ ...prev, quantity: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Observação</Label>
                      <Textarea value={deliveryForm.note} onChange={(e) => setDeliveryForm((prev) => ({ ...prev, note: e.target.value }))} placeholder="Ex.: troca por desgaste" />
                    </div>
                    <Button className="w-full" type="submit">
                      {deliveryAuthMode === "face" ? <Camera className="mr-2 h-4 w-4" /> : <ClipboardList className="mr-2 h-4 w-4" />}
                      {deliveryAuthMode === "face" ? "Reconhecer colaborador" : "Avançar para assinatura"}
                    </Button>
                  </form>

                  <Separator className="my-6" />

                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p><strong>Biometria:</strong> cadastro facial e validação por câmera já estão disponíveis.</p>
                    <p>As fotos do colaborador viram descritores no Firestore e a entrega pode ser concluída com reconhecimento facial.</p>
                  </div>
                </CardContent>
              </Card>

                <Card className="rounded-2xl">
                  <CardHeader className="space-y-0">
                    <CardTitle>Histórico de entregas e movimentações</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Entregas</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Colaborador</TableHead>
                          <TableHead>EPI</TableHead>
                          <TableHead>Qtd.</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Localização</TableHead>
                          <TableHead>Recibo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {deliveries.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma entrega ainda.</TableCell>
                          </TableRow>
                        ) : (
                          deliveries.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>{item.employeeName}</TableCell>
                            <TableCell>{item.itemName}</TableCell>
                            <TableCell>{item.quantity}</TableCell>
                            <TableCell>{item.createdAt}</TableCell>
                            <TableCell>
                              {item.geoLocation?.status === "captured" ? (
                                <div className="space-y-1">
                                  <Badge variant="secondary">Capturada</Badge>
                                  <p className="max-w-[190px] text-xs text-muted-foreground">
                                    {formatGeoLocationSummary(item.geoLocation)}
                                  </p>
                                </div>
                              ) : (
                                <Badge variant="outline">
                                  {item.geoLocation?.reason ? "Sem GPS" : "Pendente"}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {hasValidReceiptUrl(item.receiptPdfUrl) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => window.open(item.receiptPdfUrl, "_blank", "noopener,noreferrer")}
                                >
                                  <Download className="h-4 w-4" />
                                  Baixar PDF
                                </Button>
                              ) : item.signatureImageUrl ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleGenerateReceiptForDelivery(item)}
                                  disabled={receiptBusyDeliveryId === item.id}
                                >
                                  {receiptBusyDeliveryId === item.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Download className="h-4 w-4" />
                                  )}
                                  {receiptBusyDeliveryId === item.id ? "Gerando..." : "Gerar PDF"}
                                </Button>
                              ) : (
                                <Badge variant="outline">PDF pendente</Badge>
                              )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Movimentações</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tipo</TableHead>
                          <TableHead>EPI</TableHead>
                          <TableHead>Qtd.</TableHead>
                          <TableHead>Data</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movements.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-muted-foreground">Sem movimentações.</TableCell>
                          </TableRow>
                        ) : (
                          movements.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <Badge variant={item.type === "saida" ? "destructive" : "secondary"}>{item.type}</Badge>
                              </TableCell>
                              <TableCell>{item.epiName}</TableCell>
                              <TableCell>{item.quantity}</TableCell>
                              <TableCell>{item.createdAt}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="ocorrencias">
            <div className="grid gap-4 lg:grid-cols-[400px,1fr]">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Nova ocorrência</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={addOccurrence}>
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <Input value={occurrenceForm.type} onChange={(e) => setOccurrenceForm((prev) => ({ ...prev, type: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Título</Label>
                      <Input value={occurrenceForm.title} onChange={(e) => setOccurrenceForm((prev) => ({ ...prev, title: e.target.value }))} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Setor</Label>
                      <Input value={occurrenceForm.sector} onChange={(e) => setOccurrenceForm((prev) => ({ ...prev, sector: e.target.value }))} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Gravidade</Label>
                      <Input value={occurrenceForm.severity} onChange={(e) => setOccurrenceForm((prev) => ({ ...prev, severity: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Descrição</Label>
                      <Textarea value={occurrenceForm.description} onChange={(e) => setOccurrenceForm((prev) => ({ ...prev, description: e.target.value }))} required />
                    </div>
                    <Button className="w-full" type="submit">
                      <TriangleAlert className="mr-2 h-4 w-4" />
                      Registrar ocorrência
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle>Ocorrências registradas</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {occurrences.map((item) => (
                      <div key={item.id} className="rounded-2xl border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold">{item.title}</p>
                              <Badge variant="secondary">{item.type}</Badge>
                              <Badge variant="outline">{item.severity}</Badge>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {item.sector} • {item.createdAt}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Badge>{item.status}</Badge>
                            <Button size="icon" variant="outline" onClick={() => removeOccurrence(item.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <p className="mt-3 text-sm">{item.description}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="relatorios">
            <div className="space-y-6">
              <Card className="rounded-2xl border-dashed bg-white/70">
                <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full border bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      <BarChart3 className="h-3.5 w-3.5" />
                      Relatórios
                    </div>
                    <h2 className="text-2xl font-semibold tracking-tight">Visão gerencial e movimentações</h2>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                      Mês atual: {new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date())}.
                      Top 10 e histórico por item consideram {reportCollaboratorSearch.trim() ? `o colaborador ${reportCollaboratorLabel}` : "todas as entregas e movimentações registradas"}.
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit rounded-full px-3 py-1">
                    Atualizado em tempo real
                  </Badge>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-3 flex-1">
                    <div className="space-y-2">
                      <Label>Buscar relatório por colaborador</Label>
                      <div className="relative max-w-2xl">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          className="pl-9"
                          placeholder="Nome, matrícula, empresa, cargo ou lotação"
                          value={reportCollaboratorSearch}
                          onChange={(e) => setReportCollaboratorSearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        O filtro atua sobre entregas, consumo e movimentações vinculadas ao colaborador. Ocorrências continuam no recorte mensal.
                      </p>
                      {reportCollaboratorTerm ? (
                        <p className={cn("text-xs", selectedReportCollaborator ? "text-emerald-700" : "text-amber-700")}>
                          {reportFichaSelectionMessage}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-3 lg:w-auto">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full lg:w-auto"
                      onClick={() => void handleDownloadReports()}
                      disabled={reportPdfBusy}
                    >
                      {reportPdfBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                      {reportPdfBusy ? "Gerando..." : "Baixar relatório em PDF"}
                    </Button>
                    <Button
                      type="button"
                      className="w-full lg:w-auto"
                      onClick={() => void handleDownloadReportFicha()}
                      disabled={!selectedReportCollaborator || fichaBusyEmployeeId === selectedReportCollaborator.id}
                    >
                      {fichaBusyEmployeeId === selectedReportCollaborator?.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <FileText className="mr-2 h-4 w-4" />
                      )}
                      Baixar ficha do colaborador
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">Relatório gerencial</h3>
                    <p className="text-sm text-muted-foreground">
                      Entregas e ocorrências do mês, com rankings consolidados por consumo.
                    </p>
                  </div>
                  <Badge variant="secondary">Mês atual</Badge>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <StatCard
                    title="Total de entregas no mês"
                    value={formatCount(totalDeliveriesThisMonth)}
                    icon={ClipboardList}
                    helper={`${formatCount(totalDeliveryQuantityThisMonth)} itens distribuídos`}
                  />
                  <StatCard
                    title="Total de ocorrências no mês"
                    value={formatCount(totalOccurrencesThisMonth)}
                    icon={TriangleAlert}
                    helper={openOccurrencesThisMonth > 0 ? `${formatCount(openOccurrencesThisMonth)} em aberto` : "Nenhuma ocorrência aberta"}
                    alert={openOccurrencesThisMonth > 0}
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Card className="rounded-2xl">
                    <CardHeader>
                      <CardTitle>Top 10 EPIs mais consumidos</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[340px] pr-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>#</TableHead>
                              <TableHead>EPI</TableHead>
                              <TableHead>Qtd.</TableHead>
                              <TableHead>Entregas</TableHead>
                              <TableHead>Colabs.</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {topConsumedEpis.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} className="text-center text-muted-foreground">
                                  Nenhuma entrega registrada ainda.
                                </TableCell>
                              </TableRow>
                            ) : (
                              topConsumedEpis.map((item, index) => (
                                <TableRow key={item.id}>
                                  <TableCell>
                                    <Badge variant="secondary">#{index + 1}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div>
                                      <p className="font-medium">{item.itemName}</p>
                                      <p className="text-xs text-muted-foreground">{item.category}</p>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {formatCount(item.quantity)} {item.unit}
                                  </TableCell>
                                  <TableCell>{formatCount(item.deliveriesCount)}</TableCell>
                                  <TableCell>{formatCount(item.employees.size)}</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Factory className="h-4 w-4" />
                        Setores com maior consumo
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[340px] pr-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Setor</TableHead>
                              <TableHead>Qtd.</TableHead>
                              <TableHead>Entregas</TableHead>
                              <TableHead>Colabs.</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {topSectorConsumption.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground">
                                  Nenhuma entrega registrada ainda.
                                </TableCell>
                              </TableRow>
                            ) : (
                              topSectorConsumption.map((item) => (
                                <TableRow key={item.sector}>
                                  <TableCell>{item.sector}</TableCell>
                                  <TableCell>{formatCount(item.quantity)}</TableCell>
                                  <TableCell>{formatCount(item.deliveriesCount)}</TableCell>
                                  <TableCell>{formatCount(item.employees.size)}</TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">Relatório de movimentações</h3>
                    <p className="text-sm text-muted-foreground">
                      Entradas no estoque, saídas por entrega, ajustes manuais e histórico por item.
                    </p>
                  </div>
                  <Badge variant="secondary">Consolidado do estoque</Badge>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <StatCard
                    title="Entradas no estoque"
                    value={formatCount(movementReport.entriesQuantity)}
                    icon={ArrowDownToLine}
                    helper={`${formatCount(movementReport.entriesCount)} registros`}
                  />
                  <StatCard
                    title="Saídas por entrega"
                    value={formatCount(movementReport.exitsQuantity)}
                    icon={ArrowUpToLine}
                    helper={`${formatCount(movementReport.exitsCount)} entregas`}
                  />
                  <StatCard
                    title="Ajustes manuais"
                    value={formatCount(movementReport.adjustmentsCount)}
                    icon={Layers3}
                    helper={
                      movementReport.adjustmentsQuantity !== 0
                        ? `${formatCount(movementReport.adjustmentsQuantity)} unidades informadas`
                        : "Nenhum ajuste manual registrado"
                    }
                  />
                </div>

                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle>Histórico por item</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[420px] pr-4">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>EPI</TableHead>
                            <TableHead>Categoria</TableHead>
                            <TableHead>Entradas</TableHead>
                            <TableHead>Saídas</TableHead>
                            <TableHead>Ajustes</TableHead>
                            <TableHead>Saldo atual</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {movementReport.items.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-muted-foreground">
                                Nenhum movimento registrado ainda.
                              </TableCell>
                            </TableRow>
                          ) : (
                            movementReport.items.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <div>
                                    <p className="font-medium">{item.name}</p>
                                    <p className="text-xs text-muted-foreground">{item.unit}</p>
                                  </div>
                                </TableCell>
                                <TableCell>{item.category}</TableCell>
                                <TableCell>{formatCount(item.entriesQuantity)}</TableCell>
                                <TableCell>{formatCount(item.exitsQuantity)}</TableCell>
                                <TableCell>{formatCount(item.adjustmentsCount)}</TableCell>
                                <TableCell>
                                  {item.currentStock === null || item.currentStock === undefined
                                    ? "N/D"
                                    : formatCount(item.currentStock)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </section>
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={deliveryModalOpen} onOpenChange={handleDeliveryModalOpenChange}>
          <DialogContent className="max-w-[860px] rounded-3xl">
            <DialogHeader>
              <DialogTitle>
                {deliveryAuthMode === "face" ? "Reconhecimento facial do colaborador" : "Assinatura do colaborador"}
              </DialogTitle>
            </DialogHeader>
            {pendingDelivery && (
              <div className="space-y-5">
                <div className="grid gap-3 rounded-2xl border p-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Colaborador</p>
                    <p className="font-medium">{pendingDelivery.employeeName || "A identificar por face"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Matrícula</p>
                    <p className="font-medium">{pendingDelivery.employeeRegistration || "Será detectada na leitura facial"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">EPI</p>
                    <p className="font-medium">{pendingDelivery.itemName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Quantidade</p>
                    <p className="font-medium">{pendingDelivery.quantity}</p>
                  </div>
                </div>

                <Alert className="rounded-2xl border-amber-300">
                  <FileText className="h-4 w-4" />
                  <AlertTitle>Fluxo do recibo</AlertTitle>
                  <AlertDescription>
                    {deliveryAuthMode === "face"
                      ? "Após a leitura facial, a entrega é gravada, o estoque é baixado e o comprovante PDF é gerado automaticamente."
                      : "Após confirmar a assinatura, a entrega é gravada, o estoque é baixado e o comprovante PDF é gerado automaticamente."}
                  </AlertDescription>
                </Alert>

                <Alert className="rounded-2xl border-sky-200 bg-sky-50/60">
                  <MapPin className="h-4 w-4" />
                  <AlertTitle>Geolocalização</AlertTitle>
                  <AlertDescription>
                    O GPS é obrigatório para concluir a saída. A localização do aparelho será capturada no momento da
                    confirmação e ficará salva no histórico e na ficha do colaborador.
                  </AlertDescription>
                </Alert>

                {deliveryAuthMode === "face" ? (
                  <FaceVerificationPanel
                    employees={employees}
                    pendingDelivery={pendingDelivery}
                    authUser={authUser}
                    onVerified={confirmDeliveryWithFace}
                  />
                ) : (
                  <SignaturePad onSave={confirmDeliveryWithSignature} />
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
        <FaceEnrollmentDialog
          open={faceEnrollmentOpen}
          employee={faceEnrollmentEmployee}
          onOpenChange={setFaceEnrollmentOpen}
          onEnrolled={handleFaceEnrollmentSaved}
          authUser={authUser}
        />
          </>
        ) : (
          <Alert className="rounded-2xl border-blue-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Redirecionando para login</AlertTitle>
            <AlertDescription>Seu acesso não está autenticado. Aguarde enquanto abrimos /login.</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
