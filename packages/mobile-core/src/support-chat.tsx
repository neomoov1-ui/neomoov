/**
 * Conversation avec l'assistance (agent relation client, puis l'équipe) : partagée par les applications client et
 * chauffeur. Le message part vers `POST /v1/me/support/messages` ; la conversation est relue toutes les 5 secondes tant
 * que l'écran est ouvert (accusé immédiat, réponse de l'agent, puis réponses de l'équipe si la conversation lui est
 * confiée). Aucune dépendance au client d'API : l'application fournit `load` et `send`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field } from './components';
import { colors, radius, spacing, typography } from './theme';

export interface SupportChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  author: string;
  body: string;
  createdAt: string;
}

export interface SupportChatConversation {
  status: string;
  messages: SupportChatMessage[];
}

export interface SupportChatLabels {
  field: string;
  placeholder: string;
  send: string;
  empty: string;
  team: string;
  error: string;
  escalated: string;
}

/** Ordre d'affichage : chronologique, messages locaux (pas encore relus) à la fin. */
export function mergeMessages(server: SupportChatMessage[], pending: SupportChatMessage[]): SupportChatMessage[] {
  const known = new Set(server.map((m) => `${m.direction}:${m.body}`));
  return [...server, ...pending.filter((p) => !known.has(`${p.direction}:${p.body}`))];
}

export function SupportChat({ load, send, labels, pollMs = 5_000 }: {
  load: () => Promise<{ conversation: SupportChatConversation | null }>;
  send: (text: string) => Promise<unknown>;
  labels: SupportChatLabels;
  pollMs?: number;
}) {
  const [conversation, setConversation] = useState<SupportChatConversation | null>(null);
  const [pending, setPending] = useState<SupportChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await load();
      setConversation(result.conversation);
    } catch {
      // Relecture en échec (réseau) : l'écran garde l'état connu et réessaie au prochain passage.
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(false);
    try {
      await send(body);
      setPending((p) => [...p, { id: `local-${Date.now()}`, direction: 'inbound', author: 'client', body, createdAt: new Date().toISOString() }]);
      setText('');
      setTimeout(() => void refresh(), 1_500);
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  };

  const messages = mergeMessages(conversation?.messages ?? [], pending);
  return (
    <View style={styles.container}>
      <ScrollView ref={scroll} style={styles.list} contentContainerStyle={styles.listContent} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {messages.length === 0 ? <Text style={styles.empty}>{labels.empty}</Text> : null}
        {messages.map((m) => (
          <View key={m.id} style={[styles.bubble, m.direction === 'inbound' ? styles.mine : styles.theirs]}>
            {m.direction === 'outbound' ? <Text style={styles.author}>{labels.team}</Text> : null}
            <Text style={[styles.body, m.direction === 'inbound' ? styles.mineText : null]}>{m.body}</Text>
          </View>
        ))}
        {conversation?.status === 'escalated' ? <Text style={styles.notice}>{labels.escalated}</Text> : null}
      </ScrollView>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{labels.error}</Text> : null}
      <Field label={labels.field} placeholder={labels.placeholder} value={text} onChangeText={setText} multiline maxLength={2000} />
      <Button label={labels.send} disabled={sending || !text.trim()} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  list: { maxHeight: 420, borderRadius: radius.md, backgroundColor: colors.mist },
  listContent: { padding: spacing.md, gap: spacing.sm },
  empty: { color: colors.muted, fontFamily: typography.body, fontSize: typography.sizes.sm },
  bubble: { maxWidth: '85%', borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.blue },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  author: { color: colors.muted, fontFamily: typography.bodyBold, fontSize: typography.sizes.xs, marginBottom: 2 },
  body: { color: colors.ink, fontFamily: typography.body, fontSize: typography.sizes.md },
  mineText: { color: colors.white },
  notice: { color: colors.ink, fontFamily: typography.body, fontSize: typography.sizes.sm, textAlign: 'center' },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: typography.sizes.sm },
});
