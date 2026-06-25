// =====================================================================
// minhas-financas.js — Módulo "Minhas Finanças" para barbeiros.
// Mostra apenas as comissões do profissional logado, com gráficos e histórico.
// =====================================================================

import { esc } from './util.js';
import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatPrecoFilial, formatDateTime } from './formatters.js';

let sessao, lang, filial, raiz;
let periodo = 'mes'; // 'hoje' | 'semana' | 'mes'
let chartInstance = null;

export async function init(root, sessaoAtual, ctx) {
  raiz = root;
  sessao = sessaoAtual;
  filial = ctx.filialAtiva();
  lang = ctx.lang;

  // Verifica se o usuário é barbeiro (ou tem perfil para ver)
  if (sessao.perfil.cargo !== 'barbeiro' && sessao.perfil.cargo !== 'proprietario') {
    raiz.innerHTML = `
      <div class="cabecalho-pagina"><h1>Minhas Finanças</h1></div>
      <div class="cartao">
        <p>Este módulo é exclusivo para profissionais (barbeiros).</p>
      </div>
    `;
    return;
  }

  raiz.innerHTML = `
    <div class="cabecalho-pagina">
      <h1>💼 Minhas Finanças</h1>
      <p style="color:var(--text-muted);">${esc(sessao.perfil.nome)}</p>
    </div>
    <div id="minhas-financas-conteudo"></div>
  `;

  await renderizar();
}

