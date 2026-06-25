// =====================================================================
// booking.js — módulo de agendamento do app público (app.js).
// Wizard de autoatendimento: serviço → profissional → data/hora →
// dados do cliente → confirmação. Os horários disponíveis são calculados
// no front-end a partir de fn_horario_funcionamento + fn_horarios_ocupados
// (ambas security definer, escopadas por filial). A criação efetiva do
// agendamento passa pela Edge Function `criar-agendamento-publico`
// (service role), que reaproveita o trigger de conflito do schema.
//
// Este módulo NÃO se auto-inicializa: é chamado por index.js (SPA) via
// `iniciarAgendamento(root, filial, aoVoltar)`, que renderiza dentro do
// elemento `root` e chama `aoVoltar()` para retornar ao menu principal.
// =====================================================================

import { supabase, unwrap } from './supabase.js';
import { formatPrecoFilial, zonedTimeToUtc, hojeNaZona, adicionarDiasISO, diaSemanaISO } from './formatters.js';
import { DDI_LATAM, DDI_PADRAO_POR_PAIS, diasSemanaAbrev } from './constants.js';
import { esc } from './util.js';

const DIAS_VISIVEIS = 14;
const SLOT_STEP_MINUTOS = 30;
const BUFFER_MINUTOS = 20; // não permite reservar em cima da hora atual

let raiz, filial, aoVoltarMenu, servicos, barbeiros;
let passoAtual = 1;
const TOTAL_PASSOS = 5;

let estado;

function estadoInicial() {
  return {
    servico: null,
    barbeiro: null,
    dataISO: null,
    horaSlot: null,
    nome: '',
    ddi: '+595',
    telefone: '',
  };
}

/**
 * Inicia (ou reinicia) o wizard de agendamento dentro de `root`.
 * @param {HTMLElement} root
 * @param {object} filialAtual - registro de `filiais`
 * @param {() => void} aoVoltar - chamado ao sair do wizard (volta ao menu)
 */
export async function iniciarAgendamento(root, filialAtual, aoVoltar) {
  raiz = root;
  filial = filialAtual;
  aoVoltarMenu = aoVoltar;
  passoAtual = 1;
  estado = estadoInicial();

  raiz.innerHTML = `<div class="carregando">Carregando…</div>`;

  estado.ddi = DDI_PADRAO_POR_PAIS[filial.pais] || '+595';
  estado.dataISO = hojeNaZona(filial.timezone);

  [servicos, barbeiros] = await Promise.all([
    chamarFuncao('fn_servicos_filial', { p_filial_id: filial.id }),
    chamarFuncao('fn_barbeiros_filial', { p_filial_id: filial.id }),
  ]);

  if (servicos.length === 0 || barbeiros.length === 0) {
    raiz.innerHTML = `
      ${renderTopo()}
      <div class="conteudo-app">
        <div class="mensagem-vazia">Agendamento online indisponível para esta unidade no momento. Entre em contato diretamente.</div>
      </div>
    `;
    return;
  }

  render();
}

async function chamarFuncao(nome, params) {
  return unwrap(await supabase.rpc(nome, params));
}

function renderTopo() {
  return `
    <div class="topo-app">
      <button class="botao-voltar" id="btn-voltar" aria-label="Voltar">←</button>
      <div>
        <div class="marca">Agendar</div>
        <div class="filial-atual">${esc(filial.nome)}</div>
      </div>
    </div>
  `;
}

function renderIndicadorPassos() {
  let html = `<div class="passos-indicador">`;
  for (let i = 1; i <= TOTAL_PASSOS; i++) {
    const classe = i < passoAtual ? 'concluido' : i === passoAtual ? 'ativo' : '';
    html += `<div class="passo ${classe}"></div>`;
  }
  html += `</div>`;
  return html;
}

function render() {
  raiz.innerHTML = `${renderTopo()}<div class="conteudo-app">${renderStepper()}${renderIndicadorPassos()}<div id="passo-conteudo"></div></div>`;

  const btnVoltar = document.getElementById('btn-voltar');
  if (btnVoltar) btnVoltar.addEventListener('click', voltar);

  const container = document.getElementById('passo-conteudo');
  if (passoAtual === 1) renderPassoServico(container);
  else if (passoAtual === 2) renderPassoBarbeiro(container);
  else if (passoAtual === 3) renderPassoDataHora(container);
  else if (passoAtual === 4) renderPassoCliente(container);
  else if (passoAtual === 5) renderPassoConfirmacao(container);
}

