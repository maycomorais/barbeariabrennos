// =====================================================================
// store.js — módulo de loja do app público (app.js).
// Catálogo público de produtos da filial (fn_loja_filial). Não há
// checkout/pagamento online no schema atual — o objetivo é o cliente
// ver o que está disponível e, se quiser, reservar via WhatsApp para
// retirar/pagar na unidade (fluxo real de PDV continua presencial).
//
// Este módulo NÃO se auto-inicializa: é chamado por index.js (SPA) via
// `iniciarLoja(root, filial, aoVoltar)`.
// =====================================================================

import { supabase, unwrap } from './supabase.js';
import { formatPrecoFilial } from './formatters.js';
import { esc } from './util.js';

/**
 * @param {HTMLElement} root
 * @param {object} filial - registro de `filiais`
 * @param {() => void} aoVoltar - chamado ao sair da loja (volta ao menu)
 */
export async function iniciarLoja(root, filial, aoVoltar) {
  root.innerHTML = `<div class="carregando">Carregando…</div>`;

  const produtos = unwrap(await supabase.rpc('fn_loja_filial', { p_filial_id: filial.id }));

  const cards = produtos
  .map((p) => `
    <div class="cartao-produto">
      ${p.foto_url ? `<img src="${esc(p.foto_url)}" alt="${esc(p.nome)}" style="width:100%; height:140px; object-fit:cover; border-radius:6px; margin-bottom:0.5rem;" />` : ''}
      <h3>${esc(p.nome)}</h3>
      <div class="descricao">${esc(p.descricao || '')}</div>
      <div class="preco">${formatPrecoFilial(p.preco_venda, filial)}</div>
      ${!p.disponivel ? `<div class="indisponivel">Esgotado</div>` : ''}
    </div>
  `)
  .join('');

  const linkWhats = filial.telefone
    ? `https://wa.me/${filial.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Vi os produtos da ${filial.nome} e gostaria de saber mais.`)}`
    : null;

  root.innerHTML = `
    <div class="topo-app">
      <button class="botao-voltar" id="btn-voltar" aria-label="Voltar">←</button>
      <div>
        <div class="marca">Produtos</div>
        <div class="filial-atual">${esc(filial.nome)}</div>
      </div>
    </div>
    <div class="conteudo-app">
      ${produtos.length === 0
        ? `<div class="mensagem-vazia">Nenhum produto disponível para esta unidade.</div>`
        : `<div class="grade-produtos">${cards}</div>`}

      ${linkWhats ? `
        <div class="barra-acao-fixa">
          <a class="botao-app botao-app-acento" href="${linkWhats}" target="_blank" rel="noopener">Falar no WhatsApp</a>
        </div>
      ` : ''}
    </div>
  `;

  root.querySelector('#btn-voltar').addEventListener('click', aoVoltar);
}
