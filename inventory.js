// =====================================================================
// inventory.js — módulo "Estoque" do roteador admin.js.
// Fase 3.2: saldo de estoque por filial, registro manual de movimentos
// (entrada/ajuste/devolução) e histórico por produto. Saídas por venda e
// consumo em serviço são geradas automaticamente pelos triggers do PDV
// (Seção 10 do schema) — não aparecem como opção manual aqui.
// =====================================================================

import { abrirModal, fecharModal } from './modal.js';
import { esc } from './util.js';
import { campoSelect, campoNumero, campoTextarea, campoCheckbox, valorNumero, valorTexto, valorChecked } from './form.js';
import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatPrecoFilial, formatDateTime } from './formatters.js';
import { TIPO_MOVIMENTO_ESTOQUE_MANUAL, TIPO_MOVIMENTO_ESTOQUE_LABELS } from './constants.js';

let sessao, lang, filial, podeEditarCusto, raiz;

export async function init(root, sessaoAtual, ctx) {
  raiz = root;
  sessao = sessaoAtual;
  filial = ctx.filialAtiva();
  lang = ctx.lang;
  podeEditarCusto = ctx.podeGerenciar();

  if (!filial) {
    raiz.innerHTML = `<div class="cabecalho-pagina"><h1>${t('estoque_titulo', lang)}</h1></div><div class="cartao">Nenhuma filial cadastrada ainda.</div>`;
    return;
  }

  raiz.innerHTML = `
    <div class="cabecalho-pagina">
      <div>
        <h1>${t('estoque_titulo', lang)}</h1>
        <p>${esc(filial.nome)}</p>
      </div>
    </div>
    <div class="tabela-wrap" id="tabela-estoque"><div class="tabela-vazia">Carregando…</div></div>
  `;

  await renderTabela();
}

async function renderTabela() {
  const [produtos, saldos] = await Promise.all([
    supabase.from('produtos').select('id, nome, unidade, preco_venda, custo_unitario, estoque_minimo, ativo').eq('ativo', true).order('nome').then(unwrap),
    supabase.from('estoque_filial').select('produto_id, quantidade_atual').eq('filial_id', filial.id).then(unwrap),
  ]);

  const mapaSaldos = Object.fromEntries(saldos.map((s) => [s.produto_id, s.quantidade_atual]));
  const container = raiz.querySelector('#tabela-estoque');

  if (produtos.length === 0) {
    container.innerHTML = `<div class="tabela-vazia">Nenhum produto cadastrado. Cadastre em Configurações → Produtos.</div>`;
    return;
  }

  const linhas = produtos
    .map((p) => {
      const saldo = mapaSaldos[p.id] ?? 0;
      const baixo = saldo <= p.estoque_minimo;
      return `
        <tr>
          <td>${esc(p.nome)}</td>
          <td class="preco">${saldo} ${esc(p.unidade)} ${baixo ? `<span class="badge badge-clay">${t('estoque_baixo_badge', lang)}</span>` : ''}</td>
          <td class="preco silencioso">${p.estoque_minimo} ${esc(p.unidade)}</td>
          <td class="preco">${formatPrecoFilial(p.custo_unitario, filial)}</td>
          <td class="preco">${formatPrecoFilial(p.preco_venda, filial)}</td>
          <td class="coluna-acoes">
            <button class="botao botao-acento btn-movimentar" data-id="${p.id}">${t('estoque_registrar_movimento', lang)}</button>
            <button class="botao botao-secundario btn-historico" data-id="${p.id}">${t('estoque_historico', lang)}</button>
          </td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>${t('campo_nome', lang)}</th>
          <th>${t('estoque_saldo_atual', lang)}</th>
          <th>${t('estoque_minimo', lang)}</th>
          <th>${t('campo_custo', lang)}</th>
          <th>${t('campo_preco', lang)}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
  `;

  container.querySelectorAll('.btn-movimentar').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalMovimento(produtos.find((p) => p.id === btn.dataset.id)));
  });
  container.querySelectorAll('.btn-historico').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalHistorico(produtos.find((p) => p.id === btn.dataset.id)));
  });
}

// =====================================================================
// REGISTRAR MOVIMENTO
// =====================================================================

