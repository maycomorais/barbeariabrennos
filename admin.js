// =====================================================================
// admin.js — Roteador do painel admin (SPA)
//
// Responsabilidades deste arquivo, e SÓ deste arquivo:
//  1. Autenticação + carregar sessão (perfil, empresa, filiais)
//  2. Verificar bloqueio de empresa (Admin Master)
//  3. Montar sidebar/topbar fixos
//  4. Trocar o módulo ativo na área #content conforme a hash da URL
//
// Cada módulo (dashboard.js, schedule.js, pdv.js, inventory.js,
// financial.js, clients.js, settings.js) exporta uma função:
//
//     export function init(root, sessao) { ... }
//
// `root` é o elemento <div id="content"> já vazio; `sessao` é
// { user, perfil, empresa, filiais }. O módulo nunca chama
// supabase.auth nem monta sidebar — isso é só do admin.js.
//
// Módulos são carregados via import() dinâmico SOB DEMANDA (code
// splitting nativo do browser) — então pdv.js só baixa quando o usuário
// clica em "PDV", não no carregamento inicial do admin.html.
// =====================================================================

import { supabase, unwrap } from './supabase.js';
import { t, getLangByPais } from './i18n.js';

const LOGIN_PAGE = './login.html';

const ICONES = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  schedule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  pdv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.27 6.96 12 12l8.73-5.04"/><line x1="12" y1="22" x2="12" y2="12"/></svg>',
  financial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
  clients: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  master: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z"/><path d="m9.5 12 1.8 1.8L15 10"/></svg>',
};

// Rota -> { labelKey, módulo a importar, somenteGestor, somenteAdminMaster,
// ocultaSeSemPerfil }. O caminho do módulo é uma string simples (arquivo
// na mesma raiz).
const ROTAS = {
  dashboard: { labelKey: 'nav_dashboard', arquivo: './dashboard.js', somenteGestor: false, ocultaSeSemPerfil: true },
  agenda:    { labelKey: 'nav_agenda',    arquivo: './schedule.js',  somenteGestor: false, ocultaSeSemPerfil: true },
  pdv:       { labelKey: 'nav_pdv',       arquivo: './pdv.js',       somenteGestor: false, ocultaSeSemPerfil: true },
  estoque:   { labelKey: 'nav_estoque',   arquivo: './inventory.js', somenteGestor: false, ocultaSeSemPerfil: true },
  financeiro:{ labelKey: 'nav_financeiro',arquivo: './financial.js', somenteGestor: false, ocultaSeSemPerfil: true },
  clientes:  { labelKey: 'nav_clientes',  arquivo: './clients.js',   somenteGestor: false, ocultaSeSemPerfil: true },
  config:    { labelKey: 'nav_configuracoes', arquivo: './settings.js', somenteGestor: true, ocultaSeSemPerfil: true },
  master:    { labelKey: 'nav_master', arquivo: './master.js', somenteGestor: false, somenteAdminMaster: true },
};
const ROTA_PADRAO = 'dashboard';

let sessao = null;
let lang = 'pt';
let moduloAtual = null; // { destruir? } — para módulos que precisam limpar listeners/timers

// =====================================================================
// IMPERSONATION (Admin Master "entrar como" uma empresa)
// =====================================================================
// Sobrepõe o contexto de empresa/filiais SÓ no navegador do Admin Master,
// sem nunca gerar um token de autenticação como se fosse o proprietário
// de verdade — a sessão real continua sendo a do Admin Master, e o RLS
// já libera tudo para is_admin_master() de qualquer forma. Persiste em
// sessionStorage (sobrevive a F5, não sobrevive a fechar a aba) para que
// recarregar a página não derrube o Admin Master de volta para #master
// no meio de uma tarefa.
const CHAVE_IMPERSONATION = 'barbearia_impersonation_empresa_id';

let impersonando = null; // { empresa, filiais } | null

// =====================================================================
// BOOT
// =====================================================================

