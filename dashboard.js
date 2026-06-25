// =====================================================================
// dashboard.js — módulo "Painel" (visão geral do dia).
// =====================================================================

import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatTime, formatDateLong } from './formatters.js';
import { STATUS_AGENDAMENTO_LABELS, STATUS_AGENDAMENTO_CORES } from './constants.js';

export async function init(root, sessao, { lang, filialAtiva }) {
  const filial = filialAtiva();
  const isBarbeiro = sessao.perfil?.cargo === 'barbeiro';

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
      ${!isBarbeiro ? `
        <div class="cartao cartao-metrica">
          <p class="rotulo">${t('dash_alertas_estoque', lang)}</p>
          <p class="valor" id="metrica-alertas">—</p>
        </div>
      ` : ''}
    </div>

    <h2 class="mt-2">${t('dash_agenda_hoje', lang)}</h2>
    <div class="tabela-wrap mt-1" id="bloco-agenda"><div class="tabela-vazia">Carregando…</div></div>

    ${!isBarbeiro ? `
      <h2 class="mt-2">${t('dash_alertas_estoque', lang)}</h2>
      <div class="tabela-wrap mt-1" id="bloco-alertas"><div class="tabela-vazia">Carregando…</div></div>
    ` : ''}
  `;

  // Carrega agenda (filtrada por barbeiro se necessário)
  await carregarAgendaHoje(root, filial, lang, sessao);

  // Carrega estoque apenas se não for barbeiro
  if (!isBarbeiro) {
    await carregarAlertasEstoque(root, filial, lang);
  } else {
    // Se for barbeiro, oculta o bloco de estoque e define métrica como 0
    const metricaAlertas = root.querySelector('#metrica-alertas');
    if (metricaAlertas) metricaAlertas.textContent = '0';
  }
}

async function carregarAgendaHoje(root, filial, lang, sessao) {
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

  // Filtra por barbeiro se o usuário for barbeiro
  let query = supabase
    .from('agendamentos')
    .select('id, inicio, fim, status, clientes(nome, telefone), perfis(nome), servicos(nome), combos(nome)')
    .eq('filial_id', filial.id)
    .gte('inicio', inicioDia.toISOString())
    .lte('inicio', fimDia.toISOString())
    .order('inicio');

  if (sessao.perfil?.cargo === 'barbeiro') {
    query = query.eq('barbeiro_id', sessao.perfil.id);
  }

  const agendamentos = unwrap(await query);

  metrica.textContent = agendamentos.length;

  if (agendamentos.length === 0) {
    blocoAgenda.innerHTML = `<div class="tabela-vazia">${t('dash_sem_agendamentos', lang)}</div>`;
    return;
  }

  // Mostra apenas os 5 primeiros
  const exibir = agendamentos.slice(0, 5);

  const linhas = exibir
    .map((a) => {
      const cor = STATUS_AGENDAMENTO_CORES[a.status] || '#999';
      const servicoNome = a.servicos?.nome || a.combos?.nome || '—';
      const clienteNome = a.clientes?.nome || '—';
      return `
        <tr>
          <td class="preco">${formatTime(a.inicio, filial)}</td>
          <td>${clienteNome}</td>
          <td>${servicoNome}</td>
          <td>${a.perfis?.nome || '—'}</td>
          <td><span class="badge" style="background:${cor}22; color:${cor}">${STATUS_AGENDAMENTO_LABELS[a.status] || a.status}</span></td>
        </tr>
      `;
    })
    .join('');

  const totalExibidos = exibir.length;
  const totalRestantes = agendamentos.length - totalExibidos;

  let rodape = '';
  if (totalRestantes > 0) {
    rodape = `<div class="silencioso" style="padding:0.5rem 1rem; text-align:center; border-top:1px solid var(--line);">+ ${totalRestantes} ${totalRestantes === 1 ? 'agendamento' : 'agendamentos'} restantes</div>`;
  }

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
      ${rodape ? `<tfoot><tr><td colspan="5">${rodape}</td></tr></tfoot>` : ''}
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