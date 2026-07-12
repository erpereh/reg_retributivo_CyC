import type { ChatAction, ChatEvent, ChatMessage, Conversation, ModelProfile, PersistedDocumentMetadata, SourceReference } from "@/lib/assistant/domain";

export interface PageOptions { limit: number; cursor?: string }
export interface Page<T> { items: T[]; nextCursor?: string }
export interface EntityRepository<T extends { id: string }> { get(id: string): Promise<T | undefined>; put(value: T): Promise<void>; delete(id: string): Promise<void> }
export interface ConversationRepository extends EntityRepository<Conversation> { list(options: PageOptions): Promise<Page<Conversation>> }
export interface MessageRepository extends EntityRepository<ChatMessage> { listByConversation(conversationId: string, options: PageOptions): Promise<Page<ChatMessage>> }
export interface AssistantDocumentRepository extends EntityRepository<PersistedDocumentMetadata> {}
export interface SourceRepository extends EntityRepository<SourceReference> {}
export interface ContextSnapshot extends Record<string, unknown> { id: string }
export interface ContextSnapshotRepository extends EntityRepository<ContextSnapshot> {}
export interface ModelProfileRepository extends EntityRepository<ModelProfile> {}
export interface CleanupJob extends Record<string, unknown> { id: string }
export interface AssistantCleanupRepository extends EntityRepository<CleanupJob> {}
export interface AssistantStoredRecord extends Record<string, unknown> { id: string }

export interface ConversationWriteBlock {
  conversation: Conversation;
  messages: readonly ChatMessage[];
  sources: readonly SourceReference[];
  events?: readonly ChatEvent[];
}

export interface IngestionWriteBlock {
  document: PersistedDocumentMetadata;
  chunks: readonly {
    readonly id: string; readonly documentId: string; readonly sequence: number; readonly content: string;
    readonly snippet: string; readonly sanitizedHash: string; readonly terms: readonly string[];
  }[];
  searchTerms: readonly {
    readonly id: string; readonly documentId: string; readonly chunkId: string; readonly term: string; readonly positions: readonly number[];
  }[];
  indexJob: DocumentIndexJob;
}

export interface DocumentIndexJob {
  readonly id: string;
  readonly documentId: string;
  readonly status: "ready" | "error";
  readonly indexedChunkIds: readonly string[];
  readonly nonIndexableReason?: "scanned_without_text" | "empty_document";
}
export interface DocumentCorpusSelection {
  readonly sourceConversationId: string;
  readonly targetConversationId: string;
  readonly documentIds: readonly string[];
}
export interface DeleteDocumentCorpusInput { readonly conversationId: string; readonly documentIds: readonly string[] }
export interface DocumentIdMapping { readonly sourceDocumentId: string; readonly targetDocumentId: string }
export interface BeginAnalysisIngestionInput { readonly analysisId: string; readonly ingestionId: string }
export interface ReplaceAnalysisCorpusInput extends BeginAnalysisIngestionInput { readonly blocks: readonly IngestionWriteBlock[] }

export interface AssistantRepositories {
  conversations: ConversationRepository;
  messages: MessageRepository;
  events: EntityRepository<ChatEvent>;
  actions: EntityRepository<ChatAction>;
  documents: AssistantDocumentRepository;
  sources: SourceRepository;
  chunks: EntityRepository<AssistantStoredRecord>;
  searchTerms: EntityRepository<AssistantStoredRecord>;
  snapshots: ContextSnapshotRepository;
  cache: EntityRepository<AssistantStoredRecord>;
  analysisVersions: EntityRepository<AssistantStoredRecord>;
  indexJobs: EntityRepository<AssistantStoredRecord>;
  modelProfiles: ModelProfileRepository;
  assistantSettings: EntityRepository<AssistantStoredRecord>;
  cleanupJobs: AssistantCleanupRepository;
  writeConversationBlock(block: ConversationWriteBlock): Promise<void>;
  writeIngestionBlock(block: IngestionWriteBlock): Promise<void>;
  beginAnalysisIngestion(input: BeginAnalysisIngestionInput): Promise<void>;
  replaceAnalysisCorpus(input: ReplaceAnalysisCorpusInput): Promise<boolean>;
  copyDocumentCorpus(input: DocumentCorpusSelection): Promise<readonly DocumentIdMapping[]>;
  transferDocumentCorpus(input: DocumentCorpusSelection): Promise<readonly DocumentIdMapping[]>;
  deleteDocumentCorpus(input: DeleteDocumentCorpusInput): Promise<void>;
  close(): void;
}
