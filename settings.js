// =====================================================================
// settings.js — módulo "Configurações" do roteador admin.js.
// Cadastros base (Fase 1): Filiais, Equipe, Serviços, Produtos, Combos,
// Pacotes, Horários de Funcionamento.
// Acesso restrito a proprietario/gerente (RLS já garante isso no banco;
// aqui é só uma camada de UX).
// =====================================================================

import { abrirModal, fecharModal } from './modal.js';
import { esc, mostrarErro } from './util.js';
import {
  campoTexto, campoTextarea, campoNumero, campoSelect, campoCheckbox,
  valorTexto, valorNumero, valorChecked,
} from './form.js';
import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatPrecoFilial } from './formatters.js';
import { CARGO_LABELS, diasSemana } from './constants.js';

const MOEDAS = [
  { valor: 'BRL', texto: 'Real (BRL)' },
  { valor: 'PYG', texto: 'Guarani (PYG)' },
  { valor: 'USD', texto: 'Dólar (USD)' },
];

const PAISES = [
  { valor: 'PY', texto: 'Paraguai' },
  { valor: 'BR', texto: 'Brasil' },
];

const TIMEZONES = [
  { valor: 'America/Asuncion', texto: 'Assunção (PY)' },
  { valor: 'America/Sao_Paulo', texto: 'São Paulo (BR)' },
  { valor: 'America/Manaus', texto: 'Manaus (BR)' },
  { valor: 'America/Campo_Grande', texto: 'Campo Grande (BR)' },
];

const UNIDADES = [
  { valor: 'un', texto: 'unidade' },
  { valor: 'ml', texto: 'ml' },
  { valor: 'g', texto: 'g' },
  { valor: 'l', texto: 'litro' },
  { valor: 'kg', texto: 'kg' },
];

let sessao, lang, filialRef, raiz;
let filialHorariosId = null;

export async function init(root, sessaoAtual, ctx) {
  raiz = root;
  sessao = sessaoAtual;
  filialRef = ctx.filialAtiva();
  lang = ctx.lang;

  if (!ctx.podeGerenciar()) {
    raiz.innerHTML = `
      <div class="cabecalho-pagina"><h1>${t('config_titulo', lang)}</h1></div>
      <div class="cartao">
        <p>Esta área é restrita a proprietários e gerentes.</p>
      </div>
    `;
    return;
  }

  raiz.innerHTML = `
    <div class="cabecalho-pagina"><h1>${t('config_titulo', lang)}</h1></div>
    <div class="tabs" id="tabs">
      <button data-tab="filiais" class="ativo">${t('tab_filiais', lang)}</button>
      <button data-tab="equipe">${t('tab_barbeiros', lang)}</button>
      <button data-tab="servicos">${t('tab_servicos', lang)}</button>
      <button data-tab="produtos">${t('tab_produtos', lang)}</button>
      <button data-tab="combos">${t('tab_combos', lang)}</button>
      <button data-tab="pacotes">${t('tab_pacotes', lang)}</button>
      <button data-tab="horarios">${t('tab_horarios', lang)}</button>
    </div>
    <div id="tab-conteudo"></div>
  `;

  raiz.querySelectorAll('#tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      raiz.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      renderTab(btn.dataset.tab);
    });
  });

  renderTab('filiais');
}

function renderTab(tab) {
  if (tab === 'filiais') return renderFiliais();
  if (tab === 'equipe') return renderEquipe();
  if (tab === 'servicos') return renderServicos();
  if (tab === 'produtos') return renderProdutos();
  if (tab === 'combos') return renderCombos();
  if (tab === 'pacotes') return renderPacotes();
  if (tab === 'horarios') return renderHorarios();
}

function painelAlvo() {
  return raiz.querySelector('#tab-conteudo');
}

function botaoNovo(label) {
  return `<div class="flex-entre mt-1"><span></span><button class="botao botao-acento" id="btn-novo">+ ${label}</button></div>`;
}

// =====================================================================
// FILIAIS
// =====================================================================

async function renderFiliais() {
  const filiais = unwrap(await supabase.from('filiais').select('*').order('nome'));
  const painel = painelAlvo();

  const linhas = filiais
    .map((f) => `
      <tr>
        <td>${esc(f.nome)}</td>
        <td>${f.pais}</td>
        <td>${f.moeda_principal}${f.aceita_moeda_secundaria ? ` / ${f.moeda_secundaria}` : ''}</td>
        <td>${f.ativo ? `<span class="badge badge-sage">Ativa</span>` : `<span class="badge badge-neutro">Inativa</span>`}</td>
        <td class="coluna-acoes">
          <button class="botao botao-secundario btn-editar" data-id="${f.id}">${t('acao_editar', lang)}</button>
        </td>
      </tr>
    `)
    .join('');

  painel.innerHTML = `
    ${botaoNovo(t('acao_novo', lang))}
    <div class="tabela-wrap mt-1">
      ${filiais.length === 0 ? `<div class="tabela-vazia">Nenhuma filial cadastrada.</div>` : `
      <table>
        <thead><tr><th>${t('campo_nome', lang)}</th><th>${t('campo_pais', lang)}</th><th>Moeda</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`}
    </div>
  `;

  raiz.querySelector('#btn-novo').addEventListener('click', () => abrirFormFilial(null));
  painel.querySelectorAll('.btn-editar').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filial = filiais.find((f) => f.id === btn.dataset.id);
      abrirFormFilial(filial);
    });
  });
}

