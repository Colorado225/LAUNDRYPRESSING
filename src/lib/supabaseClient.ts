import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env['VITE_SUPABASE_URL']
const supabaseAnonKey = import.meta.env['VITE_SUPABASE_ANON_KEY']

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variables d’environnement Supabase manquantes : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies dans .env'
  )
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey)

export default supabase
