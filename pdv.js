// =====================================================================
// pdv.js — módulo "PDV" do roteador admin.js.
// Fase 3.3: Ponto de Venda. Monta um payload com os itens do carrinho
// (combos já expandidos/prorateados, resgates de pacote já marcados) e
// chama fn_registrar_venda (Seção 16 do schema), que registra a venda,
// os itens (disparando estoque automaticamente), os lançamentos
// financeiros, fiado, pacotes e fidelidade — tudo em uma transação.
// =====================================================================

import { esc } from './util.js';
import { campoTexto, campoNumero, campoSelect, valorTexto } from './form.js';
import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatPrecoFilial, formatDateTime } from './formatters.js';
import { FORMA_PAGAMENTO_LABELS } from './constants.js';

let sessao, lang, filial, raiz;
let servicos = [], produtos = [], combos = [], pacotesServico = [], barbeiros = [];

let carrinho = [];          // [{ idLocal, tipo_item, servico_id, produto_id, nome, quantidade, preco_unitario, preco_catalogo, custo_unitario, barbeiro_id, pacote_cliente_id, _precoOriginal }]
let vendaPacote = null;     // { pacote_servico_id, nome, quantidade_sessoes, preco_total, servico_nome }
let clienteSelecionado = null;
let pacotesAtivosCliente = [];
let atendentePrincipalId = null;
let formaPagamento = 'dinheiro';
let desconto = 0;
let abaCatalogo = 'servicos';
let erroCheckout = '';
let proximoIdLocal = 1;

export async function init(root, sessaoAtual, ctx) {
  raiz = root;
  sessao = sessaoAtual;
  filial = ctx.filialAtiva();
  lang = ctx.lang;

  if (!filial) {
    raiz.innerHTML = `<div class="cabecalho-pagina"><h1>${t('pdv_titulo', lang)}</h1></div><div class="cartao">Nenhuma filial cadastrada ainda.</div>`;
    return;
  }

  [servicos, produtos, combos, pacotesServico, barbeiros] = await Promise.all([
    supabase.from('servicos').select('id, nome, preco, duracao_minutos').eq('ativo', true).order('nome').then(unwrap),
    supabase.from('produtos').select('id, nome, preco_venda, custo_unitario, unidade').eq('ativo', true).order('nome').then(unwrap),
    supabase.from('combos').select('*, combo_itens(*, servicos(nome, preco), produtos(nome, preco_venda, custo_unitario))').eq('ativo', true).order('nome').then(unwrap),
    supabase.from('pacotes_servico').select('*, servicos(nome, preco)').eq('ativo', true).order('nome').then(unwrap),
    supabase.from('perfis').select('id, nome').eq('filial_id', filial.id).eq('cargo', 'barbeiro').eq('ativo', true).order('nome').then(unwrap),
  ]);

  if (barbeiros.length === 0) {
    raiz.innerHTML = `<div class="cabecalho-pagina"><h1>${t('pdv_titulo', lang)}</h1></div><div class="cartao">${t('pdv_filial_sem_barbeiro', lang)}</div>`;
    return;
  }

  atendentePrincipalId = sessao.perfil.cargo === 'barbeiro' ? sessao.perfil.id : barbeiros[0].id;

  renderShell(raiz);
  render();

  // Reseta o estado do carrinho ao saltar para outro módulo e voltar.
  return {
    destruir() {
      carrinho = [];
      vendaPacote = null;
      clienteSelecionado = null;
      pacotesAtivosCliente = [];
      desconto = 0;
      formaPagamento = 'dinheiro';
      erroCheckout = '';
    },
  };
}

