// =====================================================================
// financial.js — módulo "Financeiro" do roteador admin.js (Fase 4).
// Três abas: Fluxo de caixa (lançamentos do PDV + despesas manuais),
// DRE (consome vw_dre_mensal), e Fiado (saldo em aberto por cliente +
// registrar pagamento). Escrita de despesa manual é restrita a
// proprietario/gerente pela RLS (lancamentos_despesa_gestores no schema)
// — a UI também esconde o botão para quem não pode, mas o banco é a
// barreira real.
// =====================================================================

import { abrirModal, fecharModal } from './modal.js';
import { esc, mostrarErro } from './util.js';
import { campoTexto, campoNumero, valorTexto, valorNumero } from './form.js';
import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatPrecoFilial, formatDateTime } from './formatters.js';

const TIPO_LABEL_KEY = {
  receita_servico: 'fin_tipo_receita_servico',
  receita_produto: 'fin_tipo_receita_produto',
  receita_pacote: 'fin_tipo_receita_pacote',
  custo_produto: 'fin_tipo_custo_produto',
  comissao: 'fin_tipo_comissao',
  despesa: 'fin_tipo_despesa',
};

const TIPO_SINAL = {
  receita_servico: 1, receita_produto: 1, receita_pacote: 1,
  custo_produto: -1, comissao: -1, despesa: -1,
};

let sessao, lang, filial, raiz, podeGerenciar;
let abaAtual = 'fluxo';
let periodoFluxo = 'mes'; // 'hoje' | 'semana' | 'mes'

export async function init(root, sessaoAtual, ctx) {
  raiz = root;
  sessao = sessaoAtual;
  filial = ctx.filialAtiva();
  lang = ctx.lang;
  podeGerenciar = ctx.podeGerenciar();

  if (!filial) {
    raiz.innerHTML = `<div class="cabecalho-pagina"><h1>${t('fin_titulo', lang)}</h1></div><div class="cartao">Nenhuma filial cadastrada ainda.</div>`;
    return;
  }

  raiz.innerHTML = `
    <div class="cabecalho-pagina"><h1>${t('fin_titulo', lang)}</h1></div>
    <div class="tabs" id="tabs-financeiro">
      <button data-tab="fluxo" class="ativo">${t('fin_tab_fluxo', lang)}</button>
      <button data-tab="dre">${t('fin_tab_dre', lang)}</button>
      <button data-tab="fiado">${t('fin_tab_fiado', lang)}</button>
    </div>
    <div id="financeiro-conteudo"></div>
  `;

  raiz.querySelectorAll('#tabs-financeiro button').forEach((btn) => {
    btn.addEventListener('click', () => {
      raiz.querySelectorAll('#tabs-financeiro button').forEach((b) => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      abaAtual = btn.dataset.tab;
      renderAba();
    });
  });

  renderAba();
}

function renderAba() {
  if (abaAtual === 'fluxo') return renderFluxo();
  if (abaAtual === 'dre') return renderDre();
  if (abaAtual === 'fiado') return renderFiado();
}

function painel() {
  return raiz.querySelector('#financeiro-conteudo');
}

// =====================================================================
// FLUXO DE CAIXA
// =====================================================================

function intervaloPeriodo(periodo) {
  const fim = new Date();
  fim.setHours(23, 59, 59, 999);
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  if (periodo === 'semana') inicio.setDate(inicio.getDate() - 6);
  if (periodo === 'mes') inicio.setDate(1);
  return { inicio, fim };
}

async function renderFluxo() {
  const p = painel();
  p.innerHTML = `<div class="tabela-vazia">Carregando…</div>`;

  const { inicio, fim } = intervaloPeriodo(periodoFluxo);

  const lancamentos = unwrap(
    await supabase
      .from('lancamentos_financeiros')
      .select('id, tipo, descricao, valor, moeda, data_lancamento, created_at, perfis(nome)')
      .eq('filial_id', filial.id)
      .gte('data_lancamento', inicio.toISOString().slice(0, 10))
      .lte('data_lancamento', fim.toISOString().slice(0, 10))
      .order('created_at', { ascending: false })
  );

  const totalEntradas = lancamentos.filter((l) => TIPO_SINAL[l.tipo] > 0).reduce((acc, l) => acc + Number(l.valor), 0);
  const totalSaidas = lancamentos.filter((l) => TIPO_SINAL[l.tipo] < 0).reduce((acc, l) => acc + Number(l.valor), 0);
  const saldo = totalEntradas - totalSaidas;

  const linhas = lancamentos.map((l) => {
    const sinal = TIPO_SINAL[l.tipo] > 0 ? '+' : '−';
    const cor = TIPO_SINAL[l.tipo] > 0 ? '#2F4F3E' : '#A8503C';
    return `
      <tr>
        <td>${formatDateTime(l.created_at, filial)}</td>
        <td>${t(TIPO_LABEL_KEY[l.tipo] || l.tipo, lang)}</td>
        <td>${esc(l.descricao || l.perfis?.nome || '—')}</td>
        <td class="preco" style="color:${cor}">${sinal}${formatPrecoFilial(l.valor, filial)}</td>
      </tr>
    `;
  }).join('');

  p.innerHTML = `
    <div class="flex-entre mt-1">
      <div class="tabs-inline" id="tabs-periodo">
        <button data-periodo="hoje" class="${periodoFluxo === 'hoje' ? 'ativo' : ''}">${t('fin_periodo_hoje', lang)}</button>
        <button data-periodo="semana" class="${periodoFluxo === 'semana' ? 'ativo' : ''}">${t('fin_periodo_semana', lang)}</button>
        <button data-periodo="mes" class="${periodoFluxo === 'mes' ? 'ativo' : ''}">${t('fin_periodo_mes', lang)}</button>
      </div>
      ${podeGerenciar ? `<button class="botao botao-acento" id="btn-nova-despesa">${t('fin_nova_despesa', lang)}</button>` : ''}
    </div>

    <div class="grade-cartoes mt-1">
      <div class="cartao cartao-metrica">
        <p class="rotulo">Entradas</p>
        <p class="valor" style="color:#2F4F3E">${formatPrecoFilial(totalEntradas, filial)}</p>
      </div>
      <div class="cartao cartao-metrica">
        <p class="rotulo">Saídas</p>
        <p class="valor" style="color:#A8503C">${formatPrecoFilial(totalSaidas, filial)}</p>
      </div>
      <div class="cartao cartao-metrica">
        <p class="rotulo">Saldo</p>
        <p class="valor">${formatPrecoFilial(saldo, filial)}</p>
      </div>
    </div>

    <div class="tabela-wrap mt-1">
      ${lancamentos.length === 0 ? `<div class="tabela-vazia">${t('fin_sem_lancamentos', lang)}</div>` : `
      <table>
        <thead><tr><th>${t('fin_data', lang)}</th><th>Tipo</th><th>${t('fin_descricao_lancamento', lang)}</th><th>${t('fin_valor', lang)}</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>`}
    </div>
  `;

  p.querySelectorAll('#tabs-periodo button').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodoFluxo = btn.dataset.periodo;
      renderFluxo();
    });
  });

  const btnNovaDespesa = p.querySelector('#btn-nova-despesa');
  if (btnNovaDespesa) btnNovaDespesa.addEventListener('click', abrirFormDespesa);
}

