import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Thin Supabase wrapper for the persistent leaderboard (CLAUDE.md section 9).
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (the anon key is safe to ship in the
 * client; the service key must NEVER be here). Everything degrades gracefully when the env
 * vars are missing — submit is a no-op, fetch returns [], subscribe does nothing — so the
 * game stays fully playable before Supabase is configured.
 *
 * Run this SQL once in the Supabase SQL editor to create the table + RLS (anon insert+select
 * only, no update/delete):
 *
 *   create table public.scores (
 *     id           uuid primary key default gen_random_uuid(),
 *     created_at   timestamptz not null default now(),
 *     player_name  text not null check (char_length(player_name) <= 24),
 *     score        int  not null check (score >= 0),
 *     mode         text not null default 'solo' check (mode in ('solo','multi')),
 *     room_code    text
 *   );
 *   create index scores_score_idx on public.scores (score desc);
 *   alter table public.scores enable row level security;
 *   create policy "anon can read scores"   on public.scores for select to anon using (true);
 *   create policy "anon can insert scores" on public.scores for insert to anon with check (true);
 *
 * Also enable Realtime for the `scores` table (Database → Replication, or
 * `alter publication supabase_realtime add table public.scores;`).
 */

export interface ScoreRow {
  id: string;
  created_at: string;
  player_name: string;
  score: number;
  mode: "solo" | "multi";
  room_code: string | null;
}

export interface NewScore {
  player_name: string;
  score: number;
  mode: "solo" | "multi";
  room_code?: string | null;
}

const URL = import.meta.env.VITE_SUPABASE_URL?.trim();
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

let client: SupabaseClient | null = null;

/** Whether Supabase credentials are present. When false, all calls below are safe no-ops. */
export function isConfigured(): boolean {
  return Boolean(URL && ANON_KEY);
}

function getClient(): SupabaseClient | null {
  if (!isConfigured()) return null;
  if (!client) {
    client = createClient(URL as string, ANON_KEY as string, {
      auth: { persistSession: false },
    });
  }
  return client;
}

/** Insert a score. Returns the stored row, or null if unconfigured / on error. */
export async function submitScore(entry: NewScore): Promise<ScoreRow | null> {
  const c = getClient();
  if (!c) return null;
  const payload = {
    player_name: entry.player_name.trim().slice(0, 24) || "Anonyme",
    score: Math.max(0, Math.floor(entry.score)),
    mode: entry.mode,
    room_code: entry.room_code ?? null,
  };
  try {
    const { data, error } = await c.from("scores").insert(payload).select().single();
    if (error) {
      console.warn("[Net] submitScore failed:", error.message);
      return null;
    }
    return data as ScoreRow;
  } catch (err) {
    console.warn("[Net] submitScore threw:", err);
    return null;
  }
}

/** Fetch the top N scores (desc), earliest first on ties. Returns [] if unconfigured / error. */
export async function fetchTopScores(limit = 15): Promise<ScoreRow[]> {
  const c = getClient();
  if (!c) return [];
  try {
    const { data, error } = await c
      .from("scores")
      .select("*")
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      console.warn("[Net] fetchTopScores failed:", error.message);
      return [];
    }
    return (data ?? []) as ScoreRow[];
  } catch (err) {
    console.warn("[Net] fetchTopScores threw:", err);
    return [];
  }
}

/**
 * Subscribe to new score inserts via Realtime (postgres_changes). Calls `onInsert` for each
 * new row. Returns an unsubscribe function (a no-op when unconfigured).
 */
export function subscribeToScores(onInsert: (row: ScoreRow) => void): () => void {
  const c = getClient();
  if (!c) return () => {};
  const channel = c
    .channel("public:scores")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "scores" },
      (payload) => onInsert(payload.new as ScoreRow),
    )
    .subscribe();
  return () => {
    void c.removeChannel(channel);
  };
}

// --- Realtime rooms (ghost multiplayer, CLAUDE.md 8.2) -----------------------

export interface RoomMember {
  id: string;
  pseudo: string;
}

export interface GhostPosition {
  id: string;
  pseudo: string;
  y: number;
  alive: boolean;
  score: number;
}

export interface RoomHandlers {
  onPresence?: (members: RoomMember[]) => void;
  onSeed?: (seed: number) => void;
  onCountdown?: (n: number) => void;
  onPosition?: (pos: GhostPosition) => void;
}

export interface RoomHandle {
  /** This client's stable id within the room. */
  id: string;
  /** True if this client is the earliest-joined member (used to elect the seed host). */
  isHost(): boolean;
  broadcastSeed(seed: number): void;
  broadcastCountdown(n: number): void;
  broadcastPosition(p: { y: number; alive: boolean; score: number; pseudo: string }): void;
  leave(): void;
}

/**
 * Join a Realtime room by code (CLAUDE.md 8.2). Presence drives the member list + host
 * election; Broadcast carries the shared seed, the synced countdown, and ~12 Hz ghost
 * positions — all ephemeral (no DB writes). Returns null when Supabase is unconfigured.
 */
export function joinRoom(
  roomCode: string,
  pseudo: string,
  handlers: RoomHandlers,
): RoomHandle | null {
  const c = getClient();
  if (!c) return null;

  const id = `p_${Math.random().toString(36).slice(2, 10)}`;
  const joinedAt = Date.now();
  const channel = c.channel(`room:${roomCode.toUpperCase()}`, {
    config: { presence: { key: id }, broadcast: { self: false } },
  });

  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState() as unknown as Record<
      string,
      Array<{ pseudo?: string }>
    >;
    const members: RoomMember[] = Object.entries(state).map(([key, metas]) => ({
      id: key,
      pseudo: metas[0]?.pseudo ?? "Anonyme",
    }));
    handlers.onPresence?.(members);
  });
  channel.on("broadcast", { event: "seed" }, ({ payload }) =>
    handlers.onSeed?.((payload as { seed: number }).seed),
  );
  channel.on("broadcast", { event: "countdown" }, ({ payload }) =>
    handlers.onCountdown?.((payload as { n: number }).n),
  );
  channel.on("broadcast", { event: "position" }, ({ payload }) =>
    handlers.onPosition?.(payload as GhostPosition),
  );

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") void channel.track({ pseudo, joinedAt });
  });

  const send = (event: string, payload: object) =>
    void channel.send({ type: "broadcast", event, payload });

  return {
    id,
    isHost(): boolean {
      const state = channel.presenceState() as unknown as Record<
        string,
        Array<{ joinedAt?: number }>
      >;
      let hostKey = id;
      let hostJoin = joinedAt;
      for (const [key, metas] of Object.entries(state)) {
        const j = metas[0]?.joinedAt ?? Infinity;
        if (j < hostJoin || (j === hostJoin && key < hostKey)) {
          hostJoin = j;
          hostKey = key;
        }
      }
      return hostKey === id;
    },
    broadcastSeed: (seed) => send("seed", { seed }),
    broadcastCountdown: (n) => send("countdown", { n }),
    broadcastPosition: (p) => send("position", { id, ...p }),
    leave: () => {
      void channel.untrack();
      void c.removeChannel(channel);
    },
  };
}
