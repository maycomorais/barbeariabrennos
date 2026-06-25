// =====================================================================
// app.js — Roteador SPA do app público (cliente final).
// =====================================================================

import { carregarEmpresa, resolverFilialAtiva, setFilialSelecionada, limparFilialSelecionada } from './filialContext.js';
import { iniciarAgendamento } from './booking.js';
import { iniciarLoja } from './store.js';
import { esc } from './util.js';
import { supabase, unwrap } from './supabase.js';
import { NOME_PADRAO } from './config.js';
import { t, getLangByPais } from './i18n.js';


const root = document.getElementById('app-publico');

let empresaGlobal, filiaisGlobal;
let configGlobal = {}; // { logo_url, nome_restaurante, cor_primaria }
let filialAtualGlobal = null;

// ── Inicialização ──────────────────────────────────────────────
async function init() {
  root.innerHTML = `<div class="carregando">${t('app.carregando')}</div>`;

  // 1. Carrega empresa
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

  // 2. Carrega configurações da empresa (logo, nome, cor)
  await carregarConfiguracoes(empresa.id);

  // 3. Resolve filial ativa
  const { filial, filiais } = await resolverFilialAtiva();
  filiaisGlobal = filiais;
  filialAtualGlobal = filial;

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

// ── Carregar configurações ────────────────────────────────────
async function carregarConfiguracoes(empresaId) {
  try {
    const { data } = await supabase
      .from('configuracoes')
      .select('logo_url, nome_restaurante, cor_primaria')
      .eq('empresa_id', empresaId)
      .maybeSingle();
    if (data) {
      configGlobal = data;
      if (data.cor_primaria) {
        document.documentElement.style.setProperty('--accent-gold', data.cor_primaria);
      }
    }
  } catch (e) {
    console.warn('Erro ao carregar configurações:', e);
  }
}

// ── Seleção de filial ─────────────────────────────────────────
function renderSelecaoFilial() {
  const lang = getLangByPais(filiaisGlobal[0]?.pais) || 'pt';
  const cards = filiaisGlobal
    .map((f) => `
      <div class="card-select filial-card" data-id="${f.id}">
        <div class="info">
          <div class="title">${esc(f.nome)}</div>
          ${f.endereco ? `<div class="sub">${esc(f.endereco)}</div>` : ''}
        </div>
        <div class="badge">${t('app.selecionar', lang)}</div>
      </div>
    `)
    .join('');

  root.innerHTML = `
    <header class="app-header">
      <div class="logo-area">
        ${configGlobal.logo_url ? `<img src="${configGlobal.logo_url}" alt="Logo" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" />` : `<div class="logo-icon">💈</div>`}
        <div>
          <div class="brand">${esc(empresaGlobal.nome)}</div>
          <div class="brand-sub">${t('app.escolher_filial', lang)}</div>
        </div>
      </div>
    </header>
    <div class="app-content" style="padding-top:30px;">
      <h1 style="font-family:var(--font-display);font-weight:700;font-size:1.4rem;margin-bottom:8px;">${t('app.escolher_filial', lang)}</h1>
      <p class="subtitle" style="margin-bottom:24px;">${t('app.selecionar_unidade', lang)}</p>
      <div class="service-list">${cards}</div>
    </div>
  `;

  root.querySelectorAll('.filial-card').forEach(card => {
    card.addEventListener('click', () => {
      const filial = filiaisGlobal.find(f => f.id === card.dataset.id);
      setFilialSelecionada(filial.id);
      filialAtualGlobal = filial;
      renderMenu(filial);
    });
  });
}

// ── Função auxiliar para obter idioma ────────────────────────
function getLang() {
  return filialAtualGlobal ? getLangByPais(filialAtualGlobal.pais) : 'pt';
}

// ── Menu principal ─────────────────────────────────────────────
function renderMenu(filial) {
  filialAtualGlobal = filial;
  const podeTrocar = filiaisGlobal.length > 1;
  const lang = getLangByPais(filial.pais) || 'pt';

  root.innerHTML = `
    <header class="app-header">
      <div class="logo-area">
        ${configGlobal.logo_url ? `<img src="${configGlobal.logo_url}" alt="Logo" style="width:44px;height:44px;border-radius:50%;object-fit:cover;" />` : `<div class="logo-icon">💈</div>`}
        <div>
          <div class="brand">${esc(empresaGlobal.nome)}</div>
          <div class="brand-sub">${esc(filial.nome)}</div>
        </div>
      </div>
      <div class="header-actions">
        ${podeTrocar ? `
          <button id="btn-trocar-filial" class="btn-trocar-filial" title="${t('app.trocar_filial', lang)}">
            📍 ${t('app.trocar_filial', lang)}
          </button>
        ` : ''}
        <button id="btn-perfil" title="${t('app.perfil', lang)}">👤</button>
      </div>
    </header>

    <div class="app-tabs">
      <button data-tab="agendar" class="active">${t('app.agendar', lang)}</button>
      <button data-tab="loja">${t('app.loja', lang)}</button>
      <button data-tab="perfil">${t('app.perfil', lang)}</button>
    </div>

    <div class="app-content" id="app-content"></div>
  `;

  // ── Carregar a aba ativa (Agendar por padrão) ──
  const content = root.querySelector('#app-content');
  iniciarAgendamento(content, filial, () => renderMenu(filial));

  // ── Eventos de navegação por tabs ──
  root.querySelectorAll('.app-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.app-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      if (tab === 'agendar') {
        iniciarAgendamento(content, filial, () => renderMenu(filial));
      } else if (tab === 'loja') {
        iniciarLoja(content, filial, () => renderMenu(filial));
      } else if (tab === 'perfil') {
        content.innerHTML = `
          <div class="card-select">
            <div class="info">
              <div class="title">${t('app.perfil', lang)}</div>
              <div class="sub">${t('app.em_breve') || 'Em breve'}</div>
            </div>
          </div>
        `;
      }
    });
  });

  // ── Trocar filial ──
  root.querySelector('#btn-trocar-filial')?.addEventListener('click', () => {
    limparFilialSelecionada();
    renderSelecaoFilial();
  });
}

// ── Iniciar ──
init();