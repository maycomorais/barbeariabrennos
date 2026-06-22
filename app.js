// =====================================================================
// app.js — Roteador SPA do app público (cliente final).
// Controlador único (SPA) do app público: seleção de filial, menu
// principal, e troca entre as "telas" Agendar / Loja sem recarregar a
// página — tudo dentro de #app-publico.
// =====================================================================

import { carregarEmpresa, resolverFilialAtiva, setFilialSelecionada, limparFilialSelecionada } from './filialContext.js';
import { iniciarAgendamento } from './booking.js';
import { iniciarLoja } from './store.js';
import { esc } from './util.js';
import { NOME_PADRAO } from './config.js';

const root = document.getElementById('app-publico');

let empresaGlobal, filiaisGlobal;

async function init() {
  root.innerHTML = `<div class="carregando">Carregando…</div>`;

  let empresa;
  try {
    empresa = await carregarEmpresa();
  } catch {
    empresa = null;
  }

  if (!empresa || empresa.ativo === false) {
    root.innerHTML = `
      <div class="topo-app"><span class="listra"></span><span class="marca">${NOME_PADRAO}</span></div>
      <div class="conteudo-app">
        <div class="mensagem-vazia">Este link de agendamento não está disponível no momento.</div>
      </div>
    `;
    return;
  }
  empresaGlobal = empresa;

  const { filial, filiais } = await resolverFilialAtiva();
  filiaisGlobal = filiais;

  if (filiais.length === 0) {
    root.innerHTML = `
      <div class="topo-app"><span class="listra"></span><span class="marca">${esc(empresa.nome)}</span></div>
      <div class="conteudo-app"><div class="mensagem-vazia">Nenhuma unidade disponível para agendamento.</div></div>
    `;
    return;
  }

  if (!filial) {
    renderSelecaoFilial();
    return;
  }

  renderMenu(filial);
}

// =====================================================================
// SELEÇÃO DE FILIAL
// =====================================================================

function renderSelecaoFilial() {
  const cards = filiaisGlobal
    .map((f) => `
      <button class="cartao-app cartao-filial" data-filial-id="${f.id}">
        <h3>${esc(f.nome)}</h3>
        ${f.endereco ? `<p class="endereco">${esc(f.endereco)}</p>` : ''}
        ${f.google_maps_url ? `<span class="link-maps">Ver no mapa</span>` : ''}
      </button>
    `)
    .join('');

  root.innerHTML = `
    <div class="topo-app">
      <span class="listra"></span>
      <span class="marca">${esc(empresaGlobal.nome)}</span>
    </div>
    <div class="conteudo-app">
      <h1>Escolha sua unidade</h1>
      <p class="silencioso mt-1">Selecione onde você quer agendar ou ver os produtos.</p>
      <div class="mt-2">${cards}</div>
    </div>
  `;

  root.querySelectorAll('.cartao-filial').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = filiaisGlobal.find((x) => x.id === btn.dataset.filialId);
      setFilialSelecionada(f.id);
      renderMenu(f);
    });
  });
}

// =====================================================================
// MENU PRINCIPAL
// =====================================================================

function renderMenu(filial) {
  const podeTrocar = filiaisGlobal.length > 1;

  root.innerHTML = `
    <div class="topo-app">
      <span class="listra"></span>
      <div>
        <div class="marca">${esc(empresaGlobal.nome)}</div>
        <div class="filial-atual">${esc(filial.nome)}</div>
      </div>
    </div>
    <div class="conteudo-app">
      <div class="cartao-app">
        <h3>${esc(filial.nome)}</h3>
        ${filial.endereco ? `<p class="endereco">${esc(filial.endereco)}</p>` : ''}
        <div class="mt-1" style="display:flex; gap:0.75rem; flex-wrap:wrap;">
          ${filial.google_maps_url ? `<a class="link-maps" href="${esc(filial.google_maps_url)}" target="_blank" rel="noopener">Ver no mapa</a>` : ''}
          ${filial.telefone ? `<a class="link-maps" href="tel:${esc(filial.telefone)}">${esc(filial.telefone)}</a>` : ''}
        </div>
      </div>

      <div class="menu-principal">
        <button class="botao-menu-grande" id="btn-agendar">
          <span class="icone-circulo">📅</span>
          <span>
            Agendar horário
            <div class="descricao">Escolha o serviço, o profissional e o melhor horário</div>
          </span>
        </button>
        <button class="botao-menu-grande" id="btn-loja">
          <span class="icone-circulo">🧴</span>
          <span>
            Produtos
            <div class="descricao">Veja o catálogo disponível nesta unidade</div>
          </span>
        </button>
        ${podeTrocar ? `
        <button class="botao-menu-grande" id="btn-trocar-unidade">
          <span class="icone-circulo">📍</span>
          <span>
            Trocar de unidade
            <div class="descricao">Você está vendo: ${esc(filial.nome)}</div>
          </span>
        </button>` : ''}
      </div>
    </div>
  `;

  document.getElementById('btn-agendar').addEventListener('click', () => {
    iniciarAgendamento(root, filial, () => renderMenu(filial));
  });
  document.getElementById('btn-loja').addEventListener('click', () => {
    iniciarLoja(root, filial, () => renderMenu(filial));
  });
  const btnTrocar = document.getElementById('btn-trocar-unidade');
  if (btnTrocar) {
    btnTrocar.addEventListener('click', () => {
      limparFilialSelecionada();
      renderSelecaoFilial();
    });
  }
}

init();