function injectPrintStyles() {
  // Verifica se o estilo já foi injetado
  if (document.getElementById('print-styles-termico')) return;

  const style = document.createElement('style');
  style.id = 'print-styles-termico';
  style.textContent = `
    /* Estilos para impressora térmica 80mm */
    @media print {
      /* Oculta elementos da interface */
      body * {
        visibility: hidden;
      }
      #recibo-para-imprimir, #recibo-para-imprimir * {
        visibility: visible;
      }
      #recibo-para-imprimir {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        max-width: 80mm;
        margin: 0 auto;
        padding: 4mm 3mm;
        font-family: 'Courier New', Courier, monospace;
        font-size: 11pt;
        line-height: 1.4;
        color: #000;
        background: #fff;
        box-sizing: border-box;
      }

      /* Margens da página */
      @page {
        margin: 0;
        size: 80mm auto; /* Largura 80mm, altura automática */
      }

      /* Linhas do recibo */
      .recibo-linha {
        display: flex;
        justify-content: space-between;
        padding: 0.5mm 0;
        font-size: 10pt;
      }
      .recibo-linha .descricao {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .recibo-linha .preco {
        flex: 0 0 auto;
        margin-left: 4mm;
        text-align: right;
      }

      .recibo-titulo {
        font-weight: bold;
        font-size: 14pt;
        text-align: center;
        margin-bottom: 1mm;
      }
      .recibo-subtitulo {
        text-align: center;
        font-size: 9pt;
        margin-bottom: 1mm;
      }
      .recibo-total {
        font-weight: bold;
        font-size: 12pt;
        border-top: 2px dashed #000;
        padding-top: 1mm;
        margin-top: 1mm;
      }
      .recibo-agradecimento {
        text-align: center;
        margin-top: 2mm;
        font-size: 10pt;
        border-top: 1px dashed #888;
        padding-top: 2mm;
      }

      hr {
        border: none;
        border-top: 1px dashed #888;
        margin: 1mm 0;
      }

      /* Esconde botões e elementos não recibo */
      .acoes-formulario, .pdv-recibo > .acoes-formulario, #btn-imprimir, #btn-nova-venda {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function renderShell(conteudo) {
  conteudo.innerHTML = `
    <div class="cabecalho-pagina">
      <div><h1>${t('pdv_titulo', lang)}</h1><p>${esc(filial.nome)}</p></div>
    </div>
    <div class="pdv-layout">
      <div class="pdv-catalogo">
        <div class="tabs-inline" id="tabs-pdv-catalogo">
          <button data-aba="servicos" class="ativo">${t('tab_servicos', lang)}</button>
          <button data-aba="produtos">${t('tab_produtos', lang)}</button>
          <button data-aba="combos">${t('tab_combos', lang)}</button>
          <button data-aba="pacotes">${t('tab_pacotes', lang)}</button>
        </div>
        <div class="pdv-catalogo-grid mt-1" id="grid-catalogo"></div>
      </div>
      <div class="pdv-carrinho" id="pdv-carrinho"></div>
    </div>
  `;

  raiz.querySelectorAll('#tabs-pdv-catalogo button').forEach((btn) => {
    btn.addEventListener('click', () => {
      raiz.querySelectorAll('#tabs-pdv-catalogo button').forEach((b) => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      abaCatalogo = btn.dataset.aba;
      renderCatalogo();
    });
  });
}

function render() {
  renderCatalogo();
  renderCarrinho();
}

// =====================================================================
// CATÁLOGO
// =====================================================================

function renderCatalogo() {
  const grid = raiz.querySelector('#grid-catalogo');

  if (abaCatalogo === 'servicos') {
    grid.innerHTML = servicos.map((s) => `
      <button class="pdv-item-catalogo" data-tipo="servico" data-id="${s.id}">
        <div class="nome">${esc(s.nome)}</div>
        <span class="preco">${formatPrecoFilial(s.preco, filial)}</span>
        <div class="meta">${s.duracao_minutos} min</div>
      </button>
    `).join('') || vazioCatalogo();
  } else if (abaCatalogo === 'produtos') {
    grid.innerHTML = produtos.map((p) => `
      <button class="pdv-item-catalogo" data-tipo="produto" data-id="${p.id}">
        <div class="nome">${esc(p.nome)}</div>
        <span class="preco">${formatPrecoFilial(p.preco_venda, filial)}</span>
        <div class="meta">${esc(p.unidade)}</div>
      </button>
    `).join('') || vazioCatalogo();
  } else if (abaCatalogo === 'combos') {
    grid.innerHTML = combos.map((c) => `
      <button class="pdv-item-catalogo" data-tipo="combo" data-id="${c.id}">
        <div class="nome">${esc(c.nome)}</div>
        <span class="preco">${formatPrecoFilial(c.preco_total, filial)}</span>
        <div class="meta">${c.combo_itens.map((ci) => `${ci.quantidade}× ${esc(ci.servicos?.nome || ci.produtos?.nome || '')}`).join(' + ')}</div>
      </button>
    `).join('') || vazioCatalogo();
  } else if (abaCatalogo === 'pacotes') {
    grid.innerHTML = pacotesServico.map((p) => `
      <button class="pdv-item-catalogo" data-tipo="pacote" data-id="${p.id}">
        <div class="nome">${esc(p.nome)}</div>
        <span class="preco">${formatPrecoFilial(p.preco_total, filial)}</span>
        <div class="meta">${p.quantidade_sessoes}× ${esc(p.servicos?.nome || '')}</div>
      </button>
    `).join('') || vazioCatalogo();
  }

  grid.querySelectorAll('.pdv-item-catalogo').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.tipo === 'servico') adicionarServico(servicos.find((s) => s.id === id));
      else if (btn.dataset.tipo === 'produto') adicionarProduto(produtos.find((p) => p.id === id));
      else if (btn.dataset.tipo === 'combo') adicionarCombo(combos.find((c) => c.id === id));
      else if (btn.dataset.tipo === 'pacote') definirVendaPacote(pacotesServico.find((p) => p.id === id));
    });
  });
}

function vazioCatalogo() {
  return `<div class="tabela-vazia">Nenhum item cadastrado.</div>`;
}

// =====================================================================
// AÇÕES NO CARRINHO
// =====================================================================

function adicionarServico(servico) {
  carrinho.push({
    idLocal: proximoIdLocal++,
    tipo_item: 'servico',
    servico_id: servico.id,
    produto_id: null,
    nome: servico.nome,
    quantidade: 1,
    preco_unitario: servico.preco,
    preco_catalogo: servico.preco,
    custo_unitario: 0,
    barbeiro_id: atendentePrincipalId,
    pacote_cliente_id: null,
  });
  render();
}

function adicionarProduto(produto) {
  carrinho.push({
    idLocal: proximoIdLocal++,
    tipo_item: 'produto',
    servico_id: null,
    produto_id: produto.id,
    nome: produto.nome,
    quantidade: 1,
    preco_unitario: produto.preco_venda,
    preco_catalogo: produto.preco_venda,
    custo_unitario: produto.custo_unitario,
    barbeiro_id: atendentePrincipalId,
    pacote_cliente_id: null,
  });
  render();
}

/**
 * Expande um combo em itens individuais com preco_unitario PRORATEADO de
 * forma que a soma seja exatamente igual a combo.preco_total (o último
 * item recebe um ajuste residual para fechar centavos). Comissão e custo
 * de cada item continuam baseados no preco_catalogo (preço de tabela),
 * não no preco_unitario prorateado — isso é resolvido em fn_registrar_venda.
 */
function adicionarCombo(combo) {
  const base = combo.combo_itens.map((ci) => {
    const tabela = ci.tipo_item === 'servico' ? ci.servicos : ci.produtos;
    const precoCatalogo = ci.tipo_item === 'servico' ? tabela.preco : tabela.preco_venda;
    return {
      tipo_item: ci.tipo_item,
      servico_id: ci.tipo_item === 'servico' ? ci.servico_id : null,
      produto_id: ci.tipo_item === 'produto' ? ci.produto_id : null,
      nome: tabela.nome,
      quantidade: Number(ci.quantidade) || 0, // fallback para 0
      preco_catalogo: Number(precoCatalogo) || 0,
      custo_unitario: ci.tipo_item === 'produto' ? (Number(tabela.custo_unitario) || 0) : 0,
    };
  });

  // Se algum item tiver quantidade zero, não podemos dividir; define preço zero para todos
  if (base.some(it => it.quantidade <= 0)) {
    base.forEach(it => { it.precoUnitario = 0; });
  } else {
    const somaCatalogo = base.reduce((acc, i) => acc + i.preco_catalogo * i.quantidade, 0);
    const fator = somaCatalogo > 0 ? Number(combo.preco_total) / somaCatalogo : 1;

    let subtotalParcial = 0;
    base.forEach((it, idx) => {
      let preco;
      if (idx < base.length - 1) {
        preco = Math.round(it.preco_catalogo * fator * 100) / 100;
        subtotalParcial += preco * it.quantidade;
      } else {
        preco = Math.round((Number(combo.preco_total) - subtotalParcial) / it.quantidade * 100) / 100;
      }
      // Garantir que preco seja um número finito e não negativo
      it.precoUnitario = (Number.isFinite(preco) && preco >= 0) ? preco : 0;
    });
  }

  base.forEach((it) => {
    carrinho.push({
      idLocal: proximoIdLocal++,
      tipo_item: it.tipo_item,
      servico_id: it.servico_id,
      produto_id: it.produto_id,
      nome: it.nome,
      quantidade: it.quantidade,
      preco_unitario: it.precoUnitario,
      preco_catalogo: it.preco_catalogo,
      custo_unitario: it.custo_unitario,
      barbeiro_id: atendentePrincipalId,
      pacote_cliente_id: null,
    });
  });

  render();
}

function definirVendaPacote(pacote) {
  vendaPacote = {
    pacote_servico_id: pacote.id,
    nome: pacote.nome,
    quantidade_sessoes: pacote.quantidade_sessoes,
    preco_total: Number(pacote.preco_total),
    servico_nome: pacote.servicos?.nome || '',
  };
  render();
}

function removerItemCarrinho(idLocal) {
  carrinho = carrinho.filter((i) => i.idLocal !== idLocal);
  render();
}

function alterarQuantidade(idLocal, quantidade) {
  const item = carrinho.find((i) => i.idLocal === idLocal);
  // Number.isFinite() rejeita NaN, Infinity e -Infinity — uma simples
  // checagem `quantidade <= 0` NÃO bloqueia NaN, porque `NaN <= 0` é
  // `false` em JavaScript. Um NaN escapando daqui vira `null` ao
  // serializar o payload (JSON.stringify(NaN) === 'null'), o que gera
  // "null value in column total" lá no banco — silencioso até estourar
  // bem longe da causa real.
  if (!item || !Number.isFinite(quantidade) || quantidade <= 0) {
    render(); // força o input a voltar a refletir o valor anterior válido
    return;
  }
  item.quantidade = quantidade;
  render();
}

function alterarBarbeiroItem(idLocal, barbeiroId) {
  const item = carrinho.find((i) => i.idLocal === idLocal);
  if (item) item.barbeiro_id = barbeiroId;
}

function alternarUsoPacote(idLocal, pacoteClienteId, marcado) {
  const item = carrinho.find((i) => i.idLocal === idLocal);
  if (!item) return;
  if (marcado) {
    item._precoOriginal = item.preco_unitario;
    item.preco_unitario = 0;
    item.pacote_cliente_id = pacoteClienteId;
  } else {
    item.preco_unitario = item._precoOriginal ?? item.preco_catalogo;
    item.pacote_cliente_id = null;
  }
  render();
}

// =====================================================================
// CARRINHO (RENDER)
// =====================================================================

function calcularTotais() {
  const subtotalBruto = carrinho.reduce((acc, i) => acc + i.preco_unitario * i.quantidade, 0);
  const descontoValido = Number.isFinite(desconto) ? desconto : 0;
  const totalBruto = subtotalBruto - descontoValido + (vendaPacote ? vendaPacote.preco_total : 0);
  return { subtotalBruto, total: Math.max(totalBruto, 0) };
}

function renderCarrinho() {
  const painel = raiz.querySelector('#pdv-carrinho');
  const { subtotalBruto, total } = calcularTotais();

  const opcoesBarbeiro = barbeiros.map((b) => ({ valor: b.id, texto: b.nome }));

  const linhasItens = carrinho.map((item) => {
    const pacoteCompativel = item.tipo_item === 'servico'
      ? pacotesAtivosCliente.find((p) => p.servico_id === item.servico_id && p.sessoes_restantes > 0)
      : null;

    return `
      <div class="pdv-linha-carrinho" data-id-local="${item.idLocal}">
        <div class="topo">
          <div class="nome">${esc(item.nome)}</div>
          <div class="subtotal">${formatPrecoFilial(item.preco_unitario * item.quantidade, filial)}</div>
        </div>
        <div class="controles">
          <input type="number" class="input-qtd" min="0.01" step="1" value="${item.quantidade}" data-acao="quantidade" />
          ${campoSelect({ id: '', label: '', valor: item.barbeiro_id, opcoes: opcoesBarbeiro }).replace('<div class="campo">', '').replace('<label for=""></label>', '').replace('</div>', '').replace('<select id="">', '<select class="select-barbeiro" data-acao="barbeiro">')}
          <button type="button" class="btn-remover-carrinho" data-acao="remover" aria-label="${t('pdv_remover', lang)}">✕</button>
        </div>
        ${pacoteCompativel ? `
          <label class="pdv-toggle-pacote">
            <input type="checkbox" data-acao="usar-pacote" data-pacote-id="${pacoteCompativel.id}" ${item.pacote_cliente_id ? 'checked' : ''} />
            ${t('pdv_usar_pacote', lang)} (${pacoteCompativel.sessoes_restantes} ${t('pdv_sessoes_restantes', lang)})
          </label>
        ` : ''}
      </div>
    `;
  }).join('');

  const linhaPacote = vendaPacote ? `
    <div class="pdv-linha-carrinho" style="border-color:var(--brass)">
      <div class="topo">
        <div class="nome">📦 ${esc(vendaPacote.nome)}</div>
        <div class="subtotal">${formatPrecoFilial(vendaPacote.preco_total, filial)}</div>
      </div>
      <div class="controles">
        <span class="silencioso">${vendaPacote.quantidade_sessoes}× ${esc(vendaPacote.servico_nome)}</span>
        <button type="button" class="btn-remover-carrinho" data-acao="remover-pacote" aria-label="${t('pdv_remover', lang)}">✕</button>
      </div>
    </div>
  ` : '';

  const semItens = carrinho.length === 0 && !vendaPacote;

  painel.innerHTML = `
    <h2>${t('pdv_carrinho', lang)}</h2>

    <div>
      <label class="silencioso" style="font-weight:600">${t('pdv_cliente', lang)}</label>
      ${renderClienteSecao()}
    </div>

    <div class="campo" style="margin-bottom:0">
      ${campoSelect({ id: 'select-atendente', label: t('pdv_atendido_por', lang), valor: atendentePrincipalId, opcoes: opcoesBarbeiro })}
    </div>

    <div>
      ${semItens ? `<div class="silencioso">${t('pdv_carrinho_vazio', lang)}</div>` : `<div style="display:flex; flex-direction:column; gap:0.5rem">${linhaPacote}${linhasItens}</div>`}
    </div>

    <div class="pdv-totais">
      <div class="linha-total"><span>${t('pdv_subtotal', lang)}</span><span>${formatPrecoFilial(subtotalBruto + (vendaPacote?.preco_total || 0), filial)}</span></div>
      <div class="campo" style="margin:0.4rem 0">
        ${campoNumero({ id: 'input-desconto', label: t('pdv_desconto', lang), valor: desconto, min: 0 })}
      </div>
      <div class="campo" style="margin-bottom:0.4rem">
        ${campoSelect({ id: 'select-forma-pagamento', label: t('pdv_forma_pagamento', lang), valor: formaPagamento, opcoes: Object.entries(FORMA_PAGAMENTO_LABELS).map(([valor, texto]) => ({ valor, texto })) })}
      </div>
      <div class="linha-total total-geral"><span>${t('pdv_total', lang)}</span><span>${formatPrecoFilial(total, filial)}</span></div>
    </div>

    ${erroCheckout ? `<div class="mensagem-erro">${esc(erroCheckout)}</div>` : ''}

    <button class="botao botao-acento" id="btn-finalizar" style="justify-content:center" ${semItens ? 'disabled' : ''}>${t('pdv_finalizar', lang)}</button>
  `;

  // ---- listeners ----
  raiz.querySelector('#select-atendente').addEventListener('change', (ev) => {
    atendentePrincipalId = ev.target.value;
  });
  raiz.querySelector('#input-desconto').addEventListener('input', (ev) => {
    desconto = Number(ev.target.value) || 0;
    renderCarrinho();
  });
  raiz.querySelector('#select-forma-pagamento').addEventListener('change', (ev) => {
    formaPagamento = ev.target.value;
  });

  painel.querySelectorAll('.pdv-linha-carrinho[data-id-local]').forEach((linha) => {
    const idLocal = Number(linha.dataset.idLocal);
    const inputQtd = linha.querySelector('[data-acao="quantidade"]');
    if (inputQtd) inputQtd.addEventListener('change', () => alterarQuantidade(idLocal, Number(inputQtd.value)));

    const selectBarbeiro = linha.querySelector('[data-acao="barbeiro"]');
    if (selectBarbeiro) selectBarbeiro.addEventListener('change', () => alterarBarbeiroItem(idLocal, selectBarbeiro.value));

    const btnRemover = linha.querySelector('[data-acao="remover"]');
    if (btnRemover) btnRemover.addEventListener('click', () => removerItemCarrinho(idLocal));

    const checkPacote = linha.querySelector('[data-acao="usar-pacote"]');
    if (checkPacote) checkPacote.addEventListener('change', () => alternarUsoPacote(idLocal, checkPacote.dataset.pacoteId, checkPacote.checked));
  });

  const btnRemoverPacote = painel.querySelector('[data-acao="remover-pacote"]');
  if (btnRemoverPacote) btnRemoverPacote.addEventListener('click', () => { vendaPacote = null; render(); });

  const btnFinalizar = raiz.querySelector('#btn-finalizar');
  if (btnFinalizar) btnFinalizar.addEventListener('click', finalizarVenda);

  ligarEventosCliente();
}

// =====================================================================
// CLIENTE
// =====================================================================

function renderClienteSecao() {
  if (clienteSelecionado) {
    return `
      <div class="pdv-cliente-card mt-1">
        <div class="flex-entre">
          <span class="nome">${esc(clienteSelecionado.nome)}</span>
          <button type="button" class="botao botao-secundario" id="btn-trocar-cliente">${t('pdv_trocar_cliente', lang)}</button>
        </div>
        ${clienteSelecionado.telefone ? `<div class="silencioso">${esc(clienteSelecionado.telefone)}</div>` : ''}
        <div class="silencioso mt-1">
          ${Number(clienteSelecionado.saldo_fiado || 0) > 0 ? `${t('pdv_saldo_fiado', lang)}: ${formatPrecoFilial(clienteSelecionado.saldo_fiado, filial)} · ` : ''}
          ${t('pdv_pontos_fidelidade', lang)}: ${clienteSelecionado.pontos_fidelidade ?? 0}
          ${pacotesAtivosCliente.length > 0 ? ` · ${pacotesAtivosCliente.map((p) => `${esc(p.pacote_nome)} (${p.sessoes_restantes})`).join(', ')}` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="campo mt-1" style="margin-bottom:0.3rem">
      <input type="text" id="busca-cliente" placeholder="${t('pdv_buscar_cliente', lang)}" autocomplete="off" />
    </div>
    <div id="resultados-cliente"></div>
    <button type="button" class="botao botao-secundario mt-1" id="btn-novo-cliente">${t('pdv_novo_cliente', lang)}</button>
    <div id="form-novo-cliente" class="oculto mt-1"></div>
  `;
}

function ligarEventosCliente() {
  const buscaInput = raiz.querySelector('#busca-cliente');
  if (buscaInput) {
    let timeoutId;
    buscaInput.addEventListener('input', () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => buscarClientes(buscaInput.value.trim()), 300);
    });
  }

  const btnTrocar = raiz.querySelector('#btn-trocar-cliente');
  if (btnTrocar) btnTrocar.addEventListener('click', () => {
    clienteSelecionado = null;
    pacotesAtivosCliente = [];
    renderCarrinho();
  });

  const btnNovoCliente = raiz.querySelector('#btn-novo-cliente');
  if (btnNovoCliente) btnNovoCliente.addEventListener('click', () => abrirFormNovoCliente());
}

async function buscarClientes(termo) {
  const resultadosEl = raiz.querySelector('#resultados-cliente');
  if (!resultadosEl) return;
  if (termo.length < 2) {
    resultadosEl.innerHTML = '';
    return;
  }

  const [porNome, porTelefone] = await Promise.all([
    supabase.from('clientes').select('id, nome, telefone, saldo_fiado, pontos_fidelidade').eq('empresa_id', sessao.perfil.empresa_id).ilike('nome', `%${termo}%`).limit(5).then(unwrap),
    supabase.from('clientes').select('id, nome, telefone, saldo_fiado, pontos_fidelidade').eq('empresa_id', sessao.perfil.empresa_id).ilike('telefone', `%${termo}%`).limit(5).then(unwrap),
  ]);

  const vistos = new Set();
  const resultados = [...porNome, ...porTelefone].filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true)));

  if (resultados.length === 0) {
    resultadosEl.innerHTML = `<div class="silencioso mt-1">${t('pdv_sem_resultado_cliente', lang)}</div>`;
    return;
  }

  resultadosEl.innerHTML = `
    <div class="pdv-resultados-cliente mt-1">
      ${resultados.map((c) => `<button type="button" data-id="${c.id}">${esc(c.nome)}${c.telefone ? ` — ${esc(c.telefone)}` : ''}</button>`).join('')}
    </div>
  `;

  resultadosEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => selecionarCliente(resultados.find((c) => c.id === btn.dataset.id)));
  });
}

async function selecionarCliente(cliente) {
  clienteSelecionado = cliente;
  pacotesAtivosCliente = unwrap(
    await supabase
      .from('vw_pacotes_cliente_ativos')
      .select('id, pacote_nome, servico_id, sessoes_restantes')
      .eq('cliente_id', cliente.id)
      .eq('filial_id', filial.id)
      .gt('sessoes_restantes', 0)
  );
  renderCarrinho();
}

function abrirFormNovoCliente() {
  const container = raiz.querySelector('#form-novo-cliente');
  container.classList.remove('oculto');
  container.innerHTML = `
    ${campoTexto({ id: 'novo-cliente-nome', label: t('campo_nome', lang) })}
    ${campoTexto({ id: 'novo-cliente-telefone', label: 'Telefone' })}
    <div id="erro-novo-cliente" class="mensagem-erro oculto"></div>
    <button type="button" class="botao botao-primario" id="btn-salvar-novo-cliente">${t('acao_salvar', lang)}</button>
  `;

  raiz.querySelector('#btn-salvar-novo-cliente').addEventListener('click', async () => {
    const nome = raiz.querySelector('#novo-cliente-nome').value.trim();
    const telefone = raiz.querySelector('#novo-cliente-telefone').value.trim() || null;
    const erroEl = raiz.querySelector('#erro-novo-cliente');

    if (!nome) {
      erroEl.textContent = 'Informe o nome do cliente.';
      erroEl.classList.remove('oculto');
      return;
    }

    try {
      const novo = unwrap(await supabase.from('clientes').insert({ empresa_id: sessao.perfil.empresa_id, nome, telefone }).select().single());
      await selecionarCliente(novo);
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });
}

// =====================================================================
// CHECKOUT
// =====================================================================

async function finalizarVenda() {
  erroCheckout = '';

  // 1. Validações
  if (carrinho.length === 0 && !vendaPacote) {
    erroCheckout = t('pdv_carrinho_vazio_erro', lang);
    renderCarrinho();
    return;
  }
  if (vendaPacote && !clienteSelecionado) {
    erroCheckout = 'A venda de um pacote requer um cliente selecionado.';
    renderCarrinho();
    return;
  }
  if (formaPagamento === 'fiado' && !clienteSelecionado) {
    erroCheckout = 'Venda fiado requer um cliente selecionado.';
    renderCarrinho();
    return;
  }

  // 2. Calcular total
  const { total } = calcularTotais();
  if (!Number.isFinite(total) || total < 0) {
    erroCheckout = 'O total calculado é inválido. Verifique os valores do carrinho.';
    renderCarrinho();
    return;
  }

  // 3. Desabilitar botão
  const btn = raiz.querySelector('#btn-finalizar');
  btn.disabled = true;
  btn.textContent = t('pdv_finalizando', lang);

  // 4. Montar itens
  const itensPayload = carrinho.map((i) => ({
    tipo_item: i.tipo_item,
    servico_id: i.servico_id,
    produto_id: i.produto_id,
    barbeiro_id: i.barbeiro_id,
    quantidade: i.quantidade,
    preco_unitario: i.preco_unitario,
    pacote_cliente_id: i.pacote_cliente_id,
  }));

  // 5. Montar payload base (sem venda_pacote)
  const payload = {
    filial_id: filial.id,
    cliente_id: clienteSelecionado?.id ?? null,
    barbeiro_id: atendentePrincipalId,
    forma_pagamento: formaPagamento,
    moeda: filial.moeda_principal || 'PYG', // fallback seguro
    desconto: Number.isFinite(desconto) ? desconto : 0,
    total: total,
    itens: itensPayload,
  };

  // 6. Adicionar venda_pacote APENAS se existir
  if (vendaPacote) {
    payload.venda_pacote = {
      pacote_servico_id: vendaPacote.pacote_servico_id,
      preco_total: vendaPacote.preco_total,
    };
  }

  // 7. Validação de todos os números
  const todosNumeros = [
    payload.desconto,
    payload.total,
    ...payload.itens.flatMap(i => [i.quantidade, i.preco_unitario]),
  ];
  if (payload.venda_pacote) {
    todosNumeros.push(payload.venda_pacote.preco_total);
  }
  if (todosNumeros.some(v => v === null || v === undefined || !Number.isFinite(v))) {
    erroCheckout = 'Há um valor inválido (NaN/Infinity) no payload. Verifique os itens e o desconto.';
    renderCarrinho();
    btn.disabled = false;
    btn.textContent = t('pdv_finalizar', lang);
    return;
  }

  // 8. Log de depuração
  console.log('🚀 Payload enviado (final):', JSON.stringify(payload, null, 2));

  try {
    const vendaId = unwrap(await supabase.rpc('fn_registrar_venda', { p_payload: payload }));
    renderRecibo(vendaId);
  } catch (e) {
    erroCheckout = e.message;
    renderCarrinho();
  } finally {
    btn.disabled = false;
    btn.textContent = t('pdv_finalizar', lang);
  }
}

// =====================================================================
// RECIBO
// =====================================================================

function renderRecibo(vendaId) {
  const { subtotalBruto, total } = calcularTotais();
  const agora = new Date();
  const filialNome = esc(filial.nome);
  const dataHora = formatDateTime(agora.toISOString(), filial);

  // Monta o HTML do recibo com classes específicas para impressão
  const reciboHTML = `
    <div id="recibo-para-imprimir" class="recibo-termico">
      <div class="recibo-cabecalho">
        <div class="recibo-titulo">${filialNome}</div>
        <div class="recibo-subtitulo">${dataHora}</div>
        <hr />
      </div>
      <div class="recibo-itens">
        ${vendaPacote ? `
          <div class="recibo-linha">
            <span class="descricao">📦 ${esc(vendaPacote.nome)}</span>
            <span class="preco">${formatPrecoFilial(vendaPacote.preco_total, filial)}</span>
          </div>
        ` : ''}
        ${carrinho.map((item) => `
          <div class="recibo-linha">
            <span class="descricao">${item.quantidade}× ${esc(item.nome)}</span>
            <span class="preco">${formatPrecoFilial(item.preco_unitario * item.quantidade, filial)}</span>
          </div>
        `).join('')}
      </div>
      <hr />
      <div class="recibo-totais">
        <div class="recibo-linha">
          <span>Subtotal</span>
          <span>${formatPrecoFilial(subtotalBruto + (vendaPacote?.preco_total || 0), filial)}</span>
        </div>
        ${desconto > 0 ? `
          <div class="recibo-linha">
            <span>Desconto</span>
            <span>-${formatPrecoFilial(desconto, filial)}</span>
          </div>
        ` : ''}
        <div class="recibo-linha recibo-total">
          <span><strong>TOTAL</strong></span>
          <span><strong>${formatPrecoFilial(total, filial)}</strong></span>
        </div>
      </div>
      <hr />
      <div class="recibo-rodape">
        <div class="recibo-linha">
          <span>Pagamento</span>
          <span>${FORMA_PAGAMENTO_LABELS[formaPagamento]}</span>
        </div>
        ${clienteSelecionado ? `
          <div class="recibo-linha">
            <span>Cliente</span>
            <span>${esc(clienteSelecionado.nome)}</span>
          </div>
        ` : ''}
        <div class="recibo-linha">
          <span>#Venda</span>
          <span>${vendaId.slice(0, 8)}</span>
        </div>
        <div class="recibo-agradecimento">Obrigado pela preferência!</div>
      </div>
    </div>
  `;

  // Renderiza a tela com o recibo e os botões
  const painel = raiz.querySelector('#pdv-carrinho');
  painel.innerHTML = `
    <div class="pdv-recibo">
      ${reciboHTML}
    </div>
    <div class="acoes-formulario mt-1" style="justify-content:center; gap:0.5rem;">
      <button type="button" class="botao botao-secundario" id="btn-imprimir">${t('pdv_imprimir', lang)}</button>
      <button type="button" class="botao botao-acento" id="btn-nova-venda">${t('pdv_nova_venda', lang)}</button>
    </div>
  `;

  // Adiciona o CSS para impressão térmica (será injetado uma única vez)
  injectPrintStyles();

  // Botão de imprimir usando iframe isolado
  raiz.querySelector('#btn-imprimir').addEventListener('click', () => {
    imprimirReciboIsolado(reciboHTML);
  });

  raiz.querySelector('#btn-nova-venda').addEventListener('click', () => {
    carrinho = [];
    vendaPacote = null;
    clienteSelecionado = null;
    pacotesAtivosCliente = [];
    desconto = 0;
    formaPagamento = 'dinheiro';
    erroCheckout = '';
    render();
  });
}

/**
 * Imprime o recibo em uma janela/iframe isolada, garantindo que o layout
 * seja otimizado para impressoras térmicas (80mm).
 */
function imprimirReciboIsolado(reciboHTML) {
  // Cria um iframe oculto
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  // Escreve o conteúdo no iframe
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Recibo</title>
      <style>
        /* Estilos específicos para impressão térmica */
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #fff;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          font-family: 'Courier New', Courier, monospace;
        }
        .recibo-termico {
          width: 80mm;
          padding: 3mm 2mm;
          font-size: 10pt;
          line-height: 1.4;
          color: #000;
          background: #fff;
        }
        .recibo-cabecalho {
          text-align: center;
          margin-bottom: 2mm;
        }
        .recibo-titulo {
          font-weight: bold;
          font-size: 14pt;
          margin-bottom: 1mm;
        }
        .recibo-subtitulo {
          font-size: 9pt;
          color: #555;
        }
        .recibo-linha {
          display: flex;
          justify-content: space-between;
          padding: 0.5mm 0;
          font-size: 10pt;
        }
        .recibo-linha .descricao {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .recibo-linha .preco {
          flex: 0 0 auto;
          margin-left: 3mm;
          text-align: right;
        }
        .recibo-total {
          font-weight: bold;
          border-top: 2px dashed #000;
          padding-top: 1mm;
          margin-top: 1mm;
        }
        .recibo-agradecimento {
          text-align: center;
          margin-top: 2mm;
          border-top: 1px dashed #888;
          padding-top: 2mm;
          font-size: 9pt;
        }
        hr {
          border: none;
          border-top: 1px dashed #888;
          margin: 1mm 0;
        }
        @page {
          margin: 0;
          size: 80mm auto;
        }
        @media print {
          body { margin: 0; padding: 0; }
        }
      </style>
    </head>
    <body>
      ${reciboHTML}
    </body>
    </html>
  `);
  doc.close();

  // Aguarda o carregamento e dispara a impressão
  iframe.onload = function() {
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        console.error('Erro ao imprimir:', e);
      } finally {
        // Remove o iframe após a impressão (ou após um tempo)
        setTimeout(() => {
          iframe.remove();
        }, 5000);
      }
    }, 500);
  };

  // Fallback: se o iframe não carregar, tenta após 2s
  setTimeout(() => {
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        console.error('Fallback: erro ao imprimir:', e);
      } finally {
        setTimeout(() => iframe.remove(), 5000);
      }
    }
  }, 2000);
}