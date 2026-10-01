-- Isolation par organisation (étape 20) : lectures de la plateforme nécessaires sous contexte, sans seconde connexion.
-- Inverse : drizzle/down/0024_isolation-recipients.sql. Les fonctions s'exécutent avec les droits de leur propriétaire et ne
-- rendent que le strict nécessaire.

-- 1. Personnel d'exploitation de la plateforme (alertes : SOS, règlement en échec, course non confirmée), y compris quand
--    l'alerte part du contexte d'une organisation cliente, qui ne voit pas user_roles (réservée à la plateforme).
CREATE OR REPLACE FUNCTION platform_staff_user_ids(p_roles text[]) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.role::text = ANY(p_roles)
$$;--> statement-breakpoint

-- 2. Coordonnées du destinataire d'un avis (langue, téléphone, courriel, jetons push), pour un avis visible dans le contexte
--    courant seulement : sans contexte, tout avis ; sous contexte, un avis de l'organisation ou de son sous-arbre.
CREATE OR REPLACE FUNCTION notification_recipient(p_notification uuid) RETURNS TABLE (language text, phone text, email text, push_tokens text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.language::text, u.phone::text, u.email::text,
    coalesce((SELECT array_agg(d.push_token::text ORDER BY d.last_seen_at DESC) FROM devices d WHERE d.user_id = u.id AND d.push_token IS NOT NULL), '{}'::text[])
  FROM notifications n JOIN users u ON u.id = n.recipient_user_id
  WHERE n.id = p_notification
    AND (coalesce(current_setting('app.scope_path', true), '') = '' OR app_scope_allows(n.organization_id))
$$;