function abrirFormFilial(filial) {
  const ehNovo = !filial;
  const f = filial || {
    nome: '', slug: '', pais: 'PY', endereco: '', google_maps_url: '', telefone: '',
    timezone: 'America/Asuncion', moeda_principal: 'PYG', aceita_moeda_secundaria: false,
    moeda_secundaria: 'BRL', taxa_cambio_secundaria: '', ativo: true,
  };

  const overlay = abrirModal(ehNovo ? `${t('tab_filiais', lang)} — ${t('acao_novo', lang)}` : esc(f.nome), `
    <form id="form-filial">
      ${campoTexto({ id: 'nome', label: t('campo_nome', lang), valor: f.nome, obrigatorio: true })}
      ${campoTexto({ id: 'slug', label: 'Slug (URL pública)', valor: f.slug, ajuda: 'Ex.: matriz-asuncion. Usado no link público de agendamento.' })}
      ${campoSelect({ id: 'pais', label: t('campo_pais', lang), valor: f.pais, opcoes: PAISES, obrigatorio: true })}
      ${campoTexto({ id: 'endereco', label: t('campo_endereco', lang), valor: f.endereco })}
      ${campoTexto({ id: 'maps', label: t('campo_maps', lang), valor: f.google_maps_url, tipo: 'url', placeholder: 'https://maps.google.com/?q=...' })}
      ${campoTexto({ id: 'telefone', label: 'Telefone', valor: f.telefone })}
      ${campoSelect({ id: 'timezone', label: 'Fuso horário', valor: f.timezone, opcoes: TIMEZONES, obrigatorio: true })}
      ${campoSelect({ id: 'moeda_principal', label: t('campo_moeda_principal', lang), valor: f.moeda_principal, opcoes: MOEDAS, obrigatorio: true })}
      ${campoCheckbox({ id: 'aceita_secundaria', label: t('campo_aceita_moeda_secundaria', lang), marcado: f.aceita_moeda_secundaria })}
      <div id="bloco-moeda-secundaria" class="${f.aceita_moeda_secundaria ? '' : 'oculto'}">
        ${campoSelect({ id: 'moeda_secundaria', label: t('campo_moeda_secundaria', lang), valor: f.moeda_secundaria || 'BRL', opcoes: MOEDAS })}
        ${campoNumero({ id: 'taxa_cambio', label: t('campo_taxa_cambio', lang), valor: f.taxa_cambio_secundaria || '', step: '0.0001', min: 0 })}
      </div>
      ${campoCheckbox({ id: 'ativo', label: 'Filial ativa', marcado: f.ativo })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-filial');
  const checkboxSecundaria = form.querySelector('#aceita_secundaria');
  const blocoSecundaria = form.querySelector('#bloco-moeda-secundaria');
  checkboxSecundaria.addEventListener('change', () => {
    blocoSecundaria.classList.toggle('oculto', !checkboxSecundaria.checked);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    erroEl.classList.add('oculto');

    const aceitaSecundaria = valorChecked(form, 'aceita_secundaria');
    const moedaPrincipal = form.querySelector('#moeda_principal').value;
    const moedaSecundaria = aceitaSecundaria ? form.querySelector('#moeda_secundaria').value : null;

    if (aceitaSecundaria && moedaSecundaria === moedaPrincipal) {
      erroEl.textContent = 'A moeda secundária deve ser diferente da moeda principal.';
      erroEl.classList.remove('oculto');
      return;
    }

    const dados = {
      nome: valorTexto(form, 'nome'),
      slug: valorTexto(form, 'slug'),
      pais: form.querySelector('#pais').value,
      endereco: valorTexto(form, 'endereco'),
      google_maps_url: valorTexto(form, 'maps'),
      telefone: valorTexto(form, 'telefone'),
      timezone: form.querySelector('#timezone').value,
      moeda_principal: moedaPrincipal,
      aceita_moeda_secundaria: aceitaSecundaria,
      moeda_secundaria: moedaSecundaria,
      taxa_cambio_secundaria: aceitaSecundaria ? valorNumero(form, 'taxa_cambio') : null,
      ativo: valorChecked(form, 'ativo'),
    };

    try {
      if (ehNovo) {
        unwrap(await supabase.from('filiais').insert({ ...dados, empresa_id: sessao.perfil.empresa_id }));
      } else {
        unwrap(await supabase.from('filiais').update(dados).eq('id', filial.id));
      }
      fecharModal(overlay);
      await renderFiliais();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

// =====================================================================
// EQUIPE (perfis)
// =====================================================================

async function renderEquipe() {
  const [equipe, filiais] = await Promise.all([
    supabase.from('perfis').select('*').order('nome').then(unwrap),
    supabase.from('filiais').select('id, nome').order('nome').then(unwrap),
  ]);

  const mapaFiliais = Object.fromEntries(filiais.map((f) => [f.id, f.nome]));
  const painel = painelAlvo();

  const linhas = equipe
    .map((p) => `
      <tr>
        <td>${esc(p.nome)}</td>
        <td>${CARGO_LABELS[p.cargo] || p.cargo}</td>
        <td>${p.filial_id ? esc(mapaFiliais[p.filial_id] || '—') : 'Todas'}</td>
        <td class="preco">${p.percentual_comissao_servico}%</td>
        <td class="preco">${p.percentual_comissao_produto}%</td>
        <td>${p.ativo ? `<span class="badge badge-sage">Ativo</span>` : `<span class="badge badge-neutro">Inativo</span>`}</td>
        <td class="coluna-acoes"><button class="botao botao-secundario btn-editar" data-id="${p.id}">${t('acao_editar', lang)}</button></td>
      </tr>
    `)
    .join('');

  painel.innerHTML = `
    ${botaoNovo('Convidar membro')}
    <p class="silencioso mt-1">Novos membros recebem um e-mail para definir a senha de acesso.</p>
    <div class="tabela-wrap mt-1">
      ${equipe.length === 0 ? `<div class="tabela-vazia">Nenhum membro cadastrado.</div>` : `
      <table>
        <thead><tr><th>${t('campo_nome', lang)}</th><th>${t('campo_cargo', lang)}</th><th>${t('campo_filial', lang)}</th><th>${t('campo_comissao_servico', lang)}</th><th>${t('campo_comissao_produto', lang)}</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`}
    </div>
  `;

  raiz.querySelector('#btn-novo').addEventListener('click', () => abrirFormConvite(filiais));
  painel.querySelectorAll('.btn-editar').forEach((btn) => {
    btn.addEventListener('click', () => {
      const perfil = equipe.find((p) => p.id === btn.dataset.id);
      abrirFormEquipe(perfil, filiais);
    });
  });
}

function opcoesFiliais(filiais) {
  return [{ valor: '', texto: 'Todas as filiais' }, ...filiais.map((f) => ({ valor: f.id, texto: f.nome }))];
}

function abrirFormEquipe(perfil, filiais) {
  const overlay = abrirModal(esc(perfil.nome), `
    <form id="form-equipe">
      ${campoTexto({ id: 'nome', label: t('campo_nome', lang), valor: perfil.nome, obrigatorio: true })}
      ${campoSelect({
        id: 'cargo', label: t('campo_cargo', lang), valor: perfil.cargo,
        opcoes: Object.entries(CARGO_LABELS).map(([valor, texto]) => ({ valor, texto })),
        obrigatorio: true,
      })}
      ${campoSelect({
        id: 'filial', label: t('campo_filial', lang), valor: perfil.filial_id || '',
        opcoes: opcoesFiliais(filiais),
        ajuda: 'Proprietário/gerente costuma ter acesso a "Todas as filiais".',
      })}
      ${campoNumero({ id: 'comissao_servico', label: t('campo_comissao_servico', lang), valor: perfil.percentual_comissao_servico, min: 0, step: '0.01' })}
      ${campoNumero({ id: 'comissao_produto', label: t('campo_comissao_produto', lang), valor: perfil.percentual_comissao_produto, min: 0, step: '0.01' })}
      ${campoCheckbox({ id: 'ativo', label: 'Membro ativo', marcado: perfil.ativo })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-equipe');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    const dados = {
      nome: valorTexto(form, 'nome'),
      cargo: form.querySelector('#cargo').value,
      filial_id: form.querySelector('#filial').value || null,
      percentual_comissao_servico: valorNumero(form, 'comissao_servico') ?? 0,
      percentual_comissao_produto: valorNumero(form, 'comissao_produto') ?? 0,
      ativo: valorChecked(form, 'ativo'),
    };
    try {
      unwrap(await supabase.from('perfis').update(dados).eq('id', perfil.id));
      fecharModal(overlay);
      await renderEquipe();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

/**
 * Convidar membro: cria o usuário de autenticação + o registro em `perfis`.
 * A anon/authenticated key NÃO tem permissão para criar usuários (isso exige
 * service role), então delegamos para a Edge Function `convidar-membro`
 * (ver /supabase/functions/convidar-membro). O front-end só monta a chamada.
 */
function abrirFormConvite(filiais) {
  const overlay = abrirModal('Convidar membro', `
    <form id="form-convite">
      ${campoTexto({ id: 'nome', label: t('campo_nome', lang), obrigatorio: true })}
      ${campoTexto({ id: 'email', label: t('campo_email', lang), tipo: 'email', obrigatorio: true })}
      ${campoSelect({
        id: 'cargo', label: t('campo_cargo', lang), valor: 'barbeiro',
        opcoes: Object.entries(CARGO_LABELS).map(([valor, texto]) => ({ valor, texto })),
        obrigatorio: true,
      })}
      ${campoSelect({ id: 'filial', label: t('campo_filial', lang), valor: filiais[0]?.id || '', opcoes: opcoesFiliais(filiais) })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">Enviar convite</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-convite');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    const botao = form.querySelector('button[type=submit]');
    erroEl.classList.add('oculto');
    botao.disabled = true;
    botao.textContent = 'Enviando…';

    try {
      const { error, data } = await supabase.functions.invoke('convidar-membro', {
        body: {
          nome: valorTexto(form, 'nome'),
          email: valorTexto(form, 'email'),
          cargo: form.querySelector('#cargo').value,
          filial_id: form.querySelector('#filial').value || null,
        },
      });

      // A função retorna { error } em erros de negócio — precisamos checar o body também
      const msgErro = error?.message || data?.error;
      if (msgErro) throw new Error(msgErro);

      fecharModal(overlay);
      mostrarToast('Convite enviado! O membro receberá um e-mail para definir a senha.');
      await renderEquipe();
    } catch (e) {
      let msg = e.message || 'Não foi possível enviar o convite.';
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('já está cadastrado')) {
        msg = 'Este e-mail já está cadastrado no sistema.';
      }
      erroEl.textContent = msg;
      erroEl.classList.remove('oculto');
      botao.disabled = false;
      botao.textContent = 'Enviar convite';
    }
  });
}

function mostrarToast(mensagem, tipo = 'sucesso') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:1.5rem; right:1.5rem; z-index:9999;
    background:${tipo === 'sucesso' ? '#2F4F3E' : '#A8503C'};
    color:#fff; padding:0.85rem 1.25rem; border-radius:8px;
    font-size:0.9rem; max-width:360px; box-shadow:0 4px 16px rgba(0,0,0,0.2);
    opacity:0; transform:translateY(12px); transition:all 0.25s ease;
  `;
  toast.textContent = mensagem;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// =====================================================================
// SERVIÇOS
// =====================================================================

async function renderServicos() {
  const servicos = unwrap(await supabase.from('servicos').select('*').order('nome'));
  const painel = painelAlvo();

  const linhas = servicos
    .map((s) => `
      <tr>
        <td>${esc(s.nome)}</td>
        <td class="preco">${s.duracao_minutos} min</td>
        <td class="preco">${formatPrecoFilial(s.preco, filialRef)}</td>
        <td>${s.ativo ? `<span class="badge badge-sage">Ativo</span>` : `<span class="badge badge-neutro">Inativo</span>`}</td>
        <td class="coluna-acoes">
          <button class="botao botao-secundario btn-editar" data-id="${s.id}">${t('acao_editar', lang)}</button>
          <button class="botao botao-perigo btn-excluir" data-id="${s.id}">${t('acao_excluir', lang)}</button>
        </td>
      </tr>
    `)
    .join('');

  painel.innerHTML = `
    ${botaoNovo(t('acao_novo', lang))}
    <div class="tabela-wrap mt-1">
      ${servicos.length === 0 ? `<div class="tabela-vazia">Nenhum serviço cadastrado.</div>` : `
      <table>
        <thead><tr><th>${t('campo_nome', lang)}</th><th>${t('campo_duracao', lang)}</th><th>${t('campo_preco', lang)}</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`}
    </div>
  `;

  raiz.querySelector('#btn-novo').addEventListener('click', () => abrirFormServico(null));
  painel.querySelectorAll('.btn-editar').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormServico(servicos.find((s) => s.id === btn.dataset.id)));
  });
  painel.querySelectorAll('.btn-excluir').forEach((btn) => {
    btn.addEventListener('click', () => excluirRegistro('servicos', btn.dataset.id, renderServicos));
  });
}

function abrirFormServico(servico) {
  const ehNovo = !servico;
  const s = servico || { nome: '', descricao: '', duracao_minutos: 30, preco: 0, ativo: true };

  const overlay = abrirModal(ehNovo ? `${t('tab_servicos', lang)} — ${t('acao_novo', lang)}` : esc(s.nome), `
    <form id="form-servico">
      ${campoTexto({ id: 'nome', label: t('campo_nome', lang), valor: s.nome, obrigatorio: true })}
      ${campoTextarea({ id: 'descricao', label: 'Descrição', valor: s.descricao || '' })}
      <div class="linha-formulario">
        ${campoNumero({ id: 'duracao', label: t('campo_duracao', lang), valor: s.duracao_minutos, min: 5, step: '5', obrigatorio: true })}
        ${campoNumero({ id: 'preco', label: t('campo_preco', lang), valor: s.preco, min: 0, obrigatorio: true, ajuda: filialRef ? `Moeda: ${filialRef.moeda_principal}` : '' })}
      </div>
      ${campoCheckbox({ id: 'ativo', label: 'Serviço ativo', marcado: s.ativo })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-servico');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    const dados = {
      nome: valorTexto(form, 'nome'),
      descricao: valorTexto(form, 'descricao'),
      duracao_minutos: valorNumero(form, 'duracao'),
      preco: valorNumero(form, 'preco'),
      ativo: valorChecked(form, 'ativo'),
    };
    try {
      if (ehNovo) {
        unwrap(await supabase.from('servicos').insert({ ...dados, empresa_id: sessao.perfil.empresa_id }));
      } else {
        unwrap(await supabase.from('servicos').update(dados).eq('id', servico.id));
      }
      fecharModal(overlay);
      await renderServicos();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

// =====================================================================
// PRODUTOS
// =====================================================================

async function renderProdutos() {
  const produtos = unwrap(await supabase.from('produtos').select('*').order('nome'));
  const painel = painelAlvo();

  const linhas = produtos
    .map((p) => `
      <tr>
        <td>${esc(p.nome)}</td>
        <td>${p.unidade}</td>
        <td class="preco">${formatPrecoFilial(p.preco_venda, filialRef)}</td>
        <td class="preco">${formatPrecoFilial(p.custo_unitario, filialRef)}</td>
        <td class="preco">${p.estoque_minimo}</td>
        <td>${p.ativo ? `<span class="badge badge-sage">Ativo</span>` : `<span class="badge badge-neutro">Inativo</span>`}</td>
        <td class="coluna-acoes">
          <button class="botao botao-secundario btn-editar" data-id="${p.id}">${t('acao_editar', lang)}</button>
          <button class="botao botao-perigo btn-excluir" data-id="${p.id}">${t('acao_excluir', lang)}</button>
        </td>
      </tr>
    `)
    .join('');

  painel.innerHTML = `
    ${botaoNovo(t('acao_novo', lang))}
    <div class="tabela-wrap mt-1">
      ${produtos.length === 0 ? `<div class="tabela-vazia">Nenhum produto cadastrado.</div>` : `
      <table>
        <thead><tr><th>${t('campo_nome', lang)}</th><th>${t('campo_unidade', lang)}</th><th>${t('campo_preco', lang)}</th><th>${t('campo_custo', lang)}</th><th>${t('campo_estoque_minimo', lang)}</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`}
    </div>
  `;

  raiz.querySelector('#btn-novo').addEventListener('click', () => abrirFormProduto(null));
  painel.querySelectorAll('.btn-editar').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormProduto(produtos.find((p) => p.id === btn.dataset.id)));
  });
  painel.querySelectorAll('.btn-excluir').forEach((btn) => {
    btn.addEventListener('click', () => excluirRegistro('produtos', btn.dataset.id, renderProdutos));
  });
}

function abrirFormProduto(produto) {
  const ehNovo = !produto;
  const p = produto || {
    nome: '',
    descricao: '',
    unidade: 'un',
    preco_venda: 0,
    custo_unitario: 0,
    estoque_minimo: 0,
    foto_url: '',
    ativo: true,
  };

  // Função para buscar estoque atual (apenas para edição)
  const buscarEstoqueAtual = async () => {
    if (ehNovo) return 0;
    const { data } = await supabase
      .from('estoque_filial')
      .select('quantidade_atual')
      .eq('produto_id', p.id)
      .eq('filial_id', filialRef.id)
      .maybeSingle();
    return data?.quantidade_atual ?? 0;
  };

  // Abre o modal com base no estoque atual (usaremos Promise)
  const overlay = abrirModal(ehNovo ? `${t('tab_produtos', lang)} — ${t('acao_novo', lang)}` : esc(p.nome), `
    <form id="form-produto" enctype="multipart/form-data">
      ${campoTexto({ id: 'nome', label: t('campo_nome', lang), valor: p.nome, obrigatorio: true })}
      ${campoTextarea({ id: 'descricao', label: 'Descrição', valor: p.descricao || '' })}

      <div class="linha-formulario">
        ${campoSelect({ id: 'unidade', label: t('campo_unidade', lang), valor: p.unidade, opcoes: UNIDADES, obrigatorio: true })}
        ${campoNumero({ id: 'estoque_minimo', label: t('campo_estoque_minimo', lang), valor: p.estoque_minimo, min: 0 })}
      </div>

      <div class="linha-formulario">
        ${campoNumero({ id: 'preco_venda', label: t('campo_preco', lang), valor: p.preco_venda, min: 0, obrigatorio: true, ajuda: filialRef ? `Moeda: ${filialRef.moeda_principal}` : '' })}
        ${campoNumero({ id: 'custo_unitario', label: t('campo_custo', lang), valor: p.custo_unitario, min: 0 })}
      </div>

      <!-- Campo de ESTOQUE (aparece para edição e também para novo, mas com comportamento diferente) -->
      <div class="campo">
        <label for="quantidade_estoque">${ehNovo ? t('estoque_quantidade_inicial', lang) : 'Quantidade em estoque (atual)'}</label>
        <input type="number" id="quantidade_estoque" value="${ehNovo ? 0 : '...'}" min="0" step="1" ${ehNovo ? 'required' : ''} />
        <span class="ajuda">${ehNovo ? 'Quantidade que entrará no estoque da filial atual.' : 'Ajuste a quantidade atual. Será criado um movimento de ajuste.'}</span>
      </div>

      <div class="campo">
        <label for="foto">${t('campo_foto', lang)}</label>
        <input type="file" id="foto" accept="image/*" />
        <div id="preview-foto" style="margin-top:0.5rem;">
          ${p.foto_url ? `<img src="${esc(p.foto_url)}" style="max-width:150px; max-height:150px; border-radius:8px; border:1px solid var(--line);" />` : ''}
        </div>
        <span class="ajuda">Formatos: JPG, PNG, WEBP. Máx. 5MB.</span>
      </div>

      ${campoCheckbox({ id: 'ativo', label: 'Produto ativo', marcado: p.ativo })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  // ---- Preencher estoque atual (se edição) ----
  (async () => {
    if (!ehNovo) {
      const qtd = await buscarEstoqueAtual();
      const inputEstoque = overlay.querySelector('#quantidade_estoque');
      if (inputEstoque) inputEstoque.value = qtd;
    }
  })();

  // ---- Preview da imagem ----
  const fileInput = overlay.querySelector('#foto');
  const previewDiv = overlay.querySelector('#preview-foto');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) {
      previewDiv.innerHTML = p.foto_url ? `<img src="${esc(p.foto_url)}" style="max-width:150px; max-height:150px; border-radius:8px; border:1px solid var(--line);" />` : '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      previewDiv.innerHTML = `<img src="${e.target.result}" style="max-width:150px; max-height:150px; border-radius:8px; border:1px solid var(--line);" />`;
    };
    reader.readAsDataURL(file);
  });

  // ---- Submit ----
  const form = overlay.querySelector('#form-produto');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    erroEl.classList.add('oculto');
    const botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    botao.textContent = 'Salvando…';

    try {
      const nome = valorTexto(form, 'nome');
      const descricao = valorTexto(form, 'descricao');
      const unidade = form.querySelector('#unidade').value;
      const estoque_minimo = valorNumero(form, 'estoque_minimo') ?? 0;
      const preco_venda = valorNumero(form, 'preco_venda');
      const custo_unitario = valorNumero(form, 'custo_unitario') ?? 0;
      const ativo = valorChecked(form, 'ativo');
      const novaQuantidade = Number(form.querySelector('#quantidade_estoque').value) || 0;

      let foto_url = p.foto_url || null;
      const file = fileInput.files[0];

      // Upload da imagem se houver
      if (file) {
        botao.textContent = 'Enviando imagem…';
        try {
          foto_url = await uploadImageToCloudinary(file);
        } catch (uploadErr) {
          erroEl.textContent = '❌ Falha no upload da imagem: ' + uploadErr.message;
          erroEl.classList.remove('oculto');
          botao.disabled = false;
          botao.textContent = t('acao_salvar', lang);
          return;
        }
      }

      const dadosProduto = {
        nome,
        descricao,
        unidade,
        estoque_minimo,
        preco_venda,
        custo_unitario,
        foto_url,
        ativo,
      };

      let produtoId;
      if (ehNovo) {
        // Inserir novo produto
        const inserido = unwrap(await supabase.from('produtos').insert({
          ...dadosProduto,
          empresa_id: sessao.perfil.empresa_id,
        }).select().single());
        produtoId = inserido.id;

        // Criar estoque inicial se quantidade > 0
        if (novaQuantidade > 0) {
          await supabase.from('estoque_filial').upsert({
            empresa_id: sessao.perfil.empresa_id,
            filial_id: filialRef.id,
            produto_id: produtoId,
            quantidade_atual: novaQuantidade,
          }, { onConflict: 'produto_id,filial_id' });

          await supabase.from('estoque_movimentos').insert({
            empresa_id: sessao.perfil.empresa_id,
            filial_id: filialRef.id,
            produto_id: produtoId,
            tipo: 'entrada_compra',
            quantidade: novaQuantidade,
            custo_unitario: custo_unitario || null,
            observacao: 'Estoque inicial cadastrado via produto',
            criado_por: sessao.perfil.id,
          });
        }
      } else {
        // Atualizar produto existente
        await supabase.from('produtos').update(dadosProduto).eq('id', p.id);
        produtoId = p.id;

        // Atualizar estoque se a quantidade mudou
        const qtdAtual = (await buscarEstoqueAtual()) ?? 0;
        if (novaQuantidade !== qtdAtual) {
          const diff = novaQuantidade - qtdAtual;
          // Atualizar estoque_filial
          await supabase.from('estoque_filial').upsert({
            empresa_id: sessao.perfil.empresa_id,
            filial_id: filialRef.id,
            produto_id: produtoId,
            quantidade_atual: novaQuantidade,
          }, { onConflict: 'produto_id,filial_id' });

          // Registrar movimento de ajuste
          const tipoMovimento = diff > 0 ? 'ajuste_positivo' : 'ajuste_negativo';
          await supabase.from('estoque_movimentos').insert({
            empresa_id: sessao.perfil.empresa_id,
            filial_id: filialRef.id,
            produto_id: produtoId,
            tipo: tipoMovimento,
            quantidade: Math.abs(diff),
            custo_unitario: null,
            observacao: `Ajuste manual de estoque via edição de produto (${diff > 0 ? '+' : ''}${diff})`,
            criado_por: sessao.perfil.id,
          });
        }
      }

      fecharModal(overlay);
      await renderProdutos();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
      botao.disabled = false;
      botao.textContent = t('acao_salvar', lang);
    }
  });
}

