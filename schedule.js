// =====================================================================
// schedule.js — módulo "Agenda" do roteador admin.js.
// Fase 2: calendário diário/semanal por barbeiro, bloqueios de horário
// e criação/edição de agendamentos. O trigger `check_conflito_agenda`
// (schema.sql) já impede sobreposição e respeita bloqueios — o front-end
// só precisa exibir o erro retornado pelo banco de forma amigável.
//
// LIMITAÇÃO CONHECIDA: sem uma lib de timezone (Luxon/date-fns-tz), o
// <input type="datetime-local"> usado para criar/editar horários é
// interpretado no timezone do NAVEGADOR. Assumimos que quem opera o
// painel está no mesmo timezone da filial (caso comum: recepção no local).
// A POSIÇÃO e o RÓTULO dos eventos na grade, por outro lado, sempre usam
// o timezone da filial (horaMinutoNaFilial / formatTime), então a leitura
// da agenda é sempre correta — a ressalva vale só para a CRIAÇÃO via input.
// =====================================================================

import { abrirModal, fecharModal } from './modal.js';
import { esc, mostrarErro } from './util.js';
import { campoTexto, campoSelect, campoTextarea, valorTexto } from './form.js';
import { supabase, unwrap } from './supabase.js';
import { t } from './i18n.js';
import { formatTime, formatDateLong, horaMinutoNaFilial } from './formatters.js';
import { STATUS_AGENDAMENTO_LABELS, STATUS_AGENDAMENTO_CORES, diasSemana } from './constants.js';

let HORA_INICIO = 8;
let HORA_FIM = 23;
const SLOT_MINUTOS = 30;
const SLOT_ALTURA_PX = 32;
let TOTAL_SLOTS = ((HORA_FIM - HORA_INICIO) * 60) / SLOT_MINUTOS;


let sessao, lang, filial, raiz;
let modo = 'dia'; // 'dia' | 'semana'
let dataReferencia = new Date();
let barbeiroSemanaId = null;
let barbeiros = [];
let servicos = [];
let modoBloqueioAtivo = false;

export async function init(root, sessaoAtual, ctx) {
  raiz = root;
  sessao = sessaoAtual;
  filial = ctx.filialAtiva();
  lang = ctx.lang;

  if (!filial) {
    raiz.innerHTML = `<div class="cabecalho-pagina"><h1>${t('agenda_titulo', lang)}</h1></div><div class="cartao">Nenhuma filial cadastrada ainda.</div>`;
    return;
  }

  [barbeiros, servicos] = await Promise.all([
    supabase.from('perfis').select('id, nome').eq('filial_id', filial.id).eq('cargo', 'barbeiro').eq('ativo', true).order('nome').then(unwrap),
    supabase.from('servicos').select('id, nome, duracao_minutos, preco').eq('ativo', true).order('nome').then(unwrap),
  ]);

  barbeiroSemanaId = sessao.perfil.cargo === 'barbeiro' ? sessao.perfil.id : barbeiros[0]?.id || null;

  // Carrega horários para o dia atual
  const horario = await buscarHorarioFilial(new Date());
  HORA_INICIO = horario.abre;
  HORA_FIM = horario.fecha;
  TOTAL_SLOTS = ((HORA_FIM - HORA_INICIO) * 60) / SLOT_MINUTOS;

  renderShell(raiz);
  await renderGrade();
}

// =====================================================================
// BUSCA HORÁRIO DA FILIAL (ASYNC)
// =====================================================================

async function buscarHorarioFilial(dia) {
  const diaSemana = dia.getDay(); // 0=domingo..6=sábado
  const { data } = await supabase
    .from('horarios_funcionamento')
    .select('abre, fecha')
    .eq('filial_id', filial.id)
    .eq('dia_semana', diaSemana)
    .maybeSingle();

  if (!data) return { abre: 8, fecha: 20 }; // fallback
  const abre = parseInt(data.abre.split(':')[0]);
  const fecha = parseInt(data.fecha.split(':')[0]);
  return { abre, fecha };
}

// =====================================================================
// SHELL / TOOLBAR
// =====================================================================