function avancar() {
  passoAtual = Math.min(passoAtual + 1, TOTAL_PASSOS);
  render();
}

function voltar() {
  if (passoAtual === 1) {
    aoVoltarMenu();
    return;
  }
  passoAtual = Math.max(passoAtual - 1, 1);
  render();
}

// =====================================================================
// PASSO 1 — SERVIÇO
// =====================================================================

function renderPassoServico(container) {
  container.innerHTML = `
    <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:12px;">Qual serviço você quer?</h2>
    <div class="service-list">
      ${servicos.map((s) => `
        <div class="card-select" data-id="${s.id}">
          <div class="info">
            <div class="title">${esc(s.nome)}</div>
            <div class="sub">${s.duracao_minutos} min</div>
          </div>
          <div class="price">${formatPrecoFilial(s.preco, filial)}</div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.card-select').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      estado.servico = servicos.find((s) => s.id === id);
      estado.horaSlot = null;
      avancar();
    });
  });
}

// =====================================================================
// PASSO 2 — BARBEIRO
// =====================================================================

function renderPassoBarbeiro(container) {
  container.innerHTML = `
    <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:12px;">Com qual profissional?</h2>
    <div class="service-list">
      ${barbeiros.map((b) => `
        <div class="card-select" data-id="${b.id}">
          <div class="info">
            <div class="title">${esc(b.nome)}</div>
            <div class="sub">${b.foto_url ? '⭐' : '✂️'}</div>
          </div>
          <div class="badge">Selecionar</div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.card-select').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      estado.barbeiro = barbeiros.find((b) => b.id === id);
      estado.horaSlot = null;
      avancar();
    });
  });
}