async function iniciar() {
  sessao = await carregarSessao();
  if (!sessao) return; // já redirecionou para login ou mostrou tela de bloqueio

  // Restaura uma sessão de impersonation que sobreviveu a um F5. Só faz
  // sentido para quem é admin master de verdade — se por algum motivo a
  // chave estiver presente para outro tipo de usuário (sessionStorage
  // sendo zerado entre logins diferentes na mesma aba, por exemplo),
  // ignora silenciosamente.
  if (ehAdminMaster()) {
    const empresaIdSalva = sessionStorage.getItem(CHAVE_IMPERSONATION);
    if (empresaIdSalva) {
      await carregarImpersonation(empresaIdSalva);
    }
  }

  lang = getLangByPais(filialAtiva()?.pais);
  montarShell();
  window.addEventListener('hashchange', rotear);

  // Admin master puro (sem perfil de empresa) não tem dashboard/agenda/etc.
  // para ver — cai direto na gestão de tenants. Não se aplica enquanto
  // estiver impersonando uma empresa.
  if (!sessao.perfil && !impersonando && !window.location.hash) {
    window.location.hash = '#master';
  }
  rotear();
}

async function carregarSessao() {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session) {
    window.location.href = LOGIN_PAGE;
    return null;
  }

  // Busca em paralelo: perfil de empresa (pode não existir) e registro de
  // admin master (também pode não existir). Um usuário pode ter as duas
  // coisas (ex: dono da plataforma que também é proprietário de uma
  // barbearia), só uma delas, ou nenhuma (acesso inválido).
  const [perfil, adminMaster] = await Promise.all([
    supabase
      .from('perfis')
      .select('id, empresa_id, filial_id, nome, cargo, percentual_comissao_servico, percentual_comissao_produto, ativo')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(unwrap),
    supabase.from('admins_master').select('id, nome').eq('id', session.user.id).maybeSingle().then(unwrap),
  ]);

  if (!perfil && !adminMaster) {
    await supabase.auth.signOut();
    window.location.href = LOGIN_PAGE;
    return null;
  }

  if (perfil && perfil.ativo === false) {
    await supabase.auth.signOut();
    window.location.href = LOGIN_PAGE;
    return null;
  }

  // Sem perfil de empresa (admin master puro): não há empresa/filial para
  // carregar. O roteador cai direto na rota #master.
  if (!perfil) {
    return { user: session.user, perfil: null, empresa: null, filiais: [], adminMaster };
  }

  const empresa = unwrap(
    await supabase.from('empresas').select('id, nome, ativo, motivo_bloqueio').eq('id', perfil.empresa_id).single()
  );

  if (!empresa || empresa.ativo === false) {
    renderBloqueado(empresa);
    return null;
  }

  const filiais = unwrap(
    await supabase
      .from('filiais')
      .select('id, nome, slug, pais, google_maps_url, moeda_principal, aceita_moeda_secundaria, moeda_secundaria, taxa_cambio_secundaria, timezone, ativo')
      .order('nome')
  );

  return { user: session.user, perfil, empresa, filiais, adminMaster };
}

function renderBloqueado(empresa) {
  document.body.innerHTML = `
    <div class="tela-bloqueio">
      <div class="cartao-bloqueio">
        <h1>Acesso suspenso</h1>
        <p>O acesso da sua barbearia está temporariamente suspenso.</p>
        ${empresa?.motivo_bloqueio ? `<p class="motivo">Motivo: ${empresa.motivo_bloqueio}</p>` : ''}
        <p>Entre em contato com o suporte para regularizar.</p>
        <button id="btn-sair-bloqueio" class="botao botao-secundario">Sair</button>
      </div>
    </div>
  `;
  document.getElementById('btn-sair-bloqueio').addEventListener('click', logout);
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = LOGIN_PAGE;
}

// =====================================================================
// CONTEXTO COMPARTILHADO (usado pelos módulos via getSessao/filialAtiva)
// =====================================================================

export function getSessao() {
  return sessao;
}

export function filialAtiva() {
  if (impersonando) {
    return impersonando.filiais[0] || null;
  }
  if (!sessao || !sessao.perfil) return null;
  if (sessao.perfil.filial_id) {
    return sessao.filiais.find((f) => f.id === sessao.perfil.filial_id) || sessao.filiais[0];
  }
  return sessao.filiais[0];
}

export function podeGerenciar() {
  // Em modo impersonation, o Admin Master sempre "age como" proprietário
  // da empresa visualizada — é a forma mais simples de garantir acesso
  // total às telas (Configurações, despesas, etc.) sem precisar simular
  // um cargo específico que nem sempre existirá (ex: empresa sem
  // proprietário cadastrado ainda, hipótese rara mas possível).
  if (impersonando) return true;
  return !!sessao?.perfil && ['proprietario', 'gerente'].includes(sessao.perfil.cargo);
}