function abrirFormDespesa() {
  const overlay = abrirModal(t('fin_nova_despesa', lang), `
    <form id="form-despesa">
      ${campoTexto({ id: 'descricao', label: t('fin_descricao_lancamento', lang), obrigatorio: true })}
      ${campoNumero({ id: 'valor', label: t('fin_valor', lang), valor: 0, min: 0.01, obrigatorio: true, ajuda: `Moeda: ${filial.moeda_principal}` })}
      ${campoTexto({ id: 'data', label: t('fin_data', lang), tipo: 'date', valor: new Date().toISOString().slice(0, 10), obrigatorio: true })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-despesa');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    try {
      unwrap(await supabase.from('lancamentos_financeiros').insert({
        empresa_id: sessao.perfil.empresa_id,
        filial_id: filial.id,
        tipo: 'despesa',
        descricao: valorTexto(form, 'descricao'),
        valor: valorNumero(form, 'valor'),
        moeda: filial.moeda_principal,
        data_lancamento: form.querySelector('#data').value,
      }));
      fecharModal(overlay);
      await renderFluxo();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

// =====================================================================
// DRE
// =====================================================================

async function renderDre() {
  const p = painel();
  p.innerHTML = `<div class="tabela-vazia">Carregando…</div>`;

  const meses = unwrap(
    await supabase
      .from('vw_dre_mensal')
      .select('mes, receita_servicos, receita_produtos, receita_pacotes, custo_produtos_vendidos, comissoes_pagas, despesas_operacionais, lucro_liquido')
      .eq('filial_id', filial.id)
      .order('mes', { ascending: false })
      .limit(12)
  );

  if (meses.length === 0) {
    p.innerHTML = `<div class="tabela-vazia">${t('fin_sem_lancamentos', lang)}</div>`;
    return;
  }

  const linhas = meses.map((m) => `
    <tr>
      <td>${formatMesAno(m.mes)}</td>
      <td class="preco">${formatPrecoFilial(m.receita_servicos, filial)}</td>
      <td class="preco">${formatPrecoFilial(m.receita_produtos, filial)}</td>
      <td class="preco">${formatPrecoFilial(m.receita_pacotes, filial)}</td>
      <td class="preco" style="color:#A8503C">${formatPrecoFilial(m.custo_produtos_vendidos, filial)}</td>
      <td class="preco" style="color:#A8503C">${formatPrecoFilial(m.comissoes_pagas, filial)}</td>
      <td class="preco" style="color:#A8503C">${formatPrecoFilial(m.despesas_operacionais, filial)}</td>
      <td class="preco" style="font-weight:700; color:${Number(m.lucro_liquido) >= 0 ? '#2F4F3E' : '#A8503C'}">${formatPrecoFilial(m.lucro_liquido, filial)}</td>
    </tr>
  `).join('');

  p.innerHTML = `
    <div class="tabela-wrap mt-1">
      <table>
        <thead>
          <tr>
            <th>${t('fin_mes', lang)}</th>
            <th>${t('fin_receita_servicos', lang)}</th>
            <th>${t('fin_receita_produtos', lang)}</th>
            <th>${t('fin_receita_pacotes', lang)}</th>
            <th>${t('fin_custo_produtos', lang)}</th>
            <th>${t('fin_comissoes', lang)}</th>
            <th>${t('fin_despesas', lang)}</th>
            <th>${t('fin_lucro_liquido', lang)}</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}

function formatMesAno(mesISO) {
  const [ano, mes] = mesISO.split('-');
  const d = new Date(Number(ano), Number(mes) - 1, 1);
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-PY' : 'pt-BR', { month: 'short', year: 'numeric' }).format(d);
}

// =====================================================================
// FIADO
// =====================================================================

async function renderFiado() {
  const p = painel();
  p.innerHTML = `<div class="tabela-vazia">Carregando…</div>`;

  const clientes = unwrap(
    await supabase
      .from('clientes')
      .select('id, nome, telefone, saldo_fiado')
      .eq('empresa_id', sessao.perfil.empresa_id)
      .gt('saldo_fiado', 0)
      .order('saldo_fiado', { ascending: false })
  );

  if (clientes.length === 0) {
    p.innerHTML = `<h2>${t('fin_clientes_devendo', lang)}</h2><div class="tabela-vazia mt-1">${t('fin_sem_fiado', lang)}</div>`;
    return;
  }

  const linhas = clientes.map((c) => `
    <tr>
      <td>${esc(c.nome)}</td>
      <td class="silencioso">${esc(c.telefone || '—')}</td>
      <td class="preco" style="font-weight:700">${formatPrecoFilial(c.saldo_fiado, filial)}</td>
      <td class="coluna-acoes"><button class="botao botao-acento btn-pagar" data-id="${c.id}">${t('fin_registrar_pagamento', lang)}</button></td>
    </tr>
  `).join('');

  p.innerHTML = `
    <h2>${t('fin_clientes_devendo', lang)}</h2>
    <div class="tabela-wrap mt-1">
      <table>
        <thead><tr><th>${t('campo_nome', lang)}</th><th>Telefone</th><th>${t('fin_saldo_devedor', lang)}</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;

  p.querySelectorAll('.btn-pagar').forEach((btn) => {
    btn.addEventListener('click', () => abrirFormPagamento(clientes.find((c) => c.id === btn.dataset.id)));
  });
}

function abrirFormPagamento(cliente) {
  const overlay = abrirModal(esc(cliente.nome), `
    <p>${t('fin_saldo_devedor', lang)}: <strong>${formatPrecoFilial(cliente.saldo_fiado, filial)}</strong></p>
    <form id="form-pagamento">
      ${campoNumero({ id: 'valor', label: t('fin_valor_pagamento', lang), valor: cliente.saldo_fiado, min: 0.01, obrigatorio: true })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('fin_registrar_pagamento', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-pagamento');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    const valor = valorNumero(form, 'valor');

    if (valor > Number(cliente.saldo_fiado)) {
      erroEl.textContent = t('fin_pagamento_excede', lang);
      erroEl.classList.remove('oculto');
      return;
    }

    try {
      unwrap(await supabase.from('fiado_movimentos').insert({
        empresa_id: sessao.perfil.empresa_id,
        cliente_id: cliente.id,
        tipo: 'pagamento',
        valor,
        criado_por: sessao.perfil.id,
      }));
      fecharModal(overlay);
      await renderFiado();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}
