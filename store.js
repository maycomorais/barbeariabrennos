// =====================================================================
// store.js — módulo de loja do app público (app.js).
// Com carrinho, checkout e integração com a RPC fn_registrar_venda.
// =====================================================================

import { supabase, unwrap } from './supabase.js';
import { formatPrecoFilial } from './formatters.js';
import { esc } from './util.js';

let carrinho = [];
let filialAtual = null;
let rootElement = null;
let aoVoltarCallback = null;

export async function iniciarLoja(root, filial, aoVoltar) {
  rootElement = root;
  filialAtual = filial;
  aoVoltarCallback = aoVoltar;
  carrinho = [];

  root.innerHTML = `<div class="carregando">Carregando…</div>`;

  const produtos = unwrap(await supabase.rpc('fn_loja_filial', { p_filial_id: filial.id }));
  renderLoja(produtos);
}

function renderLoja(produtos) {
  const totalItens = carrinho.reduce((a, i) => a + i.quantidade, 0);
  const totalPreco = carrinho.reduce((a, i) => a + i.preco * i.quantidade, 0);

  const cards = produtos.map(p => `
    <div class="product-card" data-id="${p.id}">
      ${p.foto_url ? `<img src="${p.foto_url}" alt="${p.nome}" />` : `<div style="aspect-ratio:1/1;background:var(--bg-card);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:2rem;">🧴</div>`}
      <div class="name">${esc(p.nome)}</div>
      <div class="price">${formatPrecoFilial(p.preco_venda, filialAtual)}</div>
      ${!p.disponivel ? `<div class="out-of-stock">Esgotado</div>` : `<button class="btn-primary" style="margin-top:8px;font-size:0.75rem;padding:8px;">Adicionar</button>`}
    </div>
  `).join('');

  rootElement.innerHTML = `
    <div class="topo-app">
      <button class="botao-voltar" id="btn-voltar" aria-label="Voltar">←</button>
      <div>
        <div class="marca">Produtos</div>
        <div class="filial-atual">${esc(filialAtual.nome)}</div>
      </div>
    </div>
    <div class="conteudo-app">
      ${produtos.length === 0
        ? `<div class="mensagem-vazia">Nenhum produto disponível para esta unidade.</div>`
        : `<div class="grade-produtos">${cards}</div>`}

      <div id="carrinho-flutuante" style="${totalItens === 0 ? 'display:none;' : ''}position:fixed; bottom:0; left:0; right:0; background:var(--bg-card); border-top:1px solid var(--border); padding:0.75rem 1.25rem; display:flex; justify-content:space-between; align-items:center; z-index:30;">
        <div>
          <strong style="font-size:0.9rem;">🛒 ${totalItens} itens</strong>
          <span style="margin-left:0.75rem; font-weight:700;">${formatPrecoFilial(totalPreco, filialAtual)}</span>
        </div>
        <button class="botao-app botao-app-acento" id="btn-abrir-carrinho" style="width:auto; padding:0.5rem 1.2rem; font-size:0.9rem;">
          Ver carrinho
        </button>
      </div>
    </div>
  `;

  rootElement.querySelector('#btn-voltar').addEventListener('click', aoVoltarCallback);

  rootElement.querySelectorAll('.btn-adicionar').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const nome = btn.dataset.nome;
      const preco = Number(btn.dataset.preco);
      const existe = carrinho.find((i) => i.id === id);
      if (existe) {
        existe.quantidade += 1;
      } else {
        carrinho.push({ id, nome, preco, quantidade: 1 });
      }
      renderLoja(produtos);
    });
  });

  const btnCarrinho = rootElement.querySelector('#btn-abrir-carrinho');
  if (btnCarrinho) {
    btnCarrinho.addEventListener('click', abrirModalCarrinho);
  }
}

