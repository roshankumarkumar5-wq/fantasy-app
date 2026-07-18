import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Service role key is used because this backend performs trusted,
// server-side operations (auth checks happen in our own middleware,
// not via Supabase Auth/RLS in this simple setup).
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
