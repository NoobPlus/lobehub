import { type ConversationContext as BaseConversationContext } from '@lobechat/types';

/**
 * Extension point for ConversationContext metadata.
 *
 * Features augment this interface locally using `declare module`:
 *
 *   declare module '@/features/Conversation/types/context' {
 *     interface ConversationMetadataOverrides {
 *       knowledgeBaseId?: string;
 *     }
 *   }
 */
export interface ConversationMetadataOverrides {}

export interface ConversationMetadata extends ConversationMetadataOverrides {}

/**
 * Extended Conversation Context
 *
 * Used to locate messages in the session → topic → thread hierarchy.
 *
 * Design Principles:
 * - Only data coordinates (sessionId/topicId/threadId)
 * - Scenario is naturally determined by coordinate combination
 */
export interface ConversationContext extends BaseConversationContext {
  metadata?: ConversationMetadata;
}
