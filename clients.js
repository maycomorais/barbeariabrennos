// =====================================================================
// clients.js — módulo "Clientes / CRM" do roteador admin.js (Fase 5).
// Duas abas: busca/ficha do cliente (preferências, pontos, pacotes
// ativos, histórico de visitas, resgate de fidelidade) e aniversariantes
// do mês. Resgate usa fn_resgatar_fidelidade (Seção 17 do schema), que
// já valida saldo suficiente de forma atômica.
// =====================================================================

import { abrirModal, fecharModal } from './modal.js';
import { esc, mostrarErro } from './util.js';
import { campoTexto, campoTextarea, valorTexto } from './form.js';
import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatPrecoFilial, formatDateTime } from './formatters.js';

let sessao, lang, filial, raiz;
let abaAtual = 'ficha';
let clienteAtual = null;
let fidelidadeConfig = null;

export async function init(root, sessaoAtual, ctx) {
  raiz = root;
  sessao = sessaoAtual;
  filial = ctx.filialAtiva();
  lang = ctx.lang;
  clienteAtual = null;

  fidelidadeConfig = unwrap(
    await supabase.from('fidelidade_config').select('*').eq('empresa_id', sessao.perfil.empresa_id).maybeSingle()
  );

  raiz.innerHTML = `
    <div class="cabecalho-pagina"><h1>${t('cli_titulo', lang)}</h1></div>
    <div class="tabs" id="tabs-clientes">
      <button data-tab="ficha" class="ativo">${t('cli_tab_ficha', lang)}</button>
      <button data-tab="aniversariantes">${t('cli_tab_aniversariantes', lang)}</button>
    </div>
    <div id="clientes-conteudo"></div>
  `;

  raiz.querySelectorAll('#tabs-clientes button').forEach((btn) => {
    btn.addEventListener('click', () => {
      raiz.querySelectorAll('#tabs-clientes button').forEach((b) => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      abaAtual = btn.dataset.tab;
      renderAba();
    });
  });

  renderAba();
}

function renderAba() {
  if (abaAtual === 'ficha') return renderBusca();
  if (abaAtual === 'aniversariantes') return renderAniversariantes();
}

function painel() {
  return raiz.querySelector('#clientes-conteudo');
}

// =====================================================================
// BUSCA + FICHA DO CLIENTE
// =====================================================================

function renderBusca() {
  const p = painel();
  p.innerHTML = `
    <div class="campo mt-1" style="max-width:420px">
      <input type="text" id="busca-cliente-crm" placeholder="${t('cli_buscar', lang)}" autocomplete="off" />
    </div>
    <div id="resultados-busca-crm" class="mt-1"></div>
    <div id="ficha-cliente-crm" class="mt-1"></div>
  `;

  // Carregar todos os clientes inicialmente
  carregarTodosClientes();

  const input = p.querySelector('#busca-cliente-crm');
  let timeoutId;
  input.addEventListener('input', () => {
    clearTimeout(timeoutId);
    const termo = input.value.trim();
    if (termo.length < 2) {
      carregarTodosClientes();
    } else {
      timeoutId = setTimeout(() => buscarClientes(termo), 300);
    }
  });
}

async function carregarTodosClientes() {
  const resultadosEl = painel().querySelector('#resultados-busca-crm');
  const fichaEl = painel().querySelector('#ficha-cliente-crm');
  fichaEl.innerHTML = '';

  const clientes = unwrap(
    await supabase
      .from('clientes')
      .select('id, nome, telefone')
      .eq('empresa_id', sessao.perfil.empresa_id)
      .order('nome')
      .limit(50)
  );

  if (clientes.length === 0) {
    resultadosEl.innerHTML = `<div class="silencioso">${t('cli_sem_resultado', lang)}</div>`;
    return;
  }

  resultadosEl.innerHTML = `
    <div class="pdv-resultados-cliente">
      ${clientes.map((c) => `<button type="button" data-id="${c.id}">${esc(c.nome)}${c.telefone ? ` — ${esc(c.telefone)}` : ''}</button>`).join('')}
    </div>
  `;
  resultadosEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => abrirFicha(btn.dataset.id));
  });
}