export function ehAdminMaster() {
  return !!sessao?.adminMaster;
}

export function estaImpersonando() {
  return impersonando;
}

/**
 * Admin Master "entra como" uma empresa específica. Carrega as filiais
 * dela e ativa o modo impersonation — filialAtiva()/podeGerenciar() e a
 * sidebar passam a se comportar como se o Admin Master fosse o
 * proprietário daquela empresa. Não altera a sessão real (não há logout
 * nem novo login); é só uma sobreposição de contexto neste navegador.
 */
export async function iniciarImpersonation(empresaId) {
  if (!ehAdminMaster()) return;
  await carregarImpersonation(empresaId);
  sessionStorage.setItem(CHAVE_IMPERSONATION, empresaId);
  montarShell();
  window.location.hash = '#dashboard';
  rotear();
}

export function pararImpersonation() {
  impersonando = null;
  sessionStorage.removeItem(CHAVE_IMPERSONATION);
  montarShell();
  window.location.hash = '#master';
  rotear();
}

async function carregarImpersonation(empresaId) {
  // is_admin_master() dá bypass de RLS — estas queries retornam a
  // empresa/filiais de qualquer tenant, mesmo sem perfil próprio nela.
  const empresa = unwrap(await supabase.from('empresas').select('id, nome, ativo, motivo_bloqueio').eq('id', empresaId).single());
  const filiais = unwrap(
    await supabase
      .from('filiais')
      .select('id, nome, slug, pais, google_maps_url, moeda_principal, aceita_moeda_secundaria, moeda_secundaria, taxa_cambio_secundaria, timezone, ativo')
      .eq('empresa_id', empresaId)
      .order('nome')
  );
  impersonando = { empresa, filiais };
}

// =====================================================================
// SHELL (sidebar + topbar)
// =====================================================================

function montarShell() {
  const shell = document.getElementById('app-shell');
  const filial = filialAtiva();
  const ehGestor = podeGerenciar();
  const ehMaster = ehAdminMaster();
  const temContextoDeEmpresa = !!sessao.perfil || !!impersonando;

  const itensVisiveis = Object.entries(ROTAS).filter(([rotaId, r]) => {
    // A rota #master fica oculta enquanto o Admin Master está
    // impersonando — "Sair da visualização" (na barra de aviso) é o
    // único caminho de volta, para deixar claro que ele não está
    // navegando livremente entre o painel de tenants e o de uma empresa.
    if (rotaId === 'master' && impersonando) return false;
    if (r.somenteAdminMaster && !ehMaster) return false;
    if (r.somenteGestor && !ehGestor) return false;
    if (r.ocultaSeSemPerfil && !temContextoDeEmpresa) return false;
    return true;
  });

  const linksHtml = itensVisiveis
    .map(([rotaId, r]) => `
      <a href="#${rotaId}" data-rota="${rotaId}">
        <span class="icone">${ICONES[rotaId === 'agenda' ? 'schedule' : rotaId === 'config' ? 'settings' : rotaId === 'estoque' ? 'inventory' : rotaId === 'financeiro' ? 'financial' : rotaId === 'clientes' ? 'clients' : rotaId === 'master' ? 'master' : rotaId]}</span>
        <span>${t(r.labelKey, lang)}</span>
      </a>
    `)
    .join('');

  const nomeExibido = impersonando ? sessao.adminMaster?.nome : (sessao.perfil?.nome || sessao.adminMaster?.nome || sessao.user.email);
  const cargoExibido = impersonando
    ? `${t('cargo_admin_master', lang)} → ${impersonando.empresa.nome}`
    : (sessao.perfil?.cargo || (ehMaster ? t('cargo_admin_master', lang) : ''));

  const barraImpersonation = impersonando ? `
    <div class="barra-impersonation" id="barra-impersonation">
      <span>${t('master_visualizando_como', lang)} <strong>${impersonando.empresa.nome}</strong></span>
      <button type="button" id="btn-sair-impersonation">${t('master_sair_visualizacao', lang)}</button>
    </div>
  ` : '';

  shell.innerHTML = `
    ${barraImpersonation}
    <div class="topbar-mobile">
      <button class="botao-menu" id="botao-menu" aria-label="Menu">☰</button>
      <span>Barbearia</span>
    </div>
    <aside class="sidebar" id="sidebar">
      <div class="marca"><span>💈 Barbearia</span></div>
      ${filial ? `<div class="marca"><span class="filial-nome">${filial.nome}</span></div>` : ''}
      <nav id="nav-sidebar">${linksHtml}</nav>
      <div class="rodape-sidebar">
        <span class="usuario-nome">${nomeExibido}</span>
        <span>${cargoExibido}</span>
        <button class="botao-sair" id="botao-sair">${t('nav_sair', lang)}</button>
      </div>
    </aside>
    <main class="conteudo" id="conteudo"><div id="content"></div></main>
  `;

  if (impersonando) {
    document.getElementById('btn-sair-impersonation').addEventListener('click', pararImpersonation);
  }

  document.getElementById('botao-sair').addEventListener('click', logout);

  const botaoMenu = document.getElementById('botao-menu');
  const sidebar = document.getElementById('sidebar');
  botaoMenu.addEventListener('click', () => sidebar.classList.toggle('aberto'));

  // Fecha o menu mobile ao navegar
  document.getElementById('nav-sidebar').addEventListener('click', () => sidebar.classList.remove('aberto'));
}

