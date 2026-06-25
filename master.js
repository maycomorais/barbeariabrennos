// =====================================================================
// master.js — módulo "Empresas" do roteador admin.js, exclusivo para
// admins master (Project Glasswing... não, é só gestão de tenants ;)
//
// Lista todas as empresas (a RLS já dá bypass total para is_admin_master(),
// então as mesmas queries de sempre retornam tudo, sem policy nova),
// permite bloquear/desbloquear com motivo, e criar uma empresa nova.
//
// IMPORTANTE: criar uma empresa aqui cria SÓ o registro em `empresas`.
// Filiais, equipe e catálogo continuam sendo cadastrados pelo próprio
// cliente em Configurações, depois que ele tiver um usuário com perfil
// de proprietário criado para essa empresa — isso ainda não tem um
// fluxo de "convidar o primeiro proprietário" e fica para uma iteração
// futura (hoje só existe convidar-membro, que pressupõe um proprietário
// já logado convidando outros).
//
// Sobre criar o PRIMEIRO admin master: não existe e não deve existir
// endpoint público para isso. A tabela admins_master só aceita INSERT
// quando is_admin_master() já é verdadeiro (chicken-and-egg proposital).
// O primeiro admin master de uma instalação é sempre criado manualmente
// via SQL Editor do Supabase, com a service role:
//
//   insert into admins_master (id, nome) values ('<auth.users.id>', 'Nome');
//
// =====================================================================

import { abrirModal, fecharModal } from './modal.js';
import { esc } from './util.js';
import { campoTexto, campoTextarea, valorTexto } from './form.js';
import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatDateTime } from './formatters.js';

let sessao, lang, raiz;
let empresas = [];

export async function init(root, sessaoAtual, ctx) {
  raiz = root;
  sessao = sessaoAtual;
  lang = ctx.lang;

  raiz.innerHTML = `
    <div class="cabecalho-pagina">
      <div><h1>${t('master_titulo', lang)}</h1></div>
      <button class="botao botao-acento" id="btn-nova-empresa">${t('master_nova_empresa', lang)}</button>
    </div>
    <div class="campo mt-1" style="max-width:420px">
      <input type="text" id="busca-empresa" placeholder="${t('master_buscar', lang)}" autocomplete="off" />
    </div>
    <div class="tabela-wrap mt-1" id="tabela-empresas"><div class="tabela-vazia">Carregando…</div></div>
  `;

  raiz.querySelector('#btn-nova-empresa').addEventListener('click', abrirFormNovaEmpresa);
  raiz.querySelector('#busca-empresa').addEventListener('input', (ev) => renderTabela(ev.target.value.trim()));

  await carregarEmpresas();
  renderTabela('');
}

async function carregarEmpresas() {
  // is_admin_master() dá bypass de RLS — esta mesma query, para um
  // usuário comum, retornaria só a própria empresa.
  empresas = unwrap(await supabase.from('empresas').select('id, nome, ativo, motivo_bloqueio, bloqueado_em, created_at').order('created_at', { ascending: false }));

  // Para cada empresa, descobre se já tem algum membro de equipe — usado
  // para decidir se mostra "Convidar proprietário" (só faz sentido numa
  // empresa recém-criada, ainda sem ninguém).
  const contagens = unwrap(await supabase.from('perfis').select('empresa_id'));
  const totalPorEmpresa = {};
  contagens.forEach((p) => { totalPorEmpresa[p.empresa_id] = (totalPorEmpresa[p.empresa_id] || 0) + 1; });
  empresas = empresas.map((e) => ({ ...e, temEquipe: (totalPorEmpresa[e.id] || 0) > 0 }));
}

function renderTabela(filtro) {
  const tabelaEl = raiz.querySelector('#tabela-empresas');
  const lista = filtro ? empresas.filter((e) => e.nome.toLowerCase().includes(filtro.toLowerCase())) : empresas;

  if (lista.length === 0) {
    tabelaEl.innerHTML = `<div class="tabela-vazia">${filtro ? t('cli_sem_resultado', lang) : t('master_sem_empresas', lang)}</div>`;
    return;
  }

  const linhas = lista.map((e) => `
    <tr>
      <td>
        <strong>${esc(e.nome)}</strong>
        ${e.motivo_bloqueio ? `<div class="silencioso">${esc(e.motivo_bloqueio)}</div>` : ''}
        ${!e.temEquipe ? `<div class="silencioso">${t('master_sem_equipe', lang)}</div>` : ''}
      </td>
      <td>${e.ativo ? `<span class="badge badge-sage">${t('master_status_ativa', lang)}</span>` : `<span class="badge badge-clay">${t('master_status_bloqueada', lang)}</span>`}</td>
      <td class="silencioso">${t('master_criada_em', lang)} ${formatDateTime(e.created_at, null)}</td>
      <td class="coluna-acoes">
        ${!e.temEquipe ? `<button class="botao botao-acento btn-convidar" data-id="${e.id}" data-nome="${esc(e.nome)}">${t('master_convidar_proprietario', lang)}</button>` : ''}
        ${e.temEquipe && e.ativo ? `<button class="botao botao-secundario btn-entrar-como" data-id="${e.id}">${t('master_entrar_como', lang)}</button>` : ''}
        ${e.ativo
          ? `<button class="botao botao-perigo btn-bloquear" data-id="${e.id}">${t('master_acao_bloquear', lang)}</button>`
          : `<button class="botao botao-acento btn-desbloquear" data-id="${e.id}">${t('master_acao_desbloquear', lang)}</button>`}
          <button class="botao botao-perigo btn-excluir" data-id="${e.id}" data-nome="${esc(e.nome)}" style="background:#c0392b; color: #fff">🗑️ Excluir</button>
      </td>
    </tr>
  `).join('');

  tabelaEl.innerHTML = `
    <table>
      <thead><tr><th>${t('campo_nome', lang)}</th><th>Status</th><th></th><th></th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  `;

  tabelaEl.querySelectorAll('.btn-bloquear').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormBloqueio(lista.find((e) => e.id === btn.dataset.id)));
  });
  tabelaEl.querySelectorAll('.btn-desbloquear').forEach((btn) => {
    btn.addEventListener('click', () => desbloquearEmpresa(lista.find((e) => e.id === btn.dataset.id)));
  });
  tabelaEl.querySelectorAll('.btn-excluir').forEach((btn) => {
    btn.addEventListener('click', () => {
      const empresa = lista.find((e) => e.id === btn.dataset.id);
      if (empresa) excluirEmpresa(empresa);
    });
  });
  tabelaEl.querySelectorAll('.btn-convidar').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormConvidarProprietario(lista.find((e) => e.id === btn.dataset.id)));
  });
  tabelaEl.querySelectorAll('.btn-entrar-como').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // Import dinâmico para evitar dependência circular: admin.js
      // importa master.js sob demanda (rota #master), então um import
      // estático aqui no topo do arquivo criaria um ciclo.
      const { iniciarImpersonation } = await import('./admin.js');
      await iniciarImpersonation(btn.dataset.id);
    });
  });
}

// =====================================================================
// EXCLUIR EMPRESA PERMANENTEMENTE (admin_master only)
// =====================================================================

async function excluirEmpresa(empresa) {
  // 1. Confirmação textual (dupla segurança)
  if (!confirm(`⚠️ ATENÇÃO: Você está prestes a EXCLUIR PERMANENTEMENTE a empresa "${empresa.nome}" e TODOS os seus dados (filiais, equipe, serviços, produtos, vendas, agendamentos, etc.).\n\nEsta ação é IRREVERSÍVEL.\n\nDigite "EXCLUIR" para confirmar.`)) {
    return;
  }
  const confirmacao = prompt(`Digite EXCLUIR para confirmar a exclusão de "${empresa.nome}":`);
  if (confirmacao !== 'EXCLUIR') {
    alert('❌ Exclusão cancelada.');
    return;
  }

  try {
    // 2. Tenta excluir diretamente (se as FKs tiverem ON DELETE CASCADE)
    const { error } = await supabase.rpc('excluir_empresa_cascata', { p_empresa_id: empresa.id });

    if (error) {
      // Se houver erro de chave estrangeira, orienta o usuário
      if (error.code === '23503') {
        alert(`❌ Não foi possível excluir: existem registros filhos (filiais, perfis, etc.) vinculados à empresa "${empresa.nome}".\n\nPara excluir, primeiro remova manualmente os dados filhos ou execute o script SQL de exclusão em cascata fornecido no console.`);
        console.error('Erro de FK ao excluir empresa:', error);
        return;
      }
      throw error;
    }

    alert(`✅ Empresa "${empresa.nome}" excluída com sucesso!`);
    // 3. Recarrega a lista
    await carregarEmpresas();
    renderTabela(raiz.querySelector('#busca-empresa')?.value || '');
  } catch (e) {
    alert(`❌ Erro ao excluir empresa: ${e.message}`);
    console.error(e);
  }
}

// =====================================================================
// BLOQUEIO / DESBLOQUEIO
// =====================================================================

function abrirFormBloqueio(empresa) {
  const overlay = abrirModal(esc(empresa.nome), `
    <form id="form-bloqueio">
      ${campoTextarea({ id: 'motivo', label: t('master_motivo_bloqueio', lang), obrigatorio: true })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-perigo">${t('master_confirmar_bloqueio', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-bloqueio');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    const motivo = valorTexto(form, 'motivo');

    if (!motivo) {
      erroEl.textContent = t('master_motivo_obrigatorio', lang);
      erroEl.classList.remove('oculto');
      return;
    }

    try {
      unwrap(await supabase.from('empresas').update({ ativo: false, motivo_bloqueio: motivo, bloqueado_em: new Date().toISOString() }).eq('id', empresa.id));
      fecharModal(overlay);
      await carregarEmpresas();
      renderTabela(raiz.querySelector('#busca-empresa').value.trim());
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

async function desbloquearEmpresa(empresa) {
  if (!window.confirm(t('master_confirmar_desbloqueio', lang))) return;

  try {
    unwrap(await supabase.from('empresas').update({ ativo: true, motivo_bloqueio: null, bloqueado_em: null }).eq('id', empresa.id));
    await carregarEmpresas();
    renderTabela(raiz.querySelector('#busca-empresa').value.trim());
  } catch (e) {
    window.alert(e.message);
  }
}

// =====================================================================
// CONVIDAR PRIMEIRO PROPRIETÁRIO
// =====================================================================
// Chama a Edge Function convidar-membro (roda com service role). Essa
// function é compartilhada com o fluxo normal de "proprietário convida
// equipe" — ela detecta sozinha, pelo token de quem chama, se é um
// Admin Master (usa empresa_id do payload) ou um proprietário/gerente
// comum (usa a própria empresa, ignorando qualquer empresa_id enviado).

function abrirFormConvidarProprietario(empresa) {
  const overlay = abrirModal(`${t('master_convidar_proprietario', lang)} — ${esc(empresa.nome)}`, `
    <form id="form-convidar-proprietario">
      ${campoTexto({ id: 'nome', label: t('campo_nome', lang), obrigatorio: true })}
      ${campoTexto({ id: 'email', label: 'E-mail', tipo: 'email', obrigatorio: true })}
      <p class="silencioso mt-1">${t('master_convidar_ajuda', lang)}</p>
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('master_enviar_convite', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-convidar-proprietario');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    erroEl.classList.add('oculto');

    const nome = valorTexto(form, 'nome');
    const email = form.querySelector('#email').value.trim();
    if (!nome || !email) {
      erroEl.textContent = 'Informe nome e e-mail.';
      erroEl.classList.remove('oculto');
      return;
    }

    const botaoSubmit = form.querySelector('button[type="submit"]');
    botaoSubmit.disabled = true;

    try {
      const { error } = await supabase.functions.invoke('convidar-membro', {
        body: { nome, email, empresa_id: empresa.id, cargo: 'proprietario' },
      });
      if (error) throw new Error(error.message || 'Não foi possível enviar o convite.');

      fecharModal(overlay);
      await carregarEmpresas();
      renderTabela(raiz.querySelector('#busca-empresa').value.trim());
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
      botaoSubmit.disabled = false;
    }
  });
}

// =====================================================================
// NOVA EMPRESA
// =====================================================================

function abrirFormNovaEmpresa() {
  const overlay = abrirModal(t('master_nova_empresa', lang), `
    <form id="form-nova-empresa">
      ${campoTexto({ id: 'nome', label: t('master_nome_empresa', lang), obrigatorio: true })}
      <p class="silencioso mt-1">${t('master_criar_empresa_ajuda', lang)}</p>
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-nova-empresa');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    const nome = valorTexto(form, 'nome');

    if (!nome) {
      erroEl.textContent = 'Informe o nome da empresa.';
      erroEl.classList.remove('oculto');
      return;
    }

    try {
      unwrap(await supabase.from('empresas').insert({ nome }));
      fecharModal(overlay);
      await carregarEmpresas();
      renderTabela('');
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}