function abrirModalCarrinho() {
  if (carrinho.length === 0) return;

  const total = carrinho.reduce((acc, i) => acc + i.preco * i.quantidade, 0);

  const html = `
    <div style="background:var(--bg-card); border-radius:var(--radius); padding:1.5rem;">
      <h2 style="margin-bottom:0.5rem;">🛒 Seu carrinho</h2>
      <div style="max-height:300px; overflow-y:auto; margin:1rem 0;">
        ${carrinho.map((item, idx) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--border);">
            <span><strong>${esc(item.nome)}</strong> × ${item.quantidade}</span>
            <span style="font-weight:700;">${formatPrecoFilial(item.preco * item.quantidade, filialAtual)}</span>
            <button class="btn-remover-item" data-idx="${idx}" style="background:none; border:none; color:var(--danger); font-size:1.2rem; cursor:pointer; padding:0 0.5rem;">✕</button>
          </div>
        `).join('')}
      </div>
      <div style="display:flex; justify-content:space-between; font-size:1.2rem; font-weight:700; padding:0.5rem 0; border-top:2px solid var(--border);">
        <span>Total</span>
        <span>${formatPrecoFilial(total, filialAtual)}</span>
      </div>
      <div style="display:flex; gap:0.5rem; margin-top:1rem;">
        <button class="botao-app botao-app-acento" id="btn-finalizar-compra" style="flex:1;">Finalizar compra</button>
        <button class="botao-app botao-app-secundario" id="btn-fechar-carrinho" style="flex:0 0 auto;">Fechar</button>
      </div>
    </div>
  `;

  const overlay = document.createElement('div');
  overlay.className = 'overlay-modal-carrinho';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1000;
    display:flex; align-items:center; justify-content:center; padding:1rem;
  `;
  overlay.innerHTML = `<div style="max-width:500px; width:100%; max-height:90vh; overflow-y:auto;">${html}</div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-fechar-carrinho').addEventListener('click', () => overlay.remove());

  overlay.querySelectorAll('.btn-remover-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      carrinho.splice(idx, 1);
      overlay.remove();
      (async () => {
        const produtos = unwrap(await supabase.rpc('fn_loja_filial', { p_filial_id: filialAtual.id }));
        renderLoja(produtos);
      })();
    });
  });

  overlay.querySelector('#btn-finalizar-compra').addEventListener('click', () => {
    overlay.remove();
    abrirCheckout();
  });
}

// ── Checkout ─────────────────────────────────────────────────
function abrirCheckout() {
  if (carrinho.length === 0) return;

  const total = carrinho.reduce((acc, i) => acc + i.preco * i.quantidade, 0);

  const html = `
    <div style="background:var(--bg-card); border-radius:var(--radius); padding:1.5rem; max-width:500px; width:100%; max-height:90vh; overflow-y:auto;">
      <h2 style="margin-bottom:0.5rem;">Finalizar compra</h2>
      <p class="silencioso" style="margin-bottom:1rem;">Preencha seus dados para concluir.</p>

      <div class="campo-app">
        <label for="checkout-nome">Nome completo *</label>
        <input type="text" id="checkout-nome" placeholder="Seu nome" />
      </div>

      <div class="campo-app">
        <label for="checkout-telefone">Telefone (WhatsApp) *</label>
        <div style="display:grid; grid-template-columns:100px 1fr; gap:0.5rem;">
          <select id="checkout-ddi">
            <option value="+595">+595 (PY)</option>
            <option value="+55">+55 (BR)</option>
            <option value="+54">+54 (AR)</option>
            <option value="+56">+56 (CL)</option>
            <option value="+1">+1 (US)</option>
          </select>
          <input type="tel" id="checkout-telefone" placeholder="981234567" />
        </div>
      </div>

      <div class="campo-app">
        <label for="checkout-forma-pagamento">Forma de pagamento *</label>
        <select id="checkout-forma-pagamento">
          <option value="dinheiro">Dinheiro</option>
          <option value="pix">Pix</option>
          <option value="cartao">Cartão (débito/crédito)</option>
          <option value="transferencia">Transferência</option>
        </select>
      </div>

      <div class="campo-app">
        <label for="checkout-observacao">Observação (opcional)</label>
        <textarea id="checkout-observacao" rows="2" placeholder="Algum detalhe?"></textarea>
      </div>

      <div style="display:flex; justify-content:space-between; font-size:1.2rem; font-weight:700; padding:0.5rem 0; border-top:2px solid var(--border); margin-top:0.5rem;">
        <span>Total</span>
        <span>${formatPrecoFilial(total, filialAtual)}</span>
      </div>

      <div style="display:flex; gap:0.5rem; margin-top:1rem;">
        <button class="botao-app botao-app-acento" id="btn-confirmar-pedido" style="flex:1;">Confirmar pedido</button>
        <button class="botao-app botao-app-secundario" id="btn-fechar-checkout">Voltar</button>
      </div>
    </div>
  `;

  const overlay = document.createElement('div');
  overlay.className = 'overlay-checkout';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1001;
    display:flex; align-items:center; justify-content:center; padding:1rem;
  `;
  overlay.innerHTML = `<div style="max-width:500px; width:100%;">${html}</div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-fechar-checkout').addEventListener('click', () => overlay.remove());

  // ── Botão confirmar pedido ──────────────────────────────
  overlay.querySelector('#btn-confirmar-pedido').addEventListener('click', async () => {
    const nome = overlay.querySelector('#checkout-nome').value.trim();
    const ddi = overlay.querySelector('#checkout-ddi').value;
    const telefone = overlay.querySelector('#checkout-telefone').value.trim().replace(/\D/g, '');
    const formaPagamento = overlay.querySelector('#checkout-forma-pagamento').value;
    const observacao = overlay.querySelector('#checkout-observacao').value.trim();

    if (!nome) {
      alert('Por favor, informe seu nome.');
      return;
    }
    if (!telefone || telefone.length < 6) {
      alert('Informe um telefone válido.');
      return;
    }

    const telefoneCompleto = ddi + telefone;

    // ── 1. Criar/recuperar cliente usando a NOVA RPC ──────
    let clienteId;
    try {
      console.log('📞 Chamando fn_criar_cliente_loja com:', {
        p_filial_id: filialAtual.id,
        p_nome: nome,
        p_telefone: telefoneCompleto
      });
      clienteId = unwrap(await supabase.rpc('fn_criar_cliente_loja', {
        p_filial_id: filialAtual.id,
        p_nome: nome,
        p_telefone: telefoneCompleto
      }));
      console.log('✅ Cliente ID:', clienteId);
    } catch (e) {
      alert('Erro ao criar/recuperar cliente: ' + e.message);
      return;
    }

    // ── 2. Montar payload para a RPC fn_registrar_venda ──
    const itensPayload = carrinho.map((i) => ({
      tipo_item: 'produto',
      produto_id: i.id,
      quantidade: i.quantidade,
      preco_unitario: i.preco,
      barbeiro_id: null,
      pacote_cliente_id: null,
    }));

    const total = carrinho.reduce((acc, i) => acc + i.preco * i.quantidade, 0);

   const payload = {
    filial_id: filialAtual.id,
    cliente_id: clienteId,
    barbeiro_id: null,
    forma_pagamento: formaPagamento,
    moeda: filialAtual.moeda_principal,
    desconto: 0,
    total: total,
    itens: itensPayload,
    // venda_pacote não é enviado
  };

    // ── 3. Chamar a RPC de venda ──────────────────────────
    const btn = overlay.querySelector('#btn-confirmar-pedido');
    btn.disabled = true;
    btn.textContent = 'Processando…';

    try {
      const vendaId = unwrap(await supabase.rpc('fn_registrar_venda', { p_payload: payload }));

      // ── 4. Sucesso ──────────────────────────────────────────

      // Monta a mensagem WhatsApp ANTES de esvaziar o carrinho
      const numeroFilial = filialAtual.telefone?.replace(/\D/g, '');
      let mensagemWhats = '';
      if (numeroFilial) {
        mensagemWhats = `🛒 *Nova venda pela Loja Online!*\n\n` +
          `👤 Cliente: ${nome}\n` +
          `📱 Telefone: ${telefoneCompleto}\n` +
          `💰 Total: ${formatPrecoFilial(total, filialAtual)}\n` +
          `💳 Pagamento: ${formaPagamento}\n` +
          `📦 Itens:\n` +
          carrinho.map(i => `  • ${i.quantidade}x ${i.nome} = ${formatPrecoFilial(i.preco * i.quantidade, filialAtual)}`).join('\n') +
          (observacao ? `\n📝 Obs: ${observacao}` : '') +
          `\n\n🔗 Acesse o painel para mais detalhes.`;
      }

      // Agora esvazia o carrinho e atualiza a UI
      overlay.remove();
      carrinho = [];
      // Reutiliza a variável 'produtos' já declarada? Não, vamos buscar novamente para atualizar a UI
      const produtosAtualizados = unwrap(await supabase.rpc('fn_loja_filial', { p_filial_id: filialAtual.id }));
      renderLoja(produtosAtualizados);

      // Abre o WhatsApp com a mensagem já montada
      if (numeroFilial && mensagemWhats) {
        window.open(`https://wa.me/${numeroFilial}?text=${encodeURIComponent(mensagemWhats)}`, '_blank');
      }

      alert('✅ Pedido realizado com sucesso! Obrigado pela preferência.');
    } catch (e) {
      alert('❌ Erro ao finalizar pedido: ' + e.message);
      btn.disabled = false;
      btn.textContent = 'Confirmar pedido';
    }
  });
}