// =====================================================================
// FUNÇÃO DE UPLOAD PARA CLOUDINARY (adicione no início do arquivo ou aqui)
// =====================================================================

const CLOUDINARY_CLOUD_NAME = 'dsxwnbj0o';
const CLOUDINARY_UPLOAD_PRESET = 'ml_default';
const CLOUDINARY_ENDPOINT = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

async function uploadImageToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(CLOUDINARY_ENDPOINT, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errData = await response.json();
      errMsg = errData?.error?.message || errMsg;
    } catch (_) {}
    throw new Error(`Cloudinary upload falhou: ${errMsg}`);
  }

  const data = await response.json();
  if (!data.secure_url) {
    throw new Error('Cloudinary não retornou uma URL válida.');
  }
  return data.secure_url;
}

// =====================================================================
// COMBOS
// =====================================================================

async function renderCombos() {
  const [combos, servicos, produtos] = await Promise.all([
    supabase.from('combos').select('*, combo_itens(*, servicos(nome, preco), produtos(nome, preco_venda))').order('nome').then(unwrap),
    supabase.from('servicos').select('id, nome, preco').eq('ativo', true).order('nome').then(unwrap),
    supabase.from('produtos').select('id, nome, preco_venda').eq('ativo', true).order('nome').then(unwrap),
  ]);
  const painel = painelAlvo();

  const linhas = combos
    .map((c) => {
      const resumoItens = c.combo_itens
        .map((ci) => `${ci.quantidade}× ${esc(ci.servicos?.nome || ci.produtos?.nome || '—')}`)
        .join(' + ');
      const somaCatalogo = c.combo_itens.reduce((acc, ci) => {
        const preco = ci.servicos?.preco ?? ci.produtos?.preco_venda ?? 0;
        return acc + preco * ci.quantidade;
      }, 0);
      return `
        <tr>
          <td>
            <strong>${esc(c.nome)}</strong>
            <div class="silencioso">${resumoItens || '—'}</div>
          </td>
          <td class="preco">${formatPrecoFilial(c.preco_total, filialRef)}</td>
          <td class="preco silencioso">${formatPrecoFilial(somaCatalogo, filialRef)}</td>
          <td>${c.ativo ? `<span class="badge badge-sage">Ativo</span>` : `<span class="badge badge-neutro">Inativo</span>`}</td>
          <td class="coluna-acoes">
            <button class="botao botao-secundario btn-editar" data-id="${c.id}">${t('acao_editar', lang)}</button>
            <button class="botao botao-perigo btn-excluir" data-id="${c.id}">${t('acao_excluir', lang)}</button>
          </td>
        </tr>
      `;
    })
    .join('');

  painel.innerHTML = `
    ${botaoNovo(t('acao_novo', lang))}
    <div class="tabela-wrap mt-1">
      ${combos.length === 0 ? `<div class="tabela-vazia">Nenhum combo cadastrado.</div>` : `
      <table>
        <thead><tr><th>${t('campo_nome', lang)}</th><th>${t('campo_preco_total', lang)}</th><th>${t('combos_soma_catalogo', lang)}</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`}
    </div>
  `;

  raiz.querySelector('#btn-novo').addEventListener('click', () => abrirFormCombo(null, servicos, produtos));
  painel.querySelectorAll('.btn-editar').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormCombo(combos.find((c) => c.id === btn.dataset.id), servicos, produtos));
  });
  painel.querySelectorAll('.btn-excluir').forEach((btn) => {
    btn.addEventListener('click', () => excluirRegistro('combos', btn.dataset.id, renderCombos));
  });
}

