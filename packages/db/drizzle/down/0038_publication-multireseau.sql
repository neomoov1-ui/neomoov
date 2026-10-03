-- Inverse de 0038 : retire les publications multiréseau (content_groups, colonnes de diffusion et de visuel des contenus) et les
-- espaces Telegram et chaîne WhatsApp. Les contenus de ces deux espaces sont supprimés avant de remettre la contrainte d'origine.
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_group_id_content_groups_id_fk;
DROP INDEX IF EXISTS content_items_group_idx;
DROP INDEX IF EXISTS content_items_relay_idx;
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_delivery;
ALTER TABLE content_items DROP COLUMN IF EXISTS group_id;
ALTER TABLE content_items DROP COLUMN IF EXISTS delivery;
ALTER TABLE content_items DROP COLUMN IF EXISTS visual;
ALTER TABLE content_items DROP COLUMN IF EXISTS relayed_at;
ALTER TABLE content_items DROP COLUMN IF EXISTS relayed_by_user_id;
DROP TABLE IF EXISTS content_groups;
DELETE FROM content_items WHERE space IN ('telegram', 'whatsapp_channel');
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_space;
ALTER TABLE content_items ADD CONSTRAINT content_items_space CHECK (space IN ('site_blog', 'academy', 'google_business', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x', 'snapchat', 'newsletter'));
