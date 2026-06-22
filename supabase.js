// =====================================================================
// supabase.js
// Cliente Supabase único, compartilhado entre /admin e /app.
//
// IMPORTANTE: este arquivo NÃO importa o SDK via ESM/CDN. Cada HTML que
// usa supabase.js já carrega o SDK UMD via:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
// que expõe window.supabase.createClient. Importar o SDK de novo aqui
// carrega uma SEGUNDA cópia do GoTrue-js rodando em paralelo, e as duas
// instâncias competem pela mesma chave de sessão no localStorage — isso
// causa falhas intermitentes de rede/auth (ex: "Failed to fetch" em
// signInWithPassword) que não têm relação com o Supabase em si.
// =====================================================================

const SUPABASE_URL = 'https://dknsrhomdhoczghwugff.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrbnNyaG9tZGhvY3pnaHd1Z2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4NDgyOTMsImV4cCI6MjA5NzQyNDI5M30.ti4dU4cJCsDmnquPuM3kep91PE1BC5us3tXDnHhwPL0';

if (!window.supabase) {
  throw new Error(
    'O SDK do Supabase (UMD) não foi carregado. Confirme que este HTML inclui ' +
    '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script> ' +
    'ANTES do <script type="module" src="...seu-arquivo.js">.'
  );
}

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Helper: lança um erro legível se a resposta do Supabase contiver `error`.
export function unwrap({ data, error }) {
  if (error) {
    console.error('[Supabase erro]', error);
    throw new Error(error.message || 'Erro ao comunicar com o banco de dados.');
  }
  return data;
}