function renderShell(conteudo) {
  conteudo.innerHTML = `
    <div class="cabecalho-pagina">
      <h1>${t('agenda_titulo', lang)}</h1>
    </div>

    <div class="agenda-toolbar">
      <div class="navegacao-data">
        <button class="botao-icone" id="btn-anterior" aria-label="Anterior">‹</button>
        <span id="rotulo-data"></span>
        <button class="botao-icone" id="btn-proximo" aria-label="Próximo">›</button>
        <button class="botao botao-secundario" id="btn-hoje" style="padding:0.3rem 0.8rem;font-size:0.8rem;">${t('agenda_hoje', lang) || 'Hoje'}</button>
      </div>

      <div class="flex-entre">
        <div class="tabs-inline" id="tabs-visualizacao">
          <button data-modo="dia" class="ativo">${t('agenda_vista_dia', lang)}</button>
          <button data-modo="semana">${t('agenda_vista_semana', lang)}</button>
        </div>
        <select id="select-barbeiro-semana" class="oculto"></select>
        <button class="botao botao-secundario" id="btn-bloquear">${t('agenda_bloquear_horario', lang)}</button>
        <button class="botao botao-acento" id="btn-novo">+ ${t('agenda_novo_agendamento', lang)}</button>
        <button class="botao botao-secundario" id="btn-modo-bloqueio">✏️ Modo Bloqueio</button>
      </div>
    </div>

    <div id="grade-container"></div>
  `;

  // ---- Eventos ----
  raiz.querySelector('#btn-anterior').addEventListener('click', () => navegar(-1));
  raiz.querySelector('#btn-proximo').addEventListener('click', () => navegar(1));
  raiz.querySelector('#btn-hoje').addEventListener('click', () => { dataReferencia = new Date(); renderGrade(); });

  raiz.querySelectorAll('#tabs-visualizacao button').forEach((btn) => {
    btn.addEventListener('click', () => {
      raiz.querySelectorAll('#tabs-visualizacao button').forEach((b) => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      modo = btn.dataset.modo;
      const isBarbeiro = sessao.perfil.cargo === 'barbeiro';
      const select = raiz.querySelector('#select-barbeiro-semana');
      select.classList.toggle('oculto', modo !== 'semana' || isBarbeiro);
      renderGrade();
    });
  });

  const selectBarbeiro = raiz.querySelector('#select-barbeiro-semana');
  const isBarbeiro = sessao.perfil.cargo === 'barbeiro';
  if (isBarbeiro) {
    selectBarbeiro.style.display = 'none';
  } else {
    selectBarbeiro.innerHTML = barbeiros.map((b) => `<option value="${b.id}">${esc(b.nome)}</option>`).join('');
    if (barbeiroSemanaId) selectBarbeiro.value = barbeiroSemanaId;
    selectBarbeiro.addEventListener('change', () => {
      barbeiroSemanaId = selectBarbeiro.value;
      renderGrade();
    });
  }

  raiz.querySelector('#btn-bloquear').addEventListener('click', () => {
    const inicio = new Date(dataReferencia);
    inicio.setHours(HORA_INICIO, 0, 0, 0);
    abrirModalBloqueio({ barbeiroId: modo === 'semana' ? barbeiroSemanaId : (barbeiros[0]?.id || null), inicio });
  });

  raiz.querySelector('#btn-novo').addEventListener('click', () => {
    const inicio = new Date(dataReferencia);
    inicio.setHours(HORA_INICIO, 0, 0, 0);
    abrirModalAgendamento({ barbeiroId: modo === 'semana' ? barbeiroSemanaId : (barbeiros[0]?.id || null), inicio });
  });

  // ---- Modo Bloqueio ----
  const btnModoBloqueio = document.getElementById('btn-modo-bloqueio');
  btnModoBloqueio.addEventListener('click', () => {
    modoBloqueioAtivo = !modoBloqueioAtivo;
    if (modoBloqueioAtivo) {
      btnModoBloqueio.style.background = '#A8503C';
      btnModoBloqueio.style.color = '#fff';
      btnModoBloqueio.textContent = '🔴 Modo Bloqueio (Ativo)';
    } else {
      btnModoBloqueio.style.background = '';
      btnModoBloqueio.style.color = '';
      btnModoBloqueio.textContent = '✏️ Modo Bloqueio';
    }
  });
}

function navegar(direcao) {
  if (modo === 'dia') {
    dataReferencia = addDias(dataReferencia, direcao);
  } else {
    dataReferencia = addDias(dataReferencia, direcao * 7);
  }
  renderGrade();
}

// =====================================================================
// CARREGAMENTO + RENDER DA GRADE
// =====================================================================

async function renderGrade() {
  const container = raiz.querySelector('#grade-container');
  container.innerHTML = `<div class="tabela-vazia">Carregando…</div>`;

  // Busca horários para a data atual
  const horario = await buscarHorarioFilial(dataReferencia);
  HORA_INICIO = horario.abre;
  HORA_FIM = horario.fecha;
  TOTAL_SLOTS = ((HORA_FIM - HORA_INICIO) * 60) / SLOT_MINUTOS;

  if (barbeiros.length === 0) {
    container.innerHTML = `<div class="tabela-vazia">Nenhum profissional cadastrado nesta filial. Cadastre em Configurações → Equipe.</div>`;
    raiz.querySelector('#rotulo-data').textContent = '';
    return;
  }

  // --- FILTRO: barbeiro vê apenas sua própria coluna ---
  let barbeirosExibidos = barbeiros;
  const isBarbeiro = sessao.perfil.cargo === 'barbeiro';
  if (isBarbeiro) {
    const meuId = sessao.perfil.id;
    barbeirosExibidos = barbeiros.filter(b => b.id === meuId);
    // Se por algum motivo não encontrar, usa o primeiro (fallback)
    if (barbeirosExibidos.length === 0 && barbeiros.length > 0) {
      barbeirosExibidos = [barbeiros[0]];
    }
  }

  if (modo === 'dia') {
    raiz.querySelector('#rotulo-data').textContent = formatDateLong(dataReferencia, filial);
    const inicio = inicioDoDia(dataReferencia);
    const fim = addDias(inicio, 1);
    const [agendamentos, bloqueios] = await Promise.all([buscarAgendamentos(inicio, fim), buscarBloqueios(inicio, fim)]);

    let html = abrirGrade(barbeirosExibidos.map((b) => b.nome));
    html += colunaHorarios();

    barbeirosExibidos.forEach((b) => {
      const eventos = [
        ...agendamentos.filter((a) => a.barbeiro_id === b.id).map((a) => ({ ...a, tipo: 'agendamento' })),
        ...bloqueios.filter((bl) => bl.barbeiro_id === b.id || bl.barbeiro_id === null).map((bl) => ({ ...bl, tipo: 'bloqueio' })),
      ];
      html += coluna({ atributo: 'data-barbeiro', valor: b.id, eventos });
    });

    html += `</div>`;
    container.innerHTML = html;
    ligarEventos(container, { resolverContexto: (coluna) => ({ barbeiroId: coluna.dataset.barbeiro, dia: dataReferencia }) });
  } else {
    // Modo semana: já usa barbeiroSemanaId para filtrar eventos, mas mantemos a grade com dias
    // (Para barbeiros, a semana já mostra apenas os dias, não barbeiros, então não precisa mudar)
    const ini = inicioDaSemana(dataReferencia);
    const fimSem = addDias(ini, 7);
    const nomesDias = diasSemana(lang);
    const dias = Array.from({ length: 7 }, (_, i) => addDias(ini, i));

    raiz.querySelector('#rotulo-data').textContent = `${dataCurta(ini)} – ${dataCurta(addDias(ini, 6))}`;

    const [agendamentos, bloqueios] = await Promise.all([buscarAgendamentos(ini, fimSem), buscarBloqueios(ini, fimSem)]);
    // Para semana, se for barbeiro, usa o próprio ID; senão, usa o selecionado
    const idAlvo = isBarbeiro ? sessao.perfil.id : barbeiroSemanaId;
    const agAlvo = agendamentos.filter((a) => a.barbeiro_id === idAlvo);
    const blAlvo = bloqueios.filter((b) => b.barbeiro_id === idAlvo || b.barbeiro_id === null);

    const cabecalhos = dias.map((d) => `${nomesDias[d.getDay()].slice(0, 3)} ${dataCurta(d)}`);
    let html = abrirGrade(cabecalhos);
    html += colunaHorarios();

    dias.forEach((dia) => {
      const isoDia = dataISOLocal(dia);
      const eventos = [
        ...agAlvo.filter((a) => dataISOLocal(new Date(a.inicio)) === isoDia).map((a) => ({ ...a, tipo: 'agendamento' })),
        ...blAlvo.filter((b) => dataISOLocal(new Date(b.inicio)) === isoDia).map((b) => ({ ...b, tipo: 'bloqueio' })),
      ];
      html += coluna({ atributo: 'data-dia', valor: isoDia, eventos });
    });

    html += `</div>`;
    container.innerHTML = html;
    // Resolver contexto para a semana: barbeiroId é o alvo, dia é a data do dia
    ligarEventos(container, { resolverContexto: (coluna) => ({ barbeiroId: idAlvo, dia: parseDataLocal(coluna.dataset.dia) }) });
  }
}

async function buscarAgendamentos(inicio, fim) {
  return unwrap(
    await supabase
      .from('agendamentos')
      .select('id, inicio, fim, status, barbeiro_id, cliente_id, servico_id, combo_id, clientes(nome, telefone), servicos(nome), combos(nome)')
      .eq('filial_id', filial.id)
      .gte('inicio', inicio.toISOString())
      .lt('inicio', fim.toISOString())
      .order('inicio')
  );
}

async function buscarBloqueios(inicio, fim) {
  return unwrap(
    await supabase
      .from('bloqueios_agenda')
      .select('id, inicio, fim, barbeiro_id, motivo')
      .eq('filial_id', filial.id)
      .lt('inicio', fim.toISOString())
      .gt('fim', inicio.toISOString())
  );
}

// =====================================================================
// MONTAGEM DO HTML DA GRADE
// =====================================================================

function abrirGrade(rotulosColuna) {
  let html = `<div class="agenda-grade" style="grid-template-columns: 60px repeat(${rotulosColuna.length}, minmax(120px, 1fr))">`;
  html += `<div class="agenda-cabecalho-coluna"></div>`;
  rotulosColuna.forEach((r) => { html += `<div class="agenda-cabecalho-coluna">${esc(r)}</div>`; });
  return html;
}

function colunaHorarios() {
  let html = `<div class="agenda-coluna-horarios-wrap">`;
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const minutos = HORA_INICIO * 60 + i * SLOT_MINUTOS;
    html += `<div class="agenda-coluna-horarios" style="height:${SLOT_ALTURA_PX}px">${i % 2 === 0 ? formatarMinutos(minutos) : ''}</div>`;
  }
  html += `</div>`;
  return html;
}