function abrirModalMovimento(produto) {
  const opcoesTipo = TIPO_MOVIMENTO_ESTOQUE_MANUAL.map((valor) => ({ valor, texto: TIPO_MOVIMENTO_ESTOQUE_LABELS[valor] }));

  const overlay = abrirModal(esc(produto.nome), `
    <form id="form-movimento">
      ${campoSelect({ id: 'tipo', label: t('estoque_tipo_movimento', lang), valor: 'entrada_compra', opcoes: opcoesTipo, obrigatorio: true })}
      ${campoNumero({ id: 'quantidade', label: `${t('estoque_quantidade_movimento', lang)} (${esc(produto.unidade)})`, valor: 1, min: 0.001, step: '0.001', obrigatorio: true })}
      <div id="bloco-custo">
        ${campoNumero({ id: 'custo_unitario', label: t('campo_custo', lang), valor: produto.custo_unitario, min: 0, ajuda: filial ? `Moeda: ${filial.moeda_principal}` : '' })}
        ${podeEditarCusto ? campoCheckbox({ id: 'atualizar_custo', label: t('estoque_atualizar_custo', lang), marcado: false }) : ''}
      </div>
      ${campoTextarea({ id: 'observacao', label: t('estoque_observacao', lang) })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-movimento');
  const selectTipo = form.querySelector('#tipo');
  const blocoCusto = form.querySelector('#bloco-custo');

  const alternarBlocoCusto = () => {
    blocoCusto.classList.toggle('oculto', selectTipo.value !== 'entrada_compra');
  };
  selectTipo.addEventListener('change', alternarBlocoCusto);
  alternarBlocoCusto();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    erroEl.classList.add('oculto');

    const tipo = selectTipo.value;
    const quantidade = valorNumero(form, 'quantidade');
    const custoUnitario = tipo === 'entrada_compra' ? valorNumero(form, 'custo_unitario') : null;
    const atualizarCusto = tipo === 'entrada_compra' && podeEditarCusto && valorChecked(form, 'atualizar_custo');

    try {
      unwrap(await supabase.from('estoque_movimentos').insert({
        empresa_id: sessao.perfil.empresa_id,
        filial_id: filial.id,
        produto_id: produto.id,
        tipo,
        quantidade,
        custo_unitario: custoUnitario,
        observacao: valorTexto(form, 'observacao'),
        criado_por: sessao.perfil.id,
      }));

      if (atualizarCusto && custoUnitario !== null) {
        unwrap(await supabase.from('produtos').update({ custo_unitario: custoUnitario }).eq('id', produto.id));
      }

      fecharModal(overlay);
      await renderTabela();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

// =====================================================================
// HISTÓRICO
// =====================================================================

async function abrirModalHistorico(produto) {
  const overlay = abrirModal(`${t('estoque_historico', lang)} — ${esc(produto.nome)}`, `<div class="tabela-vazia">Carregando…</div>`);

  const movimentos = unwrap(
    await supabase
      .from('estoque_movimentos')
      .select('tipo, quantidade, observacao, created_at, perfis(nome)')
      .eq('produto_id', produto.id)
      .eq('filial_id', filial.id)
      .order('created_at', { ascending: false })
      .limit(50)
  );

  const corpo = overlay.querySelector('.modal');

  if (movimentos.length === 0) {
    corpo.innerHTML = `
      <h2>${t('estoque_historico', lang)} — ${esc(produto.nome)}</h2>
      <p class="silencioso mt-1">${t('estoque_sem_movimentos', lang)}</p>
      <div class="acoes-formulario"><button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_voltar', lang)}</button></div>
    `;
  } else {
    const linhas = movimentos
      .map((m) => {
        const positivo = ['entrada_compra', 'ajuste_positivo', 'devolucao'].includes(m.tipo);
        return `
          <tr>
            <td>${formatDateTime(m.created_at, filial)}</td>
            <td>${TIPO_MOVIMENTO_ESTOQUE_LABELS[m.tipo] || m.tipo}</td>
            <td class="preco" style="color:${positivo ? '#2F4F3E' : '#A8503C'}">${positivo ? '+' : '−'}${m.quantidade}</td>
            <td>${esc(m.perfis?.nome || '—')}</td>
            <td class="silencioso">${esc(m.observacao || '')}</td>
          </tr>
        `;
      })
      .join('');

    corpo.innerHTML = `
      <h2>${t('estoque_historico', lang)} — ${esc(produto.nome)}</h2>
      <div class="tabela-wrap mt-1">
        <table>
          <thead><tr><th>${t('estoque_data', lang)}</th><th>${t('estoque_tipo_movimento', lang)}</th><th>${t('estoque_quantidade_movimento', lang)}</th><th>${t('estoque_responsavel', lang)}</th><th>${t('estoque_observacao', lang)}</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <div class="acoes-formulario"><button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_voltar', lang)}</button></div>
    `;
  }

  corpo.querySelectorAll('[data-fechar-modal]').forEach((el) => el.addEventListener('click', () => fecharModal(overlay)));
}
