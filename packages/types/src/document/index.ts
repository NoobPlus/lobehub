import type { RichTextEditorState } from '../message';

export interface LobeDocumentMetadata {
  [key: string]: unknown;
  author?: string;
  emoji?: string;
  error?: string;
  knowledgeBaseId?: string;
  title?: string;
}

export interface LobeDocumentPageMetadata {
  [key: string]: unknown;
  chunkIndex?: number;
  error?: string;
  lineNumberEnd?: number;
  lineNumberStart?: number;
  pageNumber?: number;
  sectionTitle?: string;
  sheetName?: string;
  slideNumber?: number;
  totalChunks?: number;
}

/**
 * Document object in LobeChat
 */
export interface LobeDocument {
  /**
   * File content
   */
  content: string | null;
  /**
   * File creation timestamp
   */
  createdAt: Date;

  editorData: RichTextEditorState | null;

  /**
   * Original filename
   */
  filename: string;

  /**
   * File type or extension
   */
  fileType: string;

  id: string;

  /**
   * File-level metadata
   * For example, title and author extracted from file properties, or errors when the entire file fails to load
   */
  metadata: LobeDocumentMetadata;

  /**
   * Array containing all logical pages/blocks in the document
   * Order typically corresponds to the natural order in the file
   */
  pages?: LobeDocumentPage[];

  /**
   * Parent Folder ID
   */
  parentId?: string | null;

  /**
   * Full path of the original file
   */
  source: string;

  /**
   * Document source type
   */
  sourceType: DocumentSourceType;

  /**
   * Document title (if available)
   */
  title?: string;

  /**
   * Total character count of the entire document (sum of charCount of all Pages)
   * Obtained after all Pages are loaded and calculated
   */
  totalCharCount: number;

  /**
   * Total line count of the entire document (sum of lineCount of all Pages)
   * Obtained after all Pages are loaded and calculated
   */
  totalLineCount: number;

  /**
   * File last modified timestamp
   */
  updatedAt: Date;
}

/**
 * Represents a logical unit/page/block in a file
 */
export interface LobeDocumentPage {
  /**
   * Character count of this page/block content
   */
  charCount: number;

  /**
   * Line count of this page/block content
   */
  lineCount: number;

  /**
   * Metadata related to this page/block
   */
  metadata: LobeDocumentPageMetadata;

  /**
   * Core text content of this page/block
   */
  pageContent: string;
}

/**
 * Document source type
 */
export enum DocumentSourceType {
  /**
   * Content from API
   */
  API = 'api',

  /**
   * Document created in editor
   */
  EDITOR = 'editor',

  /**
   * Local or uploaded file
   */
  FILE = 'file',

  /**
   * Web content
   */
  WEB = 'web',
}

/**
 * Notebook document type for topic-associated documents
 */
export type NotebookDocumentType = 'article' | 'markdown' | 'note' | 'report';

/**
 * Notebook document - a document associated with a topic
 */
export interface NotebookDocument {
  /**
   * When the document was associated with the topic
   */
  associatedAt: Date;
  /**
   * Document content
   */
  content: string | null;
  /**
   * Document creation timestamp
   */
  createdAt: Date;
  /**
   * Brief summary of the document (1-2 sentences)
   */
  description: string | null;
  /**
   * Document type
   */
  fileType: string;
  /**
   * Document ID
   */
  id: string;
  /**
   * Document metadata (e.g., todos for agent/plan documents)
   */
  metadata: Record<string, unknown> | null;
  /**
   * Document title
   */
  title: string | null;
  /**
   * Total character count
   */
  totalCharCount: number;
  /**
   * Total line count
   */
  totalLineCount: number;
  /**
   * Document last modified timestamp
   */
  updatedAt: Date;
}