function coluna({ atributo, valor, eventos }) {
  let html = `<div class="agenda-coluna" ${atributo}="${esc(valor)}">`;
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const minutos = HORA_INICIO * 60 + i * SLOT_MINUTOS;
    html += `<div class="agenda-slot" data-minutos="${minutos}" style="height:${SLOT_ALTURA_PX}px"></div>`;
  }
  eventos.forEach((ev) => { html += renderEvento(ev); });
  html += `</div>`;
  return html;
}

function renderEvento(ev) {
  const { hora: horaInicio, minuto: minInicio } = horaMinutoNaFilial(ev.inicio, filial);
  const { hora: horaFim, minuto: minFim } = horaMinutoNaFilial(ev.fim, filial);
  const minutosInicio = horaInicio * 60 + minInicio;
  const minutosFim = horaFim * 60 + minFim;
  const top = ((minutosInicio - HORA_INICIO * 60) / SLOT_MINUTOS) * SLOT_ALTURA_PX;
  const altura = Math.max(((minutosFim - minutosInicio) / SLOT_MINUTOS) * SLOT_ALTURA_PX, SLOT_ALTURA_PX / 2);

  if (ev.tipo === 'bloqueio') {
    return `
      <div class="agenda-evento agenda-bloqueio" data-bloqueio-id="${ev.id}" style="top:${top}px; height:${altura}px">
        <span class="horario">${formatTime(ev.inicio, filial)}–${formatTime(ev.fim, filial)}</span>
        ${esc(ev.motivo || 'Bloqueado')}
      </div>
    `;
  }

  const cor = STATUS_AGENDAMENTO_CORES[ev.status] || '#C8923A';
  const nomeServico = ev.servicos?.nome || ev.combos?.nome || 'Serviço';
  return `
    <div class="agenda-evento" data-agendamento-id="${ev.id}" style="top:${top}px; height:${altura}px; border-left-color:${cor}; background:${cor}26">
      <span class="horario">${formatTime(ev.inicio, filial)}</span>
      <strong>${esc(ev.clientes?.nome || 'Cliente')}</strong> — ${esc(nomeServico)}
    </div>
  `;
}

