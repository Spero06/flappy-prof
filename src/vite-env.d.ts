/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (safe to expose in the client). */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public key (safe to expose; NEVER the service key). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
