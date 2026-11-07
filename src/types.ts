// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export type Accent = "violet" | "amber" | "green" | "red";
export type {
  PaymentAsset,
  PaymentBackend
} from "../shared/paymentConfiguration";
import type {
  PaymentAsset,
  PaymentBackend
} from "../shared/paymentConfiguration";
export type ApprovalMode = "runtime";
export type AgentMode = import("../shared/contracts").AgentMode;
export type DemoArea = "storefront" | "checkin" | "hotel" | "operations";
export type MoviePace = "gentle" | "moderate" | "fast";
export type MovieVideoProvider = "youtube" | "vimeo" | "direct";

export interface MovieVideoSource {
  provider: MovieVideoProvider;
  url: string;
  title?: string;
}

export interface Movie {
  id: string;
  title: string;
  tagline: string;
  year: number;
  rating: string;
  runtime: string;
  genre: string;
  price: number;
  currency: PaymentAsset;
  accent: Accent;
  featured?: boolean;
  description: string;
  genres?: string[];
  moods?: string[];
  themes?: string[];
  language?: string;
  subtitles?: string[];
  pace?: MoviePace;
  accessibility?: {
    captions: boolean;
    audioDescription: boolean;
  };
  trailer?: MovieVideoSource;
  video?: MovieVideoSource;
}

export interface Transaction {
  id: string;
  titleId: string;
  merchant: string;
  amount: number;
  currency: string;
  network: string;
  status: string;
  createdAt: string;
}

export interface ProofOfStay {
  propertyId: string;
  propertyName: string;
  roomNumber: string;
  stayRef: string;
  linkedAt: string;
  checkoutAt: string;
}

export interface HotelRoomAvailability {
  propertyId: string;
  totalRooms: number;
  availableRooms: string[];
}

export interface PaymentSession {
  id: string;
  currency: PaymentAsset;
  backend: PaymentBackend;
  network: string;
  authenticated: boolean;
  identityType?: "guest-session" | "wallet";
  beneficiaryId?: string;
  approvalModes: ApprovalMode[];
  walletAddress?: string;
  limit: number;
  spent: number;
  remaining: number;
  expiresInMinutes: number;
  transactions: Transaction[];
  proofOfStay?: ProofOfStay;
}

export interface HotelPurchase {
  transactionId: string;
  invoiceId: string;
  roomNumber: string;
  stayReference: string;
  titleId: string;
  title: string;
  amount: number;
  currency: string;
  network: string;
  status: "settled";
  createdAt: string;
  walletDisplay: string;
  channel: "agentcore";
}

export interface HotelDashboard {
  propertyId: string;
  propertyName: string;
  tagline: string;
  generatedAt: string;
  source: "xrpl";
  merchantWalletDisplay: string;
  stats: {
    totalPurchases: number;
    revenue: number;
    occupiedRooms: number;
    uniqueWallets: number;
    topTitle?: string;
  };
  purchases: HotelPurchase[];
}

export interface PaymentChallenge {
  x402Version: number;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: {
      name?: string;
      version?: string;
      areFeesSponsored?: boolean;
      [key: string]: unknown;
    };
  }>;
  merchant?: {
    name: string;
    category: string;
  };
}

export interface PaymentRequiredResponse {
  error: "payment_required";
  message: string;
  challenge: PaymentChallenge;
  session: PaymentSession;
}

export interface PaymentResponse {
  status: "settled";
  proof: string;
  transaction: Transaction;
  session: PaymentSession;
}

export interface PlaybackResponse {
  access: "granted";
  title: Movie;
  entitlement: {
    id: string;
    expiresIn: string;
    transactionId: string;
  };
  playback: {
    type: "demo";
    manifest: string;
    message: string;
  };
}

export type AgentActionStatus =
  | "payment_confirmation_required"
  | "playback_unlocked"
  | "recommendations_ready"
  | "payment_limit_exceeded"
  | "payment_failed"
  | "merchant_retry_failed"
  | "xrpl_payment_failed"
  | "live_payment_setup_required"
  | "tool_error";

export interface AgentAction {
  status: AgentActionStatus;
  message?: string;
  paymentRequired?: PaymentRequiredResponse;
  playback?: PlaybackResponse;
  payment?: unknown;
  summary?: string;
  recommendations?: AgentMovieRecommendation[];
  memoryInfluenced?: boolean;
}

export interface AgentMovieRecommendation {
  titleId: string;
  reason: string;
}

export interface MovieCuration {
  prompt: string;
  summary: string;
  memoryInfluenced: boolean;
  recommendations: Array<{
    movie: Movie;
    reason: string;
  }>;
  createdAt: string;
}

export type AgentTraceCategory =
  | "runtime"
  | "agent"
  | "policy"
  | "memory"
  | "model"
  | "tool";
export type AgentTraceStatus = "success" | "skipped" | "error";

export interface AgentTraceStep {
  id: string;
  category: AgentTraceCategory;
  name: string;
  status: AgentTraceStatus;
  detail: string;
  offsetMs: number;
  durationMs: number;
}

export interface AgentExecutionTrace {
  startedAt: string;
  totalDurationMs: number;
  steps: AgentTraceStep[];
}

export interface AgentMemoryObservation {
  enabled: boolean;
  namespace: string;
  recalled: string[];
  recallStatus: AgentTraceStatus;
  writeStatus: AgentTraceStatus;
}

export type SecurityFindingSeverity = "info" | "low" | "medium" | "high";
export type SecurityFindingStatus = "pass" | "review" | "fail";

export interface SecurityFinding {
  severity: SecurityFindingSeverity;
  title: string;
  status: SecurityFindingStatus;
  detail: string;
  resource?: string;
}

export interface AgentRouteHop {
  name: string;
  role: string;
  status: AgentTraceStatus;
  runtimeSessionId?: string;
  traceId?: string;
}

export interface AgentOrchestration {
  selectedAgent: AgentMode;
  route: AgentRouteHop[];
  specialistTraceId?: string;
  gateway?: {
    used: boolean;
    target?: string;
    policyMode?: string;
    mutationAllowed?: boolean;
    tools?: string[];
  };
}

export interface AgentResponse {
  message: string;
  actorId: string;
  sessionId: string;
  agentMode?: AgentMode;
  runtimeSessionId?: string;
  runtimeDurationMs?: number;
  paymentApproved: boolean;
  action?: AgentAction;
  memoryEnabled: boolean;
  memory?: AgentMemoryObservation;
  trace?: AgentExecutionTrace;
  traceId?: string;
  findings?: SecurityFinding[];
  orchestration?: AgentOrchestration;
}

export interface AgentInspection {
  prompt: string;
  capturedAt: string;
  response: AgentResponse;
}

export interface PendingPurchase {
  movie: Movie;
  challenge: PaymentChallenge;
  prompt: string;
  actorId: string;
  runtimeSessionId: string;
}

export interface ToastMessage {
  id: number;
  label: string;
  message: string;
}

export type PaymentStatus = "idle" | "signing" | "settled";
