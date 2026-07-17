import { pgTable, text, timestamp, integer, primaryKey } from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { campaignVariants } from './campaigns'
import type { MediaKind } from '@naia/schemas'

// Anexos de mídia das campanhas — objetos vivem no MinIO próprio do Campaigns
// (bucket naia-campaigns); aqui só metadados + chave de storage.
export const mediaAssets = pgTable('media_assets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<MediaKind>().notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  storageKey: text('storage_key').notNull().unique(), // `${workspaceId}/${assetId}/${filename}`
  // 'pending' até o confirm verificar que o PUT pré-assinado aconteceu
  status: text('status').$type<'pending' | 'ready'>().notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const campaignVariantMedia = pgTable(
  'campaign_variant_media',
  {
    variantId: text('variant_id')
      .notNull()
      .references(() => campaignVariants.id, { onDelete: 'cascade' }),
    mediaAssetId: text('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.variantId, table.mediaAssetId] })],
)

export type MediaAsset = typeof mediaAssets.$inferSelect
export type CampaignVariantMedia = typeof campaignVariantMedia.$inferSelect