function ligarEventos(container, { resolverContexto }) {
  container.querySelectorAll('.agenda-slot').forEach((slot) => {
    slot.addEventListener('click', () => {
      const colunaEl = slot.closest('.agenda-coluna');
      const { barbeiroId, dia } = resolverContexto(colunaEl);
      const minutos = Number(slot.dataset.minutos);
      const inicio = new Date(dia);
      inicio.setHours(Math.floor(minutos / 60), minutos % 60, 0, 0);

      if (modoBloqueioAtivo) {
        // Abrir modal de bloqueio
        abrirModalBloqueio({ barbeiroId, inicio });
      } else {
        // Abrir modal de agendamento (como antes)
        abrirModalAgendamento({ barbeiroId, inicio });
      }
    });
  });

  container.querySelectorAll('.agenda-evento[data-agendamento-id]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      abrirModalEditarAgendamento(el.dataset.agendamentoId);
    });
  });

  container.querySelectorAll('.agenda-evento.agenda-bloqueio[data-bloqueio-id]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      abrirModalBloqueioExistente(el.dataset.bloqueioId);
    });
  });
}

// =====================================================================
// MODAL: NOVO AGENDAMENTO
// =====================================================================

function abrirModalAgendamento({ barbeiroId, inicio }) {
  const overlay = abrirModal(t('agenda_novo_agendamento', lang), `
    <form id="form-agendamento">
      <div class="linha-formulario">
        ${campoTexto({ id: 'nome', label: t('agenda_cliente', lang) })}
        ${campoTexto({ id: 'telefone', label: 'Telefone', placeholder: filial.pais === 'PY' ? '+595981234567' : '+5511987654321' })}
      </div>
      ${campoSelect({
        id: 'servico', label: t('agenda_servico', lang),
        opcoes: servicos.map((s) => ({ valor: s.id, texto: `${s.nome} (${s.duracao_minutos} min)` })),
        obrigatorio: true,
      })}
      ${campoSelect({
        id: 'barbeiro', label: t('agenda_barbeiro', lang), valor: barbeiroId,
        opcoes: barbeiros.map((b) => ({ valor: b.id, texto: b.nome })),
        obrigatorio: true,
      })}
      ${campoTexto({ id: 'inicio', label: t('agenda_inicio', lang), tipo: 'datetime-local', valor: dataParaInputLocal(inicio), obrigatorio: true })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-agendamento');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    erroEl.classList.add('oculto');
    const botao = form.querySelector('button[type=submit]');
    botao.disabled = true;

    try {
      const servicoId = form.querySelector('#servico').value;
      const servicoEscolhido = servicos.find((s) => s.id === servicoId);
      const inicioDate = new Date(form.querySelector('#inicio').value);
      const fimDate = new Date(inicioDate.getTime() + servicoEscolhido.duracao_minutos * 60000);

      const clienteId = await obterOuCriarCliente(valorTexto(form, 'nome'), valorTexto(form, 'telefone'));

      unwrap(await supabase.from('agendamentos').insert({
        empresa_id: sessao.perfil.empresa_id,
        filial_id: filial.id,
        cliente_id: clienteId,
        barbeiro_id: form.querySelector('#barbeiro').value,
        servico_id: servicoId,
        inicio: inicioDate.toISOString(),
        fim: fimDate.toISOString(),
        status: 'agendado',
        origem: 'recepcao',
      }));

      fecharModal(overlay);
      await renderGrade();
    } catch (e) {
      erroEl.textContent = mensagemAmigavel(e.message);
      erroEl.classList.remove('oculto');
      botao.disabled = false;
    }
  });
}

/**
 * Busca cliente existente pelo telefone (mesma empresa). Se encontrado,
 * atualiza o nome (se informado) e retorna o id. Caso contrário, cria um
 * novo cliente com nome + telefone (cadastro de baixo atrito).
 * Se nada for informado, retorna null (atendimento sem cliente vinculado).
 */
async function obterOuCriarCliente(nome, telefone) {
  if (!nome && !telefone) return null;

  if (telefone) {
    const existentes = unwrap(
      await supabase.from('clientes').select('id').eq('empresa_id', sessao.perfil.empresa_id).eq('telefone', telefone).limit(1)
    );
    if (existentes.length > 0) {
      if (nome) unwrap(await supabase.from('clientes').update({ nome }).eq('id', existentes[0].id));
      return existentes[0].id;
    }
  }

  const novo = unwrap(
    await supabase.from('clientes').insert({ empresa_id: sessao.perfil.empresa_id, nome: nome || 'Cliente', telefone }).select().single()
  );
  return novo.id;
}

// =====================================================================
// MODAL: EDITAR AGENDAMENTO
// =====================================================================

async function abrirModalEditarAgendamento(id) {
  const ag = unwrap(
    await supabase
      .from('agendamentos')
      .select('id, inicio, fim, status, clientes(nome, telefone), perfis(nome), servicos(nome), combos(nome)')
      .eq('id', id)
      .single()
  );

  const nomeServico = ag.servicos?.nome || ag.combos?.nome || 'Serviço';

  const overlay = abrirModal(esc(ag.clientes?.nome || 'Atendimento'), `
    <p><strong>${t('agenda_servico', lang)}:</strong> ${esc(nomeServico)}</p>
    <p><strong>${t('agenda_barbeiro', lang)}:</strong> ${esc(ag.perfis?.nome || '—')}</p>
    <p><strong>${t('agenda_inicio', lang)}:</strong> ${formatDateLong(ag.inicio, filial)}, ${formatTime(ag.inicio, filial)}–${formatTime(ag.fim, filial)}</p>
    ${ag.clientes?.telefone ? `<p><strong>Telefone:</strong> ${esc(ag.clientes.telefone)}</p>` : ''}

    <form id="form-status">
      ${campoSelect({
        id: 'status', label: t('agenda_status', lang), valor: ag.status,
        opcoes: Object.entries(STATUS_AGENDAMENTO_LABELS).map(([valor, texto]) => ({ valor, texto })),
        obrigatorio: true,
      })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-perigo" id="btn-excluir-agendamento">${t('acao_excluir', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-status');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    try {
      unwrap(await supabase.from('agendamentos').update({ status: form.querySelector('#status').value }).eq('id', id));
      fecharModal(overlay);
      await renderGrade();
    } catch (e) {
      erroEl.textContent = mensagemAmigavel(e.message);
      erroEl.classList.remove('oculto');
    }
  });

  overlay.querySelector('#btn-excluir-agendamento').addEventListener('click', async () => {
    if (!confirm(t('confirmacao_excluir', lang))) return;
    try {
      unwrap(await supabase.from('agendamentos').delete().eq('id', id));
      fecharModal(overlay);
      await renderGrade();
    } catch (e) {
      mostrarErro(mensagemAmigavel(e.message));
    }
  });
}