function marcarLinkAtivo(rotaId) {
  document.querySelectorAll('#nav-sidebar a').forEach((a) => {
    a.classList.toggle('ativo', a.dataset.rota === rotaId);
  });
}

// =====================================================================
// ROTEAMENTO
// =====================================================================

async function rotear() {
  const temContextoDeEmpresa = !!sessao.perfil || !!impersonando;
  let rotaId = (window.location.hash || '').replace('#', '') || (temContextoDeEmpresa ? ROTA_PADRAO : 'master');
  const rota = ROTAS[rotaId];

  const acessoNegado =
    !rota ||
    (rota.somenteGestor && !podeGerenciar()) ||
    (rota.somenteAdminMaster && !ehAdminMaster()) ||
    (rota.ocultaSeSemPerfil && !temContextoDeEmpresa);

  if (acessoNegado) {
    rotaId = temContextoDeEmpresa ? ROTA_PADRAO : 'master';
  }
  const rotaFinal = ROTAS[rotaId];

  marcarLinkAtivo(rotaId);

  const content = document.getElementById('content');
  content.innerHTML = `<div class="tabela-vazia">Carregando…</div>`;

  if (moduloAtual?.destruir) {
    try { moduloAtual.destruir(); } catch { /* módulo não implementou destruir() */ }
  }
  moduloAtual = null;

  try {
    const modulo = await import(rotaFinal.arquivo);
    content.innerHTML = '';
    const instancia = await modulo.init(content, sessaoParaModulo(), { lang, filialAtiva, podeGerenciar, ehAdminMaster, logout });
    moduloAtual = instancia || null;
  } catch (e) {
    console.error(`[admin.js] Falha ao carregar módulo ${rotaFinal.arquivo}:`, e);
    content.innerHTML = `<div class="tabela-vazia">Não foi possível carregar esta seção.</div>`;
  }
}

/**
 * Monta o objeto `sessao` que os módulos recebem. Fora do modo
 * impersonation, é a sessão real, sem mudanças. Em impersonation, gera
 * um `perfil` sintético com cargo 'proprietario' e a empresa_id da
 * empresa visualizada — assim dashboard.js, pdv.js, settings.js etc.
 * (que leem sessao.perfil.empresa_id diretamente) continuam funcionando
 * sem precisar conhecer o conceito de impersonation. `sessao.perfil.id`
 * fica como o id real do Admin Master, para que campos como
 * `criado_por`/`perfis(nome)` em inserts continuem rastreáveis — como a
 * RLS dá bypass total para is_admin_master(), gravar com esse id não
 * quebra nenhuma policy.
 */
function sessaoParaModulo() {
  if (!impersonando) return sessao;
  return {
    ...sessao,
    perfil: {
      id: sessao.user.id,
      empresa_id: impersonando.empresa.id,
      filial_id: impersonando.filiais[0]?.id ?? null,
      nome: sessao.adminMaster?.nome || 'Admin Master',
      cargo: 'proprietario',
      ativo: true,
    },
    empresa: impersonando.empresa,
    filiais: impersonando.filiais,
  };
}

iniciar();
