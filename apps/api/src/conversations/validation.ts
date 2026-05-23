/**
 * Re-exports the shared @ollive/shared/api request schemas used by conversations routes.
 * No local redefinition of request/response shapes (BE3).
 */
export {
  listConversationsQuerySchema,
  type ListConversationsQuery,
  createConversationSchema,
  type CreateConversationBody,
  patchConversationSchema,
  type PatchConversationBody,
  importConversationSchema,
  type ImportConversationBody,
} from '@ollive/shared/api';
