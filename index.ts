// =====================================================================
// supabase/functions/convidar-membro/index.ts
//
// Convida um novo usuário (Supabase Auth, e-mail de convite) e cria o
// registro correspondente em `perfis`. Suporta DOIS chamadores, com
// regras de autorização e origem do empresa_id diferentes:
//
// 1. ADMIN MASTER convidando o PRIMEIRO proprietário de uma empresa
//    nova (sem perfil próprio nenhum): `empresa_id` vem OBRIGATORIAMENTE
//    do payload (já que quem chama não tem empresa própria). Exige que a
//    empresa exista, esteja ativa, e ainda não tenha nenhum membro de
//    equipe — evita reconvite acidental numa empresa que já tem gente.
//
// 2. PROPRIETÁRIO ou GERENTE convidando alguém para a PRÓPRIA equipe:
//    `empresa_id` vem do perfil de quem está chamando — NUNCA do
//    payload, mesmo que enviado, porque aceitar um empresa_id arbitrário
//    aqui permitiria a um proprietário malicioso inserir gente em
//    qualquer empresa do sistema. Esse é o comportamento original desta
//    function, preservado sem mudanças de regra.
//
// A decisão de qual caminho seguir é feita checando primeiro se quem
// chama está em `admins_master`; só se não estiver, cai no fluxo restrito
// que exige perfil de proprietário/gerente.
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CARGOS_VALIDOS = ['proprietario', 'gerente', 'barbeiro', 'recepcionista'];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Não autenticado.' }, 401);

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: 'Não autenticado.' }, 401);

    const { nome, email, cargo, filial_id, empresa_id: empresaIdPayload } = await req.json();
    if (!nome || !email || !cargo) {
      return jsonResponse({ error: 'Informe nome, e-mail e função.' }, 400);
    }
    if (!CARGOS_VALIDOS.includes(cargo)) {
      return jsonResponse({ error: 'Função inválida.' }, 400);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Decide qual caminho de autorização seguir ----
    const { data: adminMaster } = await supabaseUser
      .from('admins_master')
      .select('id')
      .eq('id', userData.user.id)
      .maybeSingle();

    let empresaIdDestino: string;

    if (adminMaster) {
      // Caminho 1: Admin Master convidando o primeiro proprietário de
      // uma empresa que ele especifica.
      if (!empresaIdPayload) {
        return jsonResponse({ error: 'Informe a empresa de destino.' }, 400);
      }

      const { data: empresa, error: erroEmpresa } = await supabaseAdmin
        .from('empresas')
        .select('id, ativo')
        .eq('id', empresaIdPayload)
        .maybeSingle();

      if (erroEmpresa || !empresa) return jsonResponse({ error: 'Empresa não encontrada.' }, 404);
      if (!empresa.ativo) return jsonResponse({ error: 'Esta empresa está bloqueada. Desbloqueie antes de convidar.' }, 400);

      const { count: totalPerfis } = await supabaseAdmin
        .from('perfis')
        .select('id', { count: 'exact', head: true })
        .eq('empresa_id', empresaIdPayload);

      if ((totalPerfis ?? 0) > 0) {
        return jsonResponse({ error: 'Esta empresa já tem pelo menos um membro de equipe cadastrado.' }, 400);
      }

      empresaIdDestino = empresaIdPayload;
    } else {
      // Caminho 2: proprietário/gerente convidando para a PRÓPRIA
      // empresa. empresa_id nunca vem do payload aqui — só do perfil de
      // quem está chamando, para impedir convite cross-tenant.
      const { data: perfilSolicitante, error: perfilError } = await supabaseUser
        .from('perfis')
        .select('empresa_id, cargo')
        .eq('id', userData.user.id)
        .single();

      if (perfilError || !perfilSolicitante) return jsonResponse({ error: 'Perfil não encontrado.' }, 403);
      if (!['proprietario', 'gerente'].includes(perfilSolicitante.cargo)) {
        return jsonResponse({ error: 'Apenas proprietário ou gerente pode convidar membros.' }, 403);
      }

      empresaIdDestino = perfilSolicitante.empresa_id;
    }

    // ---- Daqui em diante, igual para os dois caminhos ----
    const { data: listaUsuarios } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const emailJaExiste = listaUsuarios?.users?.some((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (emailJaExiste) {
      return jsonResponse({ error: 'Este e-mail já está cadastrado no sistema.' }, 400);
    }

    const { data: convite, error: erroConvite } = await supabaseAdmin.auth.admin.inviteUserByEmail(email);
    if (erroConvite || !convite?.user) {
      const msg = erroConvite?.message || '';
      if (msg.toLowerCase().includes('already')) {
        return jsonResponse({ error: 'Este e-mail já está cadastrado no sistema.' }, 400);
      }
      return jsonResponse({ error: msg || 'Não foi possível convidar este e-mail.' }, 400);
    }

    const { error: erroPerfil } = await supabaseAdmin.from('perfis').insert({
      id: convite.user.id,
      empresa_id: empresaIdDestino,
      filial_id: filial_id || null,
      nome,
      cargo,
    });

    if (erroPerfil) {
      const { error: erroLimpeza } = await supabaseAdmin.auth.admin.deleteUser(convite.user.id);
      if (erroLimpeza) {
        console.error(`Falha ao limpar usuário órfão ${convite.user.id} após erro de perfil:`, erroLimpeza.message);
      }
      return jsonResponse({ error: erroPerfil.message }, 400);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Erro inesperado.' }, 500);
  }
});