function iniciais(nome) {
  return nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

// =====================================================================
// PASSO 3 — DATA E HORA
// =====================================================================

async function renderPassoDataHora(container) {
  container.innerHTML = `
    <h2 style="font-family:var(--font-display);font-size:1.2rem;margin-bottom:12px;">Escolha o dia e o horário</h2>
    <div class="dias-scroll mt-1" id="dias-scroll"></div>
    <div id="area-horarios"></div>
    <div style="margin-top:20px;">
      <button class="btn-primary" id="btn-continuar" disabled>Continuar</button>
    </div>
  `;

  renderChipsDias(container);
  await renderHorariosDoDia(container);

  document.getElementById('btn-continuar').addEventListener('click', () => {
    if (estado.horaSlot) avancar();
  });
}

function renderChipsDias(container) {
  const hoje = hojeNaZona(filial.timezone);
  const lang = filial.pais === 'PY' ? 'es' : 'pt';
  const nomesDias = diasSemanaAbrev(lang);

  let html = '';
  for (let i = 0; i < DIAS_VISIVEIS; i++) {
    const dataISO = adicionarDiasISO(hoje, i);
    const diaSemana = diaSemanaISO(dataISO);
    const [, , dia] = dataISO.split('-');
    html += `
      <button class="chip-dia ${dataISO === estado.dataISO ? 'active' : ''}" data-data="${dataISO}">
        <div style="font-size:0.7rem;opacity:0.7;">${i === 0 ? (lang === 'es' ? 'Hoy' : 'Hoje') : nomesDias[diaSemana]}</div>
        <div style="font-size:1rem;font-weight:700;">${dia}</div>
      </button>
    `;
  }

  const scroll = container.querySelector('#dias-scroll');
  scroll.innerHTML = html;
  scroll.querySelectorAll('.chip-dia').forEach((chip) => {
    chip.addEventListener('click', async () => {
      estado.dataISO = chip.dataset.data;
      estado.horaSlot = null;
      scroll.querySelectorAll('.chip-dia').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      document.getElementById('btn-continuar').disabled = true;
      await renderHorariosDoDia(container);
    });
  });
}

async function renderHorariosDoDia(container) {
  const area = container.querySelector('#area-horarios');
  area.innerHTML = `<div class="carregando">Buscando horários…</div>`;

  const diaSemana = diaSemanaISO(estado.dataISO);
  const horarioFuncionamento = await chamarFuncao('fn_horario_funcionamento', {
    p_filial_id: filial.id,
    p_dia_semana: diaSemana,
  });

  if (horarioFuncionamento.length === 0) {
    area.innerHTML = `<div class="mensagem-vazia">Fechado neste dia. Escolha outra data.</div>`;
    return;
  }

  const { abre, fecha } = horarioFuncionamento[0];

  const inicioDiaUTC = zonedTimeToUtc(estado.dataISO, '00:00', filial.timezone);
  const fimDiaUTC = zonedTimeToUtc(adicionarDiasISO(estado.dataISO, 1), '00:00', filial.timezone);

  const ocupados = await chamarFuncao('fn_horarios_ocupados', {
    p_filial_id: filial.id,
    p_barbeiro_id: estado.barbeiro.id,
    p_inicio: inicioDiaUTC.toISOString(),
    p_fim: fimDiaUTC.toISOString(),
  });

  const slots = gerarSlots({
    dataISO: estado.dataISO,
    abre,
    fecha,
    duracaoMinutos: estado.servico.duracao_minutos,
    timezone: filial.timezone,
    ocupados,
    agora: new Date(),
  });

  if (slots.length === 0) {
    area.innerHTML = `<div class="mensagem-vazia">Nenhum horário livre neste dia. Escolha outra data.</div>`;
    return;
  }

  area.innerHTML = `<div class="grade-horarios mt-1">${slots.map((s) => `
    <button class="slot-horario ${estado.horaSlot === s ? 'selected' : ''}" data-hora="${s}">${s}</button>
  `).join('')}</div>`;

  area.querySelectorAll('.slot-horario').forEach((btn) => {
    btn.addEventListener('click', () => {
      estado.horaSlot = btn.dataset.hora;
      area.querySelectorAll('.slot-horario').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('btn-continuar').disabled = false;
    });
  });
}

/**
 * Gera os horários (strings "HH:MM", hora local da filial) disponíveis
 * para o dia/serviço/profissional escolhidos.
 *
 * @param {object} params
 * @param {string} params.dataISO - "YYYY-MM-DD"
 * @param {string} params.abre - "HH:MM:SS" (retorno do Postgres `time`)
 * @param {string} params.fecha - "HH:MM:SS"
 * @param {number} params.duracaoMinutos
 * @param {string} params.timezone
 * @param {{inicio:string, fim:string}[]} params.ocupados - ISO timestamps (UTC)
 * @param {Date} params.agora
 * @returns {string[]} horários "HH:MM" disponíveis, em ordem
 */
export function gerarSlots({ dataISO, abre, fecha, duracaoMinutos, timezone, ocupados, agora }) {
  const [abreH, abreM] = abre.split(':').map(Number);
  const [fechaH, fechaM] = fecha.split(':').map(Number);
  const minutoAbre = abreH * 60 + abreM;
  const minutoFecha = fechaH * 60 + fechaM;

  const ocupadosParsed = ocupados.map((o) => ({ inicio: new Date(o.inicio), fim: new Date(o.fim) }));
  const limiteMin = new Date(agora.getTime() + BUFFER_MINUTOS * 60000);

  const slots = [];
  for (let m = minutoAbre; m + duracaoMinutos <= minutoFecha; m += SLOT_STEP_MINUTOS) {
    const horaStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const inicioUTC = zonedTimeToUtc(dataISO, horaStr, timezone);
    const fimUTC = new Date(inicioUTC.getTime() + duracaoMinutos * 60000);

    if (inicioUTC < limiteMin) continue;

    const conflita = ocupadosParsed.some((o) => inicioUTC < o.fim && fimUTC > o.inicio);
    if (conflita) continue;

    slots.push(horaStr);
  }

  return slots;
}

// =====================================================================
// PASSO 4 — DADOS DO CLIENTE
// =====================================================================

function renderPassoCliente(container) {
  const opcoesDDI = DDI_LATAM.map((d) => `<option value="${d.ddi}" ${d.ddi === estado.ddi ? 'selected' : ''}>${esc(d.label)}</option>`).join('');

  container.innerHTML = `
    <h2>Seus dados</h2>
    <div class="field">
      <label>Nome completo</label>
      <input type="text" id="campo-nome" placeholder="Como podemos te chamar?" />
    </div>
    <div class="field">
      <label>WhatsApp</label>
      <div style="display:flex;gap:8px">
        <select id="campo-ddi" style="flex:0 0 100px;">${opcoesDDI}</select>
        <input type="tel" id="campo-telefone" placeholder="981234567" style="flex:1" />
      </div>
    </div>
    <div class="field">
      <label>Data de nascimento (opcional)</label>
      <input type="date" id="campo-nascimento" />
    </div>
    <button class="btn-primary" id="btn-continuar">Continuar</button>
  `;

  document.getElementById('btn-continuar').addEventListener('click', () => {
    const nome = document.getElementById('campo-nome').value.trim();
    const ddi = document.getElementById('campo-ddi').value;
    const telefone = document.getElementById('campo-telefone').value.trim().replace(/\D/g, '');
    const nascimento = document.getElementById('campo-nascimento').value || null;
    const erroEl = document.getElementById('erro-cliente');

    if (!nome) {
      erroEl.textContent = 'Por favor, informe seu nome.';
      erroEl.classList.remove('oculto');
      return;
    }
    if (!telefone || telefone.length < 6) {
      erroEl.textContent = 'Informe um telefone válido com DDD.';
      erroEl.classList.remove('oculto');
      return;
    }

    estado.nome = nome;
    estado.ddi = ddi;
    estado.telefone = telefone;
    estado.nascimento = nascimento;
    avancar();
  });
}

// =====================================================================
// PASSO 5 — CONFIRMAÇÃO
// =====================================================================

function renderPassoConfirmacao(container) {
  const dataFormatada = formatarDataResumo(estado.dataISO, filial);
  const telefoneCompleto = `${estado.ddi}${estado.telefone}`;

  container.innerHTML = `
    <h2>Confira e confirme</h2>
    <div class="resumo-card">
      ${[
        ['Unidade', filial.nome],
        ['Serviço', estado.servico.nome],
        ['Profissional', estado.barbeiro.nome],
        ['Data', dataFormatada],
        ['Horário', estado.horaSlot],
        ['Valor', formatPrecoFilial(estado.servico.preco, filial)],
        ['Cliente', estado.nome],
        ['Telefone', telefoneCompleto],
      ].map(([label, value]) => `
        <div class="resumo-linha">
          <span class="rotulo">${label}</span>
          <span class="valor">${esc(value)}</span>
        </div>
      `).join('')}
    </div>
    <div id="erro-confirmacao" class="mensagem-erro oculto"></div>
    <button class="btn-primary" id="btn-confirmar">Confirmar agendamento</button>
  `;

  document.getElementById('btn-confirmar').addEventListener('click', confirmarAgendamento);
}

async function confirmarAgendamento() {
  const botao = document.getElementById('btn-confirmar');
  const erroEl = document.getElementById('erro-confirmacao');
  erroEl.classList.add('oculto');
  botao.disabled = true;
  botao.textContent = 'Agendando…';

  const inicioUTC = zonedTimeToUtc(estado.dataISO, estado.horaSlot, filial.timezone);

  try {
    // ── Chamada direta à RPC (sem Edge Function) ──
    const agendamentoId = unwrap(await supabase.rpc('fn_criar_agendamento', {
      p_filial_id: filial.id,
      p_servico_id: estado.servico.id,
      p_barbeiro_id: estado.barbeiro.id,
      p_inicio: inicioUTC.toISOString(),
      p_nome: estado.nome,
      p_telefone: `${estado.ddi}${estado.telefone}`,
      p_data_nascimento: estado.nascimento || null,
    }));

    console.log('✅ Agendamento criado com ID:', agendamentoId);
    renderSucesso();
  } catch (e) {
    const mensagem = e.message || 'Não foi possível concluir o agendamento.';
    if (mensagem.includes('Conflito') || mensagem.includes('Horário bloqueado')) {
      erroEl.textContent = 'Esse horário acabou de ficar indisponível. Volte e escolha outro horário.';
    } else {
      erroEl.textContent = mensagem;
    }
    erroEl.classList.remove('oculto');
    botao.disabled = false;
    botao.textContent = 'Confirmar agendamento';
  }
}

function renderSucesso() {
  const dataFormatada = formatarDataResumo(estado.dataISO, filial);
  const telefoneFilial = filial.telefone ? filial.telefone.replace(/\D/g, '') : null;

  // Mensagem para a barbearia (será usada no WhatsApp)
  const mensagemWhats = `📅 *Novo agendamento via App!*\n\n` +
    `👤 Cliente: ${estado.nome}\n` +
    `📱 Telefone: ${estado.ddi}${estado.telefone}\n` +
    `✂️ Serviço: ${estado.servico.nome}\n` +
    `💈 Profissional: ${estado.barbeiro.nome}\n` +
    `📆 Data: ${dataFormatada}\n` +
    `⏰ Horário: ${estado.horaSlot}\n` +
    `📍 Filial: ${filial.nome}\n` +
    (estado.nascimento ? `🎂 Aniversário: ${estado.nascimento}\n` : '') +
    `\n🔗 Para confirmar, acesse o painel administrativo.`;

  raiz.innerHTML = `
    <div class="topo-app" style="border-bottom: none; padding-bottom: 8px;">
      <span class="listra" style="background: var(--accent-gold);"></span>
      <div>
        <div class="marca">Agendar</div>
        <div class="filial-atual">${esc(filial.nome)}</div>
      </div>
    </div>
    <div class="conteudo-app" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; padding-top: 20px;">
      <div style="width: 80px; height: 80px; border-radius: 50%; background: var(--accent-gold); display: flex; align-items: center; justify-content: center; font-size: 40px; color: #0B0B0B; margin-bottom: 20px; box-shadow: 0 8px 30px rgba(200, 146, 58, 0.3);">
        ✓
      </div>
      <h2 style="font-family: var(--font-display); font-size: 1.6rem; margin-bottom: 4px; text-align: center;">Agendamento confirmado!</h2>
      <p style="color: var(--text-secondary); text-align: center; margin-bottom: 20px;">Seu horário foi reservado com sucesso.</p>

      <div class="resumo-card" style="width: 100%; max-width: 400px; margin: 0 auto 20px;">
        <div class="resumo-linha"><span class="rotulo">Serviço</span><span class="valor">${esc(estado.servico.nome)}</span></div>
        <div class="resumo-linha"><span class="rotulo">Profissional</span><span class="valor">${esc(estado.barbeiro.nome)}</span></div>
        <div class="resumo-linha"><span class="rotulo">Data</span><span class="valor">${dataFormatada}</span></div>
        <div class="resumo-linha"><span class="rotulo">Horário</span><span class="valor">${estado.horaSlot}</span></div>
        <div class="resumo-linha"><span class="rotulo">Valor</span><span class="valor">${formatPrecoFilial(estado.servico.preco, filial)}</span></div>
        <div class="resumo-linha" style="border-bottom: none; padding-bottom: 0;"><span class="rotulo">Cliente</span><span class="valor">${esc(estado.nome)}</span></div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 400px;">
        ${telefoneFilial ? `
          <a href="https://wa.me/${telefoneFilial}?text=${encodeURIComponent(mensagemWhats)}" 
             target="_blank" 
             class="btn-primary" 
             style="text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <i class="fab fa-whatsapp"></i> Avisar barbearia via WhatsApp
          </a>
        ` : ''}
        <button class="btn-secondary" id="btn-voltar-menu" style="width: 100%;">Voltar ao início</button>
      </div>
    </div>
  `;

  document.getElementById('btn-voltar-menu').addEventListener('click', aoVoltarMenu);
}

function renderTopoSemVoltar() {
  return `
    <div class="topo-app">
      <span class="listra"></span>
      <div>
        <div class="marca">Agendar</div>
        <div class="filial-atual">${esc(filial.nome)}</div>
      </div>
    </div>
  `;
}

function formatarDataResumo(dataISO, filial) {
  const lang = filial.pais === 'PY' ? 'es-PY' : 'pt-BR';
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  return new Intl.DateTimeFormat(lang, { weekday: 'long', day: '2-digit', month: 'long' }).format(d);
}

function renderStepper() {
  const steps = ['Serviço', 'Profissional', 'Data/Hora', 'Dados', 'Confirmar'];
  return `
    <div class="stepper">
      ${steps.map((label, i) => `
        <div class="step-item ${i < passoAtual ? 'completed' : i === passoAtual ? 'active' : ''}">
          <div class="step-circle">${i < passoAtual ? '✓' : i + 1}</div>
          <div class="step-label">${label}</div>
        </div>
      `).join('')}
    </div>
  `;
}