// =====================================================================
// MODAL: BLOQUEIO DE HORÁRIO (VERSÃO FINAL)
// =====================================================================

function abrirModalBloqueio({ barbeiroId, inicio, data = null, fim = null, motivo = '', editarId = null }) {
  const isBarbeiro = sessao.perfil.cargo === 'barbeiro';

  // Opções do select – se for barbeiro, mostra apenas ele mesmo (desabilitado)
  const profissionalOptions = isBarbeiro
    ? `<option value="${sessao.perfil.id}" selected>${esc(sessao.perfil.nome)}</option>`
    : `<option value="">Toda a filial</option>
       ${barbeiros.map(b => `<option value="${b.id}" ${b.id === barbeiroId ? 'selected' : ''}>${esc(b.nome)}</option>`).join('')}`;

  const overlay = abrirModal(
    editarId ? '✏️ Editar Bloqueio' : '🔒 Novo Bloqueio',
    `
    <form id="form-bloqueio" style="padding:4px 0;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="campo" style="margin-bottom:0;">
          <label for="bloq-profissional">${t('agenda_barbeiro', lang)}</label>
          <select id="bloq-profissional" class="form-control" style="width:100%;" ${isBarbeiro ? 'disabled' : ''}>
            ${profissionalOptions}
          </select>
          ${isBarbeiro ? `<input type="hidden" id="bloq-profissional-hidden" value="${sessao.perfil.id}" />` : ''}
        </div>
        <div class="campo" style="margin-bottom:0;">
          <label for="bloq-motivo">Motivo</label>
          <input type="text" id="bloq-motivo" value="${esc(motivo)}" placeholder="Ex: Almoço, Reunião" class="form-control" style="width:100%;" />
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px;">
        <div class="campo" style="margin-bottom:0;">
          <label for="bloq-data">Data</label>
          <input type="date" id="bloq-data" value="${data ? data.toISOString().split('T')[0] : inicio?.toISOString().split('T')[0] || ''}" class="form-control" style="width:100%;" />
        </div>
        <div class="campo" style="margin-bottom:0;">
          <label for="bloq-hora-inicio">Início</label>
          <input type="time" id="bloq-hora-inicio" value="${inicio ? String(inicio.getHours()).padStart(2,'0') + ':' + String(inicio.getMinutes()).padStart(2,'0') : '12:00'}" class="form-control" style="width:100%;" step="900" />
        </div>
        <div class="campo" style="margin-bottom:0;">
          <label for="bloq-duracao">Duração (min)</label>
          <input type="number" id="bloq-duracao" value="30" min="15" step="15" class="form-control" style="width:100%;" />
        </div>
      </div>

      <!-- Repetição -->
      <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:12px; padding:8px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line);">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.9rem;">
          <input type="checkbox" id="bloq-repetir-diario" /> Repetir diariamente
        </label>
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.9rem;">
          <input type="checkbox" id="bloq-repetir-semanal" /> Repetir semanalmente
        </label>
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.9rem;">
          <input type="number" id="bloq-repeticoes" value="4" min="1" max="52" style="width:60px;" /> semanas
        </label>
      </div>

      <!-- Dias da semana (para repetição semanal) -->
      <div id="bloq-opcoes-dias" style="display:none; background:var(--bg-card); padding:10px 14px; border-radius:8px; margin-bottom:12px;">
        <div style="font-weight:600; font-size:0.85rem; margin-bottom:6px;">Dias da semana:</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map((dia, idx) => `
            <label style="display:flex; align-items:center; gap:4px; cursor:pointer; font-size:0.9rem;">
              <input type="checkbox" class="bloq-dia-semana" value="${idx}" ${idx === new Date().getDay() ? 'checked' : ''} /> ${dia}
            </label>
          `).join('')}
        </div>
        <div style="margin-top:6px;">
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.85rem;">
            <input type="checkbox" id="bloq-aplicar-todos-dias" /> Aplicar a todos os dias da semana
          </label>
        </div>
      </div>

      <!-- Preview -->
      <div id="bloq-preview" style="display:none; background:#eafaf1; padding:10px 14px; border-radius:8px; margin-bottom:12px; font-size:0.9rem; border-left:4px solid #27ae60;">
        <strong>Pré-visualização:</strong> <span id="bloq-preview-text">Serão criados X bloqueios</span>
      </div>

      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${editarId ? 'Atualizar' : 'Salvar'}</button>
        ${editarId ? `<button type="button" class="botao botao-perigo" id="btn-excluir-bloqueio">🗑️ Excluir</button>` : ''}
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
    `,
    { wide: true }
  );

  if (!overlay) return;

  // ---- Lógica de repetição ----
  const checkboxDiario = overlay.querySelector('#bloq-repetir-diario');
  const checkboxSemanal = overlay.querySelector('#bloq-repetir-semanal');
  const opcoesDias = overlay.querySelector('#bloq-opcoes-dias');
  const checkboxesDias = overlay.querySelectorAll('.bloq-dia-semana');
  const btnTodosDias = overlay.querySelector('#bloq-aplicar-todos-dias');

  function toggleRepeticao() {
    const semanal = checkboxSemanal.checked;
    opcoesDias.style.display = semanal ? 'block' : 'none';
    if (checkboxDiario.checked) {
      checkboxesDias.forEach(cb => cb.checked = true);
    }
    atualizarPreview();
  }

  checkboxDiario.addEventListener('change', toggleRepeticao);
  checkboxSemanal.addEventListener('change', toggleRepeticao);

  btnTodosDias.addEventListener('change', () => {
    if (btnTodosDias.checked) {
      checkboxesDias.forEach(cb => cb.checked = true);
    }
    atualizarPreview();
  });

  checkboxesDias.forEach(cb => cb.addEventListener('change', atualizarPreview));

  // ---- Preview ----
  function atualizarPreview() {
    const data = overlay.querySelector('#bloq-data').value;
    const hora = overlay.querySelector('#bloq-hora-inicio').value;
    const duracao = parseInt(overlay.querySelector('#bloq-duracao').value) || 30;
    const diario = checkboxDiario.checked;
    const semanal = checkboxSemanal.checked;
    const diasSelecionados = [...checkboxesDias].filter(cb => cb.checked).map(cb => parseInt(cb.value));
    const repeticoes = parseInt(overlay.querySelector('#bloq-repeticoes').value) || 1;

    let qtd = 1;
    if (diario) qtd = 7;
    else if (semanal && diasSelecionados.length > 0) qtd = diasSelecionados.length * repeticoes;

    const preview = overlay.querySelector('#bloq-preview');
    const previewText = overlay.querySelector('#bloq-preview-text');
    if (qtd > 1 && data && hora) {
      preview.style.display = 'block';
      previewText.textContent = `Serão criados ${qtd} bloqueios (${duracao} min cada) para ${diasSelecionados.length > 0 ? 'os dias selecionados' : 'este dia'}.`;
    } else {
      preview.style.display = 'none';
    }
  }

  overlay.querySelector('#bloq-data').addEventListener('change', atualizarPreview);
  overlay.querySelector('#bloq-hora-inicio').addEventListener('change', atualizarPreview);
  overlay.querySelector('#bloq-duracao').addEventListener('input', atualizarPreview);
  overlay.querySelector('#bloq-repeticoes').addEventListener('input', atualizarPreview);
  atualizarPreview();

  // ---- Submit ----
  const form = overlay.querySelector('#form-bloqueio');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    erroEl.classList.add('oculto');

    // Captura o profissional (se barbeiro, força o próprio ID)
    let profissional;
    if (isBarbeiro) {
      profissional = sessao.perfil.id;
    } else {
      profissional = overlay.querySelector('#bloq-profissional').value;
    }

    const dataStr = overlay.querySelector('#bloq-data').value;
    const horaStr = overlay.querySelector('#bloq-hora-inicio').value;
    const duracao = parseInt(overlay.querySelector('#bloq-duracao').value) || 30;
    const motivo = overlay.querySelector('#bloq-motivo').value.trim() || 'Bloqueio';
    const diario = checkboxDiario.checked;
    const semanal = checkboxSemanal.checked;
    const diasSelecionados = [...checkboxesDias].filter(cb => cb.checked).map(cb => parseInt(cb.value));
    const repeticoes = parseInt(overlay.querySelector('#bloq-repeticoes').value) || 1;

    if (!dataStr || !horaStr) {
      erroEl.textContent = 'Selecione data e hora.';
      erroEl.classList.remove('oculto');
      return;
    }

    try {
      const dataBase = new Date(dataStr + 'T' + horaStr + ':00');
      if (isNaN(dataBase.getTime())) throw new Error('Data/hora inválida.');

      const datasParaCriar = [];

      if (diario) {
        for (let i = 0; i < 7; i++) {
          const d = new Date(dataBase);
          d.setDate(d.getDate() + i);
          datasParaCriar.push(d);
        }
      } else if (semanal && diasSelecionados.length > 0) {
        const diaBase = dataBase.getDay();
        for (let rep = 0; rep < repeticoes; rep++) {
          for (const diaSemana of diasSelecionados) {
            let diff = diaSemana - diaBase;
            const d = new Date(dataBase);
            d.setDate(d.getDate() + diff + (rep * 7));
            const hoje = new Date();
            hoje.setHours(0,0,0,0);
            if (d >= hoje) datasParaCriar.push(d);
          }
        }
      } else {
        datasParaCriar.push(dataBase);
      }

      if (datasParaCriar.length === 0) {
        erroEl.textContent = 'Nenhuma data válida para criar bloqueios.';
        erroEl.classList.remove('oculto');
        return;
      }

      const fimDate = new Date(dataBase);
      fimDate.setMinutes(fimDate.getMinutes() + duracao);

      const inserir = datasParaCriar.map(d => {
        const inicio = new Date(d);
        const fim = new Date(d);
        fim.setMinutes(fim.getMinutes() + duracao);
        return {
          empresa_id: sessao.perfil.empresa_id,
          filial_id: filial.id,
          barbeiro_id: profissional || null,
          inicio: inicio.toISOString(),
          fim: fim.toISOString(),
          motivo: motivo,
        };
      });

      const { error } = await supabase.from('bloqueios_agenda').insert(inserir);
      if (error) throw error;

      fecharModal(overlay);
      await renderGrade();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('oculto');
    }
  });

  // ---- Botão Excluir (edição) ----
  const btnExcluir = overlay.querySelector('#btn-excluir-bloqueio');
  if (btnExcluir) {
    btnExcluir.addEventListener('click', async () => {
      if (!confirm('Tem certeza que deseja excluir este bloqueio?')) return;
      try {
        const { error } = await supabase
          .from('bloqueios_agenda')
          .delete()
          .eq('id', editarId);
        if (error) throw error;
        fecharModal(overlay);
        await renderGrade();
      } catch (e) {
        alert('Erro ao excluir: ' + e.message);
      }
    });
  }
}

