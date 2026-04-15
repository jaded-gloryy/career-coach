import { createClient } from '@supabase/supabase-js'

let _client = null

export function getSupabase() {
  if (!_client) {
    const url = window.__ENV__?.SUPABASE_URL
    const key = window.__ENV__?.SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('Supabase config not loaded — /env.js missing')
    _client = createClient(url, key)
  }
  return _client
}
