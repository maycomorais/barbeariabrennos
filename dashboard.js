// =====================================================================
// dashboard.js — módulo "Painel" (visão geral do dia).
// Convenção de módulo do admin.js: exporta init(root, sessao, ctx) e,
// opcionalmente, retorna { destruir() {...} } se precisar limpar
// listeners/timers ao trocar de rota (este módulo não precisa).
// =====================================================================

import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatTime } from './formatters.js';
import { STATUS_AGENDAMENTO_LABELS, STATUS_AGENDAMENTO_CORES } from './constants.js';

export async function init(root, sessao, { lang, filialAtiva }) {
  const filial = filialAtiva();

  root.innerHTML = `
    <div class="cabecalho-pagina">
      <div>
        <h1>${t('dash_titulo', lang)}</h1>
        <p>${filial ? filial.nome : ''}</p>
      </div>
    </div>

    <div class="grade-cartoes">
      <div class="cartao cartao-metrica">
        <p class="rotulo">${t('dash_agenda_hoje', lang)}</p>
        <p class="valor" id="metrica-agendamentos">—</p>
      </div>
      <div class="cartao cartao-metrica">
        <p class="rotulo">${t('dash_alertas_estoque', lang)}</p>
        <p class="valor" id="metrica-alertas">—</p>
      </div>
    </div>

    <h2 class="mt-2">${t('dash_agenda_hoje', lang)}</h2>
    <div class="tabela-wrap mt-1" id="bloco-agenda"><div class="tabela-vazia">Carregando…</div></div>

    <h2 class="mt-2">${t('dash_alertas_estoque', lang)}</h2>
    <div class="tabela-wrap mt-1" id="bloco-alertas"><div class="tabela-vazia">Carregando…</div></div>
  `;

  await Promise.all([
    carregarAgendaHoje(root, filial, lang),
    carregarAlertasEstoque(root, filial, lang),
  ]);
}

async function carregarAgendaHoje(root, filial, lang) {
  const blocoAgenda = root.querySelector('#bloco-agenda');
  const metrica = root.querySelector('#metrica-agendamentos');
  if (!filial) {
    blocoAgenda.innerHTML = `<div class="tabela-vazia">${t('dash_sem_agendamentos', lang)}</div>`;
    metrica.textContent = '0';
    return;
  }

  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  const fimDia = new Date();
  fimDia.setHours(23, 59, 59, 999);

  const agendamentos = unwrap(
    await supabase
      .from('agendamentos')
      .select('id, inicio, fim, status, clientes(nome, telefone), perfis(nome), servicos(nome), combos(nome)')
      .eq('filial_id', filial.id)
      .gte('inicio', inicioDia.toISOString())
      .lte('inicio', fimDia.toISOString())
      .order('inicio')
  );

  metrica.textContent = agendamentos.length;

  if (agendamentos.length === 0) {
    blocoAgenda.innerHTML = `<div class="tabela-vazia">${t('dash_sem_agendamentos', lang)}</div>`;
    return;
  }

  const linhas = agendamentos
    .map((a) => {
      const cor = STATUS_AGENDAMENTO_CORES[a.status] || '#999';
      const servicoNome = a.servicos?.nome || a.combos?.nome || '—';
      return `
        <tr>
          <td class="preco">${formatTime(a.inicio, filial)}</td>
          <td>${a.clientes?.nome || '—'}</td>
          <td>${servicoNome}</td>
          <td>${a.perfis?.nome || '—'}</td>
          <td><span class="badge" style="background:${cor}22; color:${cor}">${STATUS_AGENDAMENTO_LABELS[a.status] || a.status}</span></td>
        </tr>
      `;
    })
    .join('');

  blocoAgenda.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>${t('agenda_inicio', lang)}</th>
          <th>${t('agenda_cliente', lang)}</th>
          <th>${t('agenda_servico', lang)}</th>
          <th>${t('agenda_barbeiro', lang)}</th>
          <th>${t('agenda_status', lang)}</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
  `;
}

async function carregarAlertasEstoque(root, filial, lang) {
  const blocoAlertas = root.querySelector('#bloco-alertas');
  const metrica = root.querySelector('#metrica-alertas');
  if (!filial) {
    blocoAlertas.innerHTML = `<div class="tabela-vazia">${t('dash_sem_alertas', lang)}</div>`;
    metrica.textContent = '0';
    return;
  }

  const alertas = unwrap(
    await supabase.from('vw_alertas_estoque').select('produto_id, nome, quantidade_atual, estoque_minimo').eq('filial_id', filial.id)
  );

  metrica.textContent = alertas.length;

  if (alertas.length === 0) {
    blocoAlertas.innerHTML = `<div class="tabela-vazia">${t('dash_sem_alertas', lang)}</div>`;
    return;
  }

  const linhas = alertas
    .map((a) => `
      <tr>
        <td>${a.nome}</td>
        <td class="preco">${a.quantidade_atual}</td>
        <td class="preco">${a.estoque_minimo}</td>
        <td><span class="badge badge-clay">Repor</span></td>
      </tr>
    `)
    .join('');

  blocoAlertas.innerHTML = `
    <table>
      <thead><tr><th>${t('campo_nome', lang)}</th><th>Atual</th><th>Mínimo</th><th></th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
  `;
}