async function renderizar() {
  const container = raiz.querySelector('#minhas-financas-conteudo');
  container.innerHTML = `<div class="tabela-vazia">Carregando…</div>`;

  const { inicio, fim } = intervaloPeriodo(periodo);
  const perfilId = sessao.perfil.id;

  // 1. Busca todas as comissões do barbeiro no período
  const { data: lancamentos, error } = await supabase
    .from('lancamentos_financeiros')
    .select(`
      id,
      valor,
      data_lancamento,
      created_at,
      venda_id,
      vendas(
        id,
        created_at,
        cliente_id,
        clientes(nome),
        total
      )
    `)
    .eq('filial_id', filial.id)
    .eq('perfil_id', perfilId)
    .eq('tipo', 'comissao')
    .gte('data_lancamento', inicio.toISOString().slice(0, 10))
    .lte('data_lancamento', fim.toISOString().slice(0, 10))
    .order('data_lancamento', { ascending: false });

  if (error) {
    container.innerHTML = `<div class="mensagem-erro">Erro: ${error.message}</div>`;
    return;
  }

  if (!lancamentos || lancamentos.length === 0) {
    container.innerHTML = `
      <div class="tabela-vazia">Nenhuma comissão registrada neste período.</div>
      <div style="margin-top:12px;">
        <button class="botao botao-secundario" onclick="periodo='mes'; renderizar();">Ver mês atual</button>
      </div>
    `;
    return;
  }

  // 2. Cálculo dos totais
  const totalComissao = lancamentos.reduce((acc, l) => acc + Number(l.valor), 0);
  const qtdVendas = lancamentos.length;
  const ticketMedio = qtdVendas > 0 ? totalComissao / qtdVendas : 0;

  // 3. Agrupa por dia para o gráfico
  const porDia = {};
  lancamentos.forEach((l) => {
    const dia = l.data_lancamento || l.created_at?.slice(0, 10);
    if (!dia) return;
    porDia[dia] = (porDia[dia] || 0) + Number(l.valor);
  });
  const diasOrdenados = Object.keys(porDia).sort();
  const valores = diasOrdenados.map((d) => porDia[d]);

  // 4. Monta HTML
  container.innerHTML = `
    <!-- Filtros de período -->
    <div class="flex-entre mt-1">
      <div class="tabs-inline" id="tabs-periodo-minhas-financas">
        <button data-periodo="hoje" class="${periodo === 'hoje' ? 'ativo' : ''}">${t('fin_periodo_hoje', lang)}</button>
        <button data-periodo="semana" class="${periodo === 'semana' ? 'ativo' : ''}">${t('fin_periodo_semana', lang)}</button>
        <button data-periodo="mes" class="${periodo === 'mes' ? 'ativo' : ''}">${t('fin_periodo_mes', lang)}</button>
      </div>
    </div>

    <!-- Cards de resumo -->
    <div class="grade-cartoes mt-1">
      <div class="cartao cartao-metrica">
        <p class="rotulo">Total de Comissões</p>
        <p class="valor" style="color:var(--brass);">${formatPrecoFilial(totalComissao, filial)}</p>
      </div>
      <div class="cartao cartao-metrica">
        <p class="rotulo">Atendimentos</p>
        <p class="valor">${qtdVendas}</p>
      </div>
      <div class="cartao cartao-metrica">
        <p class="rotulo">Ticket Médio por Atendimento</p>
        <p class="valor">${formatPrecoFilial(ticketMedio, filial)}</p>
      </div>
    </div>

    <!-- Gráfico -->
    <div class="cartao mt-1" style="padding:12px;">
      <h3 style="margin-bottom:8px;">📊 Comissões por Dia</h3>
      <div style="position:relative; height:200px;">
        <canvas id="grafico-minhas-financas"></canvas>
      </div>
    </div>

    <!-- Histórico -->
    <div class="tabela-wrap mt-1">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Cliente</th>
            <th>Valor da Venda</th>
            <th>Comissão</th>
          </tr>
        </thead>
        <tbody>
          ${lancamentos.map((l) => `
            <tr>
              <td>${formatDateTime(l.created_at || l.data_lancamento, filial)}</td>
              <td>${esc(l.vendas?.clientes?.nome || 'Cliente não identificado')}</td>
              <td class="preco">${formatPrecoFilial(l.vendas?.total || 0, filial)}</td>
              <td class="preco" style="font-weight:700; color:var(--brass);">${formatPrecoFilial(l.valor, filial)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700; background:var(--sage-tint);">
            <td colspan="3">Total</td>
            <td>${formatPrecoFilial(totalComissao, filial)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  // 5. Renderizar gráfico
  if (diasOrdenados.length > 0) {
    renderGrafico(diasOrdenados, valores);
  }

  // 6. Eventos dos botões de período
  container.querySelectorAll('#tabs-periodo-minhas-financas button').forEach((btn) => {
    btn.addEventListener('click', () => {
      periodo = btn.dataset.periodo;
      renderizar();
    });
  });
}

function intervaloPeriodo(periodo) {
  const fim = new Date();
  fim.setHours(23, 59, 59, 999);
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  if (periodo === 'semana') inicio.setDate(inicio.getDate() - 6);
  if (periodo === 'mes') inicio.setDate(1);
  return { inicio, fim };
}

function renderGrafico(labels, data) {
  const canvas = document.getElementById('grafico-minhas-financas');
  if (!canvas) return;

  // Verifica se Chart está disponível
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js não carregado. Tentando carregar...');
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.onload = () => {
      // Tenta renderizar novamente após o carregamento
      renderGrafico(labels, data);
    };
    script.onerror = () => {
      console.error('Falha ao carregar Chart.js. Gráfico não disponível.');
      document.getElementById('grafico-minhas-financas').parentElement.innerHTML = 
        '<div style="text-align:center; color:var(--text-muted); padding:20px;">📊 Gráfico indisponível no momento</div>';
    };
    document.head.appendChild(script);
    return;
  }

  // Destroi gráfico anterior
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  const ctx = canvas.getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Comissão (Gs)',
        data: data,
        backgroundColor: 'rgba(200, 146, 58, 0.6)',
        borderColor: '#C8923A',
        borderWidth: 2,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return 'Gs ' + context.parsed.y.toLocaleString('es-PY');
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return 'Gs ' + (value / 1000).toFixed(0) + 'k';
            }
          }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}