async function buscarClientes(termo) {
  const resultadosEl = painel().querySelector('#resultados-busca-crm');
  const fichaEl = painel().querySelector('#ficha-cliente-crm');
  fichaEl.innerHTML = '';

  if (termo.length < 2) {
    resultadosEl.innerHTML = '';
    return;
  }

  const [porNome, porTelefone] = await Promise.all([
    supabase.from('clientes').select('id, nome, telefone').eq('empresa_id', sessao.perfil.empresa_id).ilike('nome', `%${termo}%`).limit(8).then(unwrap),
    supabase.from('clientes').select('id, nome, telefone').eq('empresa_id', sessao.perfil.empresa_id).ilike('telefone', `%${termo}%`).limit(8).then(unwrap),
  ]);
  const vistos = new Set();
  const resultados = [...porNome, ...porTelefone].filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true)));

  if (resultados.length === 0) {
    resultadosEl.innerHTML = `<div class="silencioso">${t('cli_sem_resultado', lang)}</div>`;
    return;
  }

  resultadosEl.innerHTML = `
    <div class="pdv-resultados-cliente">
      ${resultados.map((c) => `<button type="button" data-id="${c.id}">${esc(c.nome)}${c.telefone ? ` — ${esc(c.telefone)}` : ''}</button>`).join('')}
    </div>
  `;
  resultadosEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => abrirFicha(btn.dataset.id));
  });
}

async function abrirFicha(clienteId) {
  const fichaEl = painel().querySelector('#ficha-cliente-crm');
  fichaEl.innerHTML = `<div class="tabela-vazia">Carregando…</div>`;

  const [cliente, preferencias, pacotes, visitas] = await Promise.all([
    supabase.from('clientes').select('*').eq('id', clienteId).single().then(unwrap),
    supabase.from('preferencias_cliente').select('id, observacao, created_at').eq('cliente_id', clienteId).order('created_at', { ascending: false }).then(unwrap),
    supabase.from('vw_pacotes_cliente_ativos').select('id, pacote_nome, sessoes_restantes, data_validade').eq('cliente_id', clienteId).then(unwrap),
    supabase.from('vendas').select('id, total, created_at, forma_pagamento').eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(10).then(unwrap),
  ]);

  clienteAtual = cliente;
  renderFicha(fichaEl, cliente, preferencias, pacotes, visitas);
}