// =====================================================================
// ABRIR BLOQUEIO EXISTENTE
// =====================================================================

async function abrirModalBloqueioExistente(id) {
  const { data: bloqueio } = await supabase
    .from('bloqueios_agenda')
    .select('*')
    .eq('id', id)
    .single();

  if (!bloqueio) return;

  const inicio = new Date(bloqueio.inicio);
  const fim = new Date(bloqueio.fim);
  const duracao = (fim - inicio) / 60000;

  abrirModalBloqueio({
    barbeiroId: bloqueio.barbeiro_id,
    inicio,
    data: inicio,
    fim,
    motivo: bloqueio.motivo || '',
    editarId: id
  });
}

// =====================================================================
// HELPERS DE DATA/HORA
// =====================================================================

function inicioDoDia(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDias(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function inicioDaSemana(d) {
  const r = new Date(d);
  const diaSemana = r.getDay(); // 0 = domingo
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana; // segunda-feira
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function dataISOLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDataLocal(isoData) {
  const [ano, mes, dia] = isoData.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

function dataParaInputLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dataCurta(d) {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-PY' : 'pt-BR', { day: '2-digit', month: '2-digit' }).format(d);
}

function formatarMinutos(totalMinutos) {
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Traduz mensagens das funções/triggers do banco (em PT) para o idioma da UI. */
function mensagemAmigavel(mensagem) {
  if (lang === 'es') {
    if (mensagem.includes('Conflito de horário')) return 'Conflicto de horario: el profesional ya tiene un turno en este período.';
    if (mensagem.includes('Horário bloqueado')) return 'Horario bloqueado (pausa, descanso o feriado) para este profesional/sucursal.';
  }
  return mensagem;
}