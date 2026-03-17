import type {
  ChatMessageError,
  ChatMessagePluginError,
  ChatPluginPayload,
  ChatToolPayload,
  MessageMetadata,
  ModelReasoning,
  ToolIntervention,
  UIMessageRoleType,
} from './message';
import type { GroundingSearch } from './search';

export interface ExportDatabaseData {
  data: Record<string, object[]>;
  schemaHash: string;
  url?: string;
}

export interface ImportPgDataStructure {
  data: Record<string, object[]>;
  mode: 'pglite' | 'postgres';
  schemaHash: string;
}

// ===== Topic Export Types =====

/**
 * Export mode for topic JSON export
 * - simple: OpenAI compatible format (only role and content)
 * - full: Lossless backup format (includes all metadata)
 */
export type TopicExportMode = 'simple' | 'full';

/**
 * Complete lossless export format for a topic
 * Messages are exported as-is from UIChatMessage with timestamps converted to ISO strings
 */
export interface ExportedTopic {
  /** ISO timestamp when the export was created */
  exportedAt: string;
  /** All messages in the topic (UIChatMessage with cleaned null/undefined values) */
  messages: ImportedMessage[];
  /** Topic title (optional, not present for non-topic exports) */
  title?: string;
  /** Export format version for forward compatibility */
  version: '2.0';
}

// ===== Topic Import Types =====

/**
 * Message format for importing into a topic
 * Supports both simple (OpenAI compatible) and full (lossless) formats
 */
export interface ImportedMessage {
  content: string;
  /** ISO timestamp or Unix timestamp (ms) */
  createdAt?: number | string;
  /** Error information */
  error?: ChatMessageError | null;
  /** Original message ID (used for parentId mapping) */
  id?: string;
  /** Metadata */
  metadata?: MessageMetadata | null;
  /** Model used */
  model?: string | null;
  /** Parent message ID (for conversation tree) */
  parentId?: string | null;
  /** Plugin information */
  plugin?: ChatPluginPayload;
  /** Plugin error */
  pluginError?: ChatMessagePluginError | null;
  /** Plugin intervention state */
  pluginIntervention?: ToolIntervention;
  /** Plugin state */
  pluginState?: Record<string, unknown>;
  /** Provider used */
  provider?: string | null;
  /** Reasoning content */
  reasoning?: ModelReasoning | null;
  role: UIMessageRoleType;
  /** Search results */
  search?: GroundingSearch | null;
  /** Tool call ID */
  tool_call_id?: string;
  /** Tool calls */
  tools?: ChatToolPayload[];
  /** Trace ID */
  traceId?: string;
  /** ISO timestamp or Unix timestamp (ms) */
  updatedAt?: number | string;
}

/**
 * Import data format - can be either simple array or full ExportedTopic format
 */
export type ImportTopicData = ExportedTopic | ImportedMessage[];