function renderFicha(fichaEl, cliente, preferencias, pacotes, visitas) {
  const podeResgatar = fidelidadeConfig?.ativo && cliente.pontos_fidelidade >= (fidelidadeConfig?.pontos_para_resgate ?? Infinity);

  fichaEl.innerHTML = `
    <div class="cartao mt-1">
      <div class="flex-entre">
        <h2>${esc(cliente.nome)}</h2>
        <button type="button" class="botao botao-secundario" id="btn-fechar-ficha">${t('cli_voltar_lista', lang)}</button>
      </div>
      <div class="grade-cartoes mt-1">
        <div class="cartao cartao-metrica">
          <p class="rotulo">${t('cli_pontos_fidelidade', lang)}</p>
          <p class="valor">${cliente.pontos_fidelidade}</p>
        </div>
        <div class="cartao cartao-metrica">
          <p class="rotulo">${t('cli_saldo_fiado', lang)}</p>
          <p class="valor">${formatPrecoFilial(cliente.saldo_fiado, filial)}</p>
        </div>
      </div>

      <div class="mt-1">
        ${cliente.telefone ? `<p><strong>${t('cli_telefone', lang)}:</strong> ${esc(cliente.telefone)}</p>` : ''}
        ${cliente.email ? `<p><strong>${t('cli_email', lang)}:</strong> ${esc(cliente.email)}</p>` : ''}
        ${cliente.data_nascimento ? `<p><strong>${t('cli_data_nascimento', lang)}:</strong> ${formatarDataSimples(cliente.data_nascimento)}</p>` : ''}
      </div>

      ${fidelidadeConfig?.ativo ? `
        <div class="acoes-formulario mt-1">
          <button type="button" class="botao botao-acento" id="btn-resgatar" ${podeResgatar ? '' : 'disabled'}>
            ${t('cli_resgatar_pontos', lang)} (${fidelidadeConfig.pontos_para_resgate} ${t('cli_pontos_necessarios', lang)})
          </button>
        </div>
        <div id="erro-resgate" class="mensagem-erro oculto mt-1"></div>
      ` : `<p class="silencioso mt-1">${t('cli_programa_inativo', lang)}</p>`}
    </div>

    <div class="cartao mt-1">
      <div class="flex-entre">
        <h3>${t('cli_preferencias', lang)}</h3>
        <button type="button" class="botao botao-secundario" id="btn-nova-preferencia">${t('cli_nova_preferencia', lang)}</button>
      </div>
      <div class="mt-1">
        ${preferencias.length === 0 ? `<p class="silencioso">${t('cli_sem_preferencias', lang)}</p>` : `
          <ul style="padding-left:1.1rem; display:flex; flex-direction:column; gap:0.4rem;">
            ${preferencias.map((p) => `<li>${esc(p.observacao)} <span class="silencioso">— ${formatarDataSimples(p.created_at)}</span></li>`).join('')}
          </ul>
        `}
      </div>
    </div>

    <div class="cartao mt-1">
      <div class="flex-entre">
        <h3>${t('cli_pacotes_ativos', lang)}</h3>
        <button type="button" class="botao botao-acento" id="btn-gerenciar-pacotes">${t('cli_gerenciar_pacotes', lang)}</button>
      </div>
      <div class="mt-1" id="lista-pacotes-cliente">
        ${pacotes.length === 0 ? `<p class="silencioso">${t('cli_sem_pacotes', lang)}</p>` : `
          <ul style="padding-left:1.1rem; display:flex; flex-direction:column; gap:0.4rem;">
            ${pacotes.map((p) => `
              <li>
                <strong>${esc(p.pacote_nome)}</strong> — ${p.sessoes_restantes} ${t('cli_sessoes_restantes', lang)}
                ${p.data_validade ? ` (${t('cli_validade_ate', lang)} ${formatarDataSimples(p.data_validade)})` : ''}
                <button class="botao botao-perigo" data-pacote-id="${p.id}" data-acao="cancelar-pacote" style="font-size:0.7rem; padding:0.2rem 0.5rem; margin-left:0.5rem;">Cancelar</button>
              </li>
            `).join('')}
          </ul>
        `}
      </div>
    </div>

    <div class="cartao mt-1">
      <h3>${t('cli_historico_visitas', lang)}</h3>
      <div class="tabela-wrap mt-1">
        ${visitas.length === 0 ? `<div class="tabela-vazia">${t('cli_sem_visitas', lang)}</div>` : `
          <table>
            <thead><tr><th>Data</th><th>Total</th><th>Pagamento</th></tr></thead>
            <tbody>
              ${visitas.map((v) => `<tr><td>${formatDateTime(v.created_at, filial)}</td><td class="preco">${formatPrecoFilial(v.total, filial)}</td><td>${esc(v.forma_pagamento)}</td></tr>`).join('')}
            </tbody>
          </table>
        `}
      </div>
    </div>
  `;

  // ---- Botão cancelar pacote diretamente na lista ----
  fichaEl.querySelectorAll('[data-acao="cancelar-pacote"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pacoteId = btn.dataset.pacoteId;
      if (!confirm('Deseja cancelar este pacote? As sessões restantes serão perdidas.')) return;
      try {
        await supabase.from('pacotes_cliente').update({ status: 'cancelado' }).eq('id', pacoteId);
        await abrirFicha(cliente.id);
      } catch (e) {
        alert('Erro ao cancelar pacote: ' + e.message);
      }
    });
  });

  // ---- Botão "Gerenciar Pacotes" (amarelo) ----
  const btnGerenciar = fichaEl.querySelector('#btn-gerenciar-pacotes');
  if (btnGerenciar) {
    btnGerenciar.addEventListener('click', () => {
      abrirModalGerenciarPacotes(cliente.id, fichaEl);
    });
  }

  fichaEl.querySelector('#btn-fechar-ficha').addEventListener('click', () => {
    clienteAtual = null;
    fichaEl.innerHTML = '';
  });

  fichaEl.querySelector('#btn-nova-preferencia').addEventListener('click', () => abrirFormPreferencia(cliente.id, fichaEl));

  const btnResgatar = fichaEl.querySelector('#btn-resgatar');
  if (btnResgatar) {
    btnResgatar.addEventListener('click', async () => {
      const erroEl = fichaEl.querySelector('#erro-resgate');
      btnResgatar.disabled = true;
      try {
        unwrap(await supabase.rpc('fn_resgatar_fidelidade', { p_cliente_id: cliente.id }));
        await abrirFicha(cliente.id);
      } catch (e) {
        erroEl.textContent = e.message;
        erroEl.classList.remove('oculto');
        btnResgatar.disabled = false;
      }
    });
  }
}

// =====================================================================
// MODAL GERENCIAR PACOTES
// =====================================================================