function abrirFormCombo(combo, servicos, produtos) {
  const ehNovo = !combo;
  const c = combo || { nome: '', preco_total: 0, ativo: true, combo_itens: [] };

  const overlay = abrirModal(ehNovo ? `${t('tab_combos', lang)} — ${t('acao_novo', lang)}` : esc(c.nome), `
    <form id="form-combo">
      ${campoTexto({ id: 'nome', label: t('campo_nome', lang), valor: c.nome, obrigatorio: true })}
      ${campoNumero({ id: 'preco_total', label: t('campo_preco_total', lang), valor: c.preco_total, min: 0, obrigatorio: true, ajuda: filialRef ? `Moeda: ${filialRef.moeda_principal}` : '' })}

      <div class="campo">
        <label>${t('tab_combos', lang)} — Itens</label>
        <div id="lista-itens-combo"></div>
        <div class="silencioso mt-1">${t('combos_soma_catalogo', lang)}: <strong id="soma-catalogo-combo">—</strong></div>
        <button type="button" class="botao botao-secundario mt-1" id="btn-add-item-combo">${t('acao_adicionar_item', lang)}</button>
      </div>

      ${campoCheckbox({ id: 'ativo', label: 'Combo ativo', marcado: c.ativo })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-combo');
  const lista = overlay.querySelector('#lista-itens-combo');

  const itensIniciais = c.combo_itens.length > 0
    ? c.combo_itens.map((ci) => ({ tipo: ci.tipo_item, id: ci.servico_id || ci.produto_id, quantidade: ci.quantidade }))
    : [{ tipo: 'servico', id: servicos[0]?.id || '', quantidade: 1 }];

  itensIniciais.forEach((v) => adicionarLinhaItemCombo(lista, servicos, produtos, v));
  atualizarSomaCatalogoCombo(lista, servicos, produtos);

  overlay.querySelector('#btn-add-item-combo').addEventListener('click', () => {
    adicionarLinhaItemCombo(lista, servicos, produtos, { tipo: 'servico', id: servicos[0]?.id || '', quantidade: 1 });
    atualizarSomaCatalogoCombo(lista, servicos, produtos);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    erroEl.classList.add('oculto');

    const itens = lerItensCombo(lista);
    if (itens.length === 0) {
      erroEl.textContent = t('combos_sem_itens', lang);
      erroEl.classList.remove('oculto');
      return;
    }

    const dados = {
      nome: valorTexto(form, 'nome'),
      preco_total: valorNumero(form, 'preco_total'),
      ativo: valorChecked(form, 'ativo'),
    };

    try {
      let comboId = combo?.id;
      if (ehNovo) {
        const novo = unwrap(await supabase.from('combos').insert({ ...dados, empresa_id: sessao.perfil.empresa_id }).select().single());
        comboId = novo.id;
      } else {
        unwrap(await supabase.from('combos').update(dados).eq('id', comboId));
        unwrap(await supabase.from('combo_itens').delete().eq('combo_id', comboId));
      }

      unwrap(await supabase.from('combo_itens').insert(itens.map((it) => ({
        combo_id: comboId,
        tipo_item: it.tipo,
        servico_id: it.tipo === 'servico' ? it.id : null,
        produto_id: it.tipo === 'produto' ? it.id : null,
        quantidade: it.quantidade,
      }))));

      fecharModal(overlay);
      await renderCombos();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

function adicionarLinhaItemCombo(lista, servicos, produtos, valores) {
  const linha = document.createElement('div');
  linha.className = 'linha-formulario';
  linha.style.alignItems = 'end';
  linha.dataset.linhaItemCombo = '1';

  const opcoesItem = (tipo) => (tipo === 'servico' ? servicos : produtos)
    .map((it) => `<option value="${it.id}" ${it.id === valores.id ? 'selected' : ''}>${esc(it.nome)}</option>`)
    .join('');

  linha.innerHTML = `
    ${campoSelect({ id: '', label: '', valor: valores.tipo, opcoes: [
      { valor: 'servico', texto: t('item_tipo_servico', lang) },
      { valor: 'produto', texto: t('item_tipo_produto', lang) },
    ] }).replace('<label for=""></label>', '').replace('id=""', 'class="select-tipo-item"')}
    <div class="campo"><select class="select-item-item">${opcoesItem(valores.tipo)}</select></div>
    ${campoNumero({ id: '', label: '', valor: valores.quantidade, min: 0.01, step: '1' }).replace('<label for=""></label>', '').replace('id=""', 'class="input-qtd-item"')}
    <button type="button" class="botao botao-icone btn-remover-item" aria-label="Remover">✕</button>
  `;

  const selectTipo = linha.querySelector('.select-tipo-item');
  const selectItem = linha.querySelector('.select-item-item');

  selectTipo.addEventListener('change', () => {
    selectItem.innerHTML = opcoesItem(selectTipo.value);
    atualizarSomaCatalogoCombo(lista, servicos, produtos);
  });
  selectItem.addEventListener('change', () => atualizarSomaCatalogoCombo(lista, servicos, produtos));
  linha.querySelector('.input-qtd-item').addEventListener('input', () => atualizarSomaCatalogoCombo(lista, servicos, produtos));

  linha.querySelector('.btn-remover-item').addEventListener('click', () => {
    linha.remove();
    atualizarSomaCatalogoCombo(lista, servicos, produtos);
  });

  lista.appendChild(linha);
}

function lerItensCombo(lista) {
  const itens = [];
  lista.querySelectorAll('[data-linha-item-combo]').forEach((linha) => {
    const tipo = linha.querySelector('.select-tipo-item').value;
    const id = linha.querySelector('.select-item-item').value;
    const quantidade = Number(linha.querySelector('.input-qtd-item').value);
    if (id && quantidade > 0) itens.push({ tipo, id, quantidade });
  });
  return itens;
}

function atualizarSomaCatalogoCombo(lista, servicos, produtos) {
  const itens = lerItensCombo(lista);
  const soma = itens.reduce((acc, it) => {
    const catalogo = it.tipo === 'servico' ? servicos : produtos;
    const item = catalogo.find((x) => x.id === it.id);
    const preco = item ? (item.preco ?? item.preco_venda ?? 0) : 0;
    return acc + preco * it.quantidade;
  }, 0);
  const el = raiz.querySelector('#soma-catalogo-combo');
  if (el) el.textContent = formatPrecoFilial(soma, filialRef);
}

// =====================================================================
// PACOTES DE SERVIÇO
// =====================================================================

async function renderPacotes() {
  const [pacotes, servicos] = await Promise.all([
    supabase.from('pacotes_servico').select('*, servicos(nome, preco)').order('nome').then(unwrap),
    supabase.from('servicos').select('id, nome, preco').eq('ativo', true).order('nome').then(unwrap),
  ]);
  const painel = painelAlvo();

  const linhas = pacotes
    .map((p) => {
      const precoUnit = p.preco_total / p.quantidade_sessoes;
      return `
        <tr>
          <td>
            <strong>${esc(p.nome)}</strong>
            <div class="silencioso">${p.quantidade_sessoes}× ${esc(p.servicos?.nome || '—')} (${formatPrecoFilial(precoUnit, filialRef)}/un)</div>
          </td>
          <td class="preco">${formatPrecoFilial(p.preco_total, filialRef)}</td>
          <td>${p.validade_dias ? `${p.validade_dias} ${t('pacotes_validade_dias', lang)}` : t('pacotes_sem_validade', lang)}</td>
          <td>${p.ativo ? `<span class="badge badge-sage">Ativo</span>` : `<span class="badge badge-neutro">Inativo</span>`}</td>
          <td class="coluna-acoes">
            <button class="botao botao-secundario btn-editar" data-id="${p.id}">${t('acao_editar', lang)}</button>
            <button class="botao botao-perigo btn-excluir" data-id="${p.id}">${t('acao_excluir', lang)}</button>
          </td>
        </tr>
      `;
    })
    .join('');

  painel.innerHTML = `
    ${botaoNovo(t('acao_novo', lang))}
    <div class="tabela-wrap mt-1">
      ${pacotes.length === 0 ? `<div class="tabela-vazia">Nenhum pacote cadastrado.</div>` : `
      <table>
        <thead><tr><th>${t('campo_nome', lang)}</th><th>${t('campo_preco_total', lang)}</th><th>${t('campo_validade_dias', lang)}</th><th>Status</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`}
    </div>
  `;

  if (servicos.length === 0) {
    raiz.querySelector('#btn-novo').disabled = true;
    raiz.querySelector('#btn-novo').title = 'Cadastre um serviço primeiro.';
  }

  raiz.querySelector('#btn-novo').addEventListener('click', () => abrirFormPacote(null, servicos));
  painel.querySelectorAll('.btn-editar').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormPacote(pacotes.find((p) => p.id === btn.dataset.id), servicos));
  });
  painel.querySelectorAll('.btn-excluir').forEach((btn) => {
    btn.addEventListener('click', () => excluirRegistro('pacotes_servico', btn.dataset.id, renderPacotes));
  });
}

function abrirFormPacote(pacote, servicos) {
  const ehNovo = !pacote;
  const p = pacote || { nome: '', servico_id: servicos[0]?.id || '', quantidade_sessoes: 10, preco_total: 0, validade_dias: 180, ativo: true };

  const overlay = abrirModal(ehNovo ? `${t('tab_pacotes', lang)} — ${t('acao_novo', lang)}` : esc(p.nome), `
    <form id="form-pacote">
      ${campoTexto({ id: 'nome', label: t('campo_nome', lang), valor: p.nome, obrigatorio: true })}
      ${campoSelect({ id: 'servico', label: t('campo_servico_vinculado', lang), valor: p.servico_id, opcoes: servicos.map((s) => ({ valor: s.id, texto: `${s.nome} (${formatPrecoFilial(s.preco, filialRef)})` })), obrigatorio: true })}
      <div class="linha-formulario">
        ${campoNumero({ id: 'quantidade_sessoes', label: t('campo_quantidade_sessoes', lang), valor: p.quantidade_sessoes, min: 1, step: '1', obrigatorio: true })}
        ${campoNumero({ id: 'preco_total', label: t('campo_preco_total', lang), valor: p.preco_total, min: 0, obrigatorio: true, ajuda: filialRef ? `Moeda: ${filialRef.moeda_principal}` : '' })}
      </div>
      ${campoCheckbox({ id: 'tem_validade', label: 'Tem prazo de validade', marcado: p.validade_dias !== null })}
      <div id="bloco-validade" class="${p.validade_dias !== null ? '' : 'oculto'}">
        ${campoNumero({ id: 'validade_dias', label: t('campo_validade_dias', lang), valor: p.validade_dias ?? 180, min: 1, step: '1' })}
      </div>
      ${campoCheckbox({ id: 'ativo', label: 'Pacote ativo', marcado: p.ativo })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-pacote');
  const checkboxValidade = form.querySelector('#tem_validade');
  const blocoValidade = form.querySelector('#bloco-validade');
  checkboxValidade.addEventListener('change', () => blocoValidade.classList.toggle('oculto', !checkboxValidade.checked));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    const dados = {
      nome: valorTexto(form, 'nome'),
      servico_id: form.querySelector('#servico').value,
      quantidade_sessoes: valorNumero(form, 'quantidade_sessoes'),
      preco_total: valorNumero(form, 'preco_total'),
      validade_dias: valorChecked(form, 'tem_validade') ? valorNumero(form, 'validade_dias') : null,
      ativo: valorChecked(form, 'ativo'),
    };
    try {
      if (ehNovo) {
        unwrap(await supabase.from('pacotes_servico').insert({ ...dados, empresa_id: sessao.perfil.empresa_id }));
      } else {
        unwrap(await supabase.from('pacotes_servico').update(dados).eq('id', pacote.id));
      }
      fecharModal(overlay);
      await renderPacotes();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}



const HORARIO_PADRAO = { abre: '08:00', fecha: '18:00' };

async function renderHorarios() {
  const filiais = unwrap(await supabase.from('filiais').select('id, nome').order('nome'));
  const painel = painelAlvo();

  if (filiais.length === 0) {
    painel.innerHTML = `<div class="tabela-vazia">Cadastre uma filial primeiro.</div>`;
    return;
  }

  if (!filialHorariosId || !filiais.some((f) => f.id === filialHorariosId)) {
    filialHorariosId = filiais[0].id;
  }

  const horarios = unwrap(
    await supabase.from('horarios_funcionamento').select('*').eq('filial_id', filialHorariosId)
  );
  const mapaHorarios = Object.fromEntries(horarios.map((h) => [h.dia_semana, h]));
  const nomesDias = diasSemana(lang);

  const seletorFilial = filiais.length > 1
    ? `<div class="campo mt-1" style="max-width:280px">
         ${campoSelect({ id: 'select-filial-horarios', label: t('campo_filial', lang), valor: filialHorariosId, opcoes: filiais.map((f) => ({ valor: f.id, texto: f.nome })) })}
       </div>`
    : '';

  const linhas = nomesDias.map((nomeDia, diaSemana) => {
    const h = mapaHorarios[diaSemana];
    const aberto = !!h?.ativo;
    const abre = h?.abre?.slice(0, 5) || HORARIO_PADRAO.abre;
    const fecha = h?.fecha?.slice(0, 5) || HORARIO_PADRAO.fecha;
    return `
      <tr data-dia="${diaSemana}">
        <td>${esc(nomeDia)}</td>
        <td><input type="checkbox" class="check-aberto" ${aberto ? 'checked' : ''} /></td>
        <td><input type="time" class="input-abre" value="${abre}" ${aberto ? '' : 'disabled'} /></td>
        <td><input type="time" class="input-fecha" value="${fecha}" ${aberto ? '' : 'disabled'} /></td>
      </tr>
    `;
  }).join('');

  painel.innerHTML = `
    <h2>${t('horarios_titulo', lang)}</h2>
    <p class="silencioso mt-1">${t('horarios_ajuda', lang)}</p>
    ${seletorFilial}
    <div class="tabela-wrap mt-1">
      <table>
        <thead>
          <tr>
            <th>${t('horarios_dia', lang)}</th>
            <th>${t('horarios_aberto', lang)}</th>
            <th>${t('horarios_abre', lang)}</th>
            <th>${t('horarios_fecha', lang)}</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <div id="mensagem-horarios" class="oculto mt-1"></div>
    <div class="acoes-formulario mt-1">
      <button class="botao botao-primario" id="btn-salvar-horarios">${t('acao_salvar', lang)}</button>
    </div>
  `;

  const selectFilial = raiz.querySelector('#select-filial-horarios');
  if (selectFilial) {
    selectFilial.addEventListener('change', () => {
      filialHorariosId = selectFilial.value;
      renderHorarios();
    });
  }

  painel.querySelectorAll('tr[data-dia]').forEach((tr) => {
    const checkbox = tr.querySelector('.check-aberto');
    const inputAbre = tr.querySelector('.input-abre');
    const inputFecha = tr.querySelector('.input-fecha');
    checkbox.addEventListener('change', () => {
      inputAbre.disabled = !checkbox.checked;
      inputFecha.disabled = !checkbox.checked;
    });
  });

  raiz.querySelector('#btn-salvar-horarios').addEventListener('click', salvarHorarios);
}

async function salvarHorarios() {
  const painel = painelAlvo();
  const mensagemEl = raiz.querySelector('#mensagem-horarios');
  const botao = raiz.querySelector('#btn-salvar-horarios');
  botao.disabled = true;
  mensagemEl.classList.add('oculto');

  const registros = [];
  painel.querySelectorAll('tr[data-dia]').forEach((tr) => {
    const diaSemana = Number(tr.dataset.dia);
    const aberto = tr.querySelector('.check-aberto').checked;
    const abre = tr.querySelector('.input-abre').value || HORARIO_PADRAO.abre;
    const fecha = ajustarFecha(abre, tr.querySelector('.input-fecha').value || HORARIO_PADRAO.fecha);
    registros.push({
      empresa_id: sessao.perfil.empresa_id,
      filial_id: filialHorariosId,
      dia_semana: diaSemana,
      abre,
      fecha,
      ativo: aberto,
    });
  });

  try {
    unwrap(await supabase.from('horarios_funcionamento').upsert(registros, { onConflict: 'filial_id,dia_semana' }));
    mensagemEl.textContent = t('horarios_salvar_sucesso', lang);
    mensagemEl.className = 'badge badge-sage mt-1';
    mensagemEl.classList.remove('oculto');
  } catch (e) {
    mensagemEl.textContent = e.message;
    mensagemEl.className = 'mensagem-erro mt-1';
    mensagemEl.classList.remove('oculto');
  } finally {
    botao.disabled = false;
  }
}

/**
 * Garante `fecha > abre` (restrição do banco). Se o usuário digitar um
 * horário de fechamento igual/anterior à abertura, empurra 30min — exceto
 * se a abertura já estiver perto da meia-noite, caso em que usa 23:59.
 * (Funcionamento que cruza a meia-noite não é suportado nesta versão.)
 */
function ajustarFecha(abre, fecha) {
  if (fecha > abre) return fecha;
  const [h, m] = abre.split(':').map(Number);
  if (h * 60 + m >= 23 * 60 + 30) return '23:59';
  const total = h * 60 + m + 30;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// =====================================================================
// HELPERS
// =====================================================================

/**
 * Exclui um registro. Se houver vínculos (ex: já usado em vendas/agendamentos),
 * o banco rejeita por restrição de chave estrangeira — orientamos a desativar
 * em vez de excluir.
 */
async function excluirRegistro(tabela, id, aoConcluir) {
  if (!confirm(t('confirmacao_excluir', lang))) return;
  try {
    unwrap(await supabase.from(tabela).delete().eq('id', id));
    await aoConcluir();
  } catch (e) {
    mostrarErro('Não foi possível excluir: este item já está em uso em agendamentos ou vendas. Desative-o em vez de excluir.');
  }
}