async function abrirModalGerenciarPacotes(clienteId, fichaEl) {
  const pacotes = unwrap(
    await supabase
      .from('pacotes_cliente')
      .select('*, pacotes_servico(nome)')
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
  );

  const overlay = abrirModal('Gerenciar Pacotes', `
    <div class="tabela-wrap">
      ${pacotes.length === 0 ? `<div class="tabela-vazia">Nenhum pacote encontrado para este cliente.</div>` : `
      <table>
        <thead><tr><th>Pacote</th><th>Sessões restantes</th><th>Status</th><th>Validade</th><th>Ações</th></tr></thead>
        <tbody>
          ${pacotes.map(p => `
            <tr>
              <td>${esc(p.pacotes_servico?.nome || '—')}</td>
              <td>${p.sessoes_restantes}</td>
              <td><span class="badge ${p.status === 'ativo' ? 'badge-sage' : 'badge-neutro'}">${p.status}</span></td>
              <td>${p.data_validade ? formatarDataSimples(p.data_validade) : '—'}</td>
              <td>
                ${p.status === 'ativo' ? `<button class="botao botao-perigo" data-id="${p.id}" data-acao="cancelar-pacote-modal">Cancelar</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>
    <div class="acoes-formulario"><button type="button" class="botao botao-secundario" data-fechar-modal>Fechar</button></div>
  `);

  overlay.querySelectorAll('[data-acao="cancelar-pacote-modal"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancelar este pacote?')) return;
      await supabase.from('pacotes_cliente').update({ status: 'cancelado' }).eq('id', btn.dataset.id);
      fecharModal(overlay);
      await abrirModalGerenciarPacotes(clienteId, fichaEl); // recarrega o modal
      if (fichaEl) await abrirFicha(clienteId); // recarrega a ficha se disponível
    });
  });
}

// =====================================================================
// PREFERÊNCIAS
// =====================================================================

function abrirFormPreferencia(clienteId, fichaEl) {
  const overlay = abrirModal(t('cli_nova_preferencia', lang), `
    <form id="form-preferencia">
      ${campoTextarea({ id: 'observacao', label: t('cli_preferencias', lang), ajuda: t('cli_preferencia_placeholder', lang) })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-preferencia');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    const observacao = valorTexto(form, 'observacao');
    if (!observacao) {
      erroEl.textContent = 'Descreva a preferência.';
      erroEl.classList.remove('oculto');
      return;
    }
    try {
      unwrap(await supabase.from('preferencias_cliente').insert({ cliente_id: clienteId, observacao, criado_por: sessao.perfil.id }));
      fecharModal(overlay);
      await abrirFicha(clienteId);
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

// =====================================================================
// ANIVERSARIANTES DO MÊS
// =====================================================================

async function renderAniversariantes() {
  const p = painel();
  p.innerHTML = `<div class="tabela-vazia">Carregando…</div>`;

  const todos = unwrap(
    await supabase.from('clientes').select('id, nome, telefone, data_nascimento').eq('empresa_id', sessao.perfil.empresa_id).not('data_nascimento', 'is', null)
  );

  const mesAtual = new Date().getMonth() + 1;
  const aniversariantes = todos
    .filter((c) => Number(c.data_nascimento.slice(5, 7)) === mesAtual)
    .sort((a, b) => a.data_nascimento.slice(8, 10) - b.data_nascimento.slice(8, 10));

  if (aniversariantes.length === 0) {
    p.innerHTML = `<div class="tabela-vazia mt-1">${t('cli_sem_aniversariantes', lang)}</div>`;
    return;
  }

  const linhas = aniversariantes.map((c) => `
    <tr>
      <td>${esc(c.nome)}</td>
      <td class="silencioso">${esc(c.telefone || '—')}</td>
      <td>${t('cli_aniversario_em', lang)} ${Number(c.data_nascimento.slice(8, 10))}</td>
      <td class="coluna-acoes">${c.telefone ? `<a class="botao botao-secundario" href="https://wa.me/${c.telefone.replace(/\D/g, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</td>
    </tr>
  `).join('');

  p.innerHTML = `
    <div class="tabela-wrap mt-1">
      <table>
        <thead><tr><th>${t('campo_nome', lang)}</th><th>${t('cli_telefone', lang)}</th><th></th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}

function formatarDataSimples(dataISO) {
  const lang2 = filial?.pais === 'PY' ? 'es-PY' : 'pt-BR';
  const [ano, mes, dia] = dataISO.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(lang2, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ano, mes - 1, dia));
}