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

const HORA_INICIO = 8;
const HORA_FIM = 20;
const SLOT_MINUTOS = 30;
const SLOT_ALTURA_PX = 32;
const TOTAL_SLOTS = ((HORA_FIM - HORA_INICIO) * 60) / SLOT_MINUTOS;


let sessao, lang, filial, raiz;
let modo = 'dia'; // 'dia' | 'semana'
let dataReferencia = new Date();
let barbeiroSemanaId = null;
let barbeiros = [];
let servicos = [];

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

  renderShell(raiz);
  await renderGrade();
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
        <button class="botao botao-secundario" id="btn-hoje">Hoje</button>
      </div>

      <div class="flex-entre">
        <div class="tabs-inline" id="tabs-visualizacao">
          <button data-modo="dia" class="ativo">${t('agenda_vista_dia', lang)}</button>
          <button data-modo="semana">${t('agenda_vista_semana', lang)}</button>
        </div>
        <select id="select-barbeiro-semana" class="oculto"></select>
        <button class="botao botao-secundario" id="btn-bloquear">${t('agenda_bloquear_horario', lang)}</button>
        <button class="botao botao-acento" id="btn-novo">+ ${t('agenda_novo_agendamento', lang)}</button>
      </div>
    </div>

    <div id="grade-container"></div>
  `;

  raiz.querySelector('#btn-anterior').addEventListener('click', () => navegar(-1));
  raiz.querySelector('#btn-proximo').addEventListener('click', () => navegar(1));
  raiz.querySelector('#btn-hoje').addEventListener('click', () => { dataReferencia = new Date(); renderGrade(); });

  raiz.querySelectorAll('#tabs-visualizacao button').forEach((btn) => {
    btn.addEventListener('click', () => {
      raiz.querySelectorAll('#tabs-visualizacao button').forEach((b) => b.classList.remove('ativo'));
      btn.classList.add('ativo');
      modo = btn.dataset.modo;
      raiz.querySelector('#select-barbeiro-semana').classList.toggle('oculto', modo !== 'semana');
      renderGrade();
    });
  });

  const selectBarbeiro = raiz.querySelector('#select-barbeiro-semana');
  selectBarbeiro.innerHTML = barbeiros.map((b) => `<option value="${b.id}">${esc(b.nome)}</option>`).join('');
  if (barbeiroSemanaId) selectBarbeiro.value = barbeiroSemanaId;
  selectBarbeiro.addEventListener('change', () => {
    barbeiroSemanaId = selectBarbeiro.value;
    renderGrade();
  });

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

  if (barbeiros.length === 0) {
    container.innerHTML = `<div class="tabela-vazia">Nenhum profissional cadastrado nesta filial. Cadastre em Configurações → Equipe.</div>`;
    raiz.querySelector('#rotulo-data').textContent = '';
    return;
  }

  if (modo === 'dia') {
    raiz.querySelector('#rotulo-data').textContent = formatDateLong(dataReferencia, filial);
    const inicio = inicioDoDia(dataReferencia);
    const fim = addDias(inicio, 1);
    const [agendamentos, bloqueios] = await Promise.all([buscarAgendamentos(inicio, fim), buscarBloqueios(inicio, fim)]);

    let html = abrirGrade(barbeiros.map((b) => b.nome));
    html += colunaHorarios();
    barbeiros.forEach((b) => {
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
    const ini = inicioDaSemana(dataReferencia);
    const fimSem = addDias(ini, 7);
    const nomesDias = diasSemana(lang);
    const dias = Array.from({ length: 7 }, (_, i) => addDias(ini, i));

    raiz.querySelector('#rotulo-data').textContent = `${dataCurta(ini)} – ${dataCurta(addDias(ini, 6))}`;

    const [agendamentos, bloqueios] = await Promise.all([buscarAgendamentos(ini, fimSem), buscarBloqueios(ini, fimSem)]);
    const agAlvo = agendamentos.filter((a) => a.barbeiro_id === barbeiroSemanaId);
    const blAlvo = bloqueios.filter((b) => b.barbeiro_id === barbeiroSemanaId || b.barbeiro_id === null);

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
    ligarEventos(container, { resolverContexto: (coluna) => ({ barbeiroId: barbeiroSemanaId, dia: parseDataLocal(coluna.dataset.dia) }) });
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
      abrirModalAgendamento({ barbeiroId, inicio });
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
// MODAL: BLOQUEIO DE HORÁRIO
// =====================================================================

function abrirModalBloqueio({ barbeiroId, inicio }) {
  const fim = new Date(inicio.getTime() + 30 * 60000);

  const overlay = abrirModal(t('agenda_bloquear_horario', lang), `
    <form id="form-bloqueio">
      ${campoSelect({
        id: 'barbeiro', label: t('agenda_barbeiro', lang), valor: barbeiroId || '',
        opcoes: [{ valor: '', texto: 'Toda a filial (feriado)' }, ...barbeiros.map((b) => ({ valor: b.id, texto: b.nome }))],
      })}
      <div class="linha-formulario">
        ${campoTexto({ id: 'inicio', label: t('agenda_inicio', lang), tipo: 'datetime-local', valor: dataParaInputLocal(inicio), obrigatorio: true })}
        ${campoTexto({ id: 'fim', label: 'Fim', tipo: 'datetime-local', valor: dataParaInputLocal(fim), obrigatorio: true })}
      </div>
      ${campoTextarea({ id: 'motivo', label: t('agenda_motivo_bloqueio', lang) })}
      <div id="erro-form" class="mensagem-erro oculto"></div>
      <div class="acoes-formulario">
        <button type="submit" class="botao botao-primario">${t('acao_salvar', lang)}</button>
        <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_cancelar', lang)}</button>
      </div>
    </form>
  `);

  const form = overlay.querySelector('#form-bloqueio');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erroEl = form.querySelector('#erro-form');
    try {
      const inicioDate = new Date(form.querySelector('#inicio').value);
      const fimDate = new Date(form.querySelector('#fim').value);
      if (fimDate <= inicioDate) throw new Error('O fim deve ser depois do início.');

      unwrap(await supabase.from('bloqueios_agenda').insert({
        empresa_id: sessao.perfil.empresa_id,
        filial_id: filial.id,
        barbeiro_id: form.querySelector('#barbeiro').value || null,
        inicio: inicioDate.toISOString(),
        fim: fimDate.toISOString(),
        motivo: valorTexto(form, 'motivo'),
      }));

      fecharModal(overlay);
      await renderGrade();
    } catch (e) {
      erroEl.textContent = mensagemAmigavel(e.message);
      erroEl.classList.remove('oculto');
    }
  });
}

async function abrirModalBloqueioExistente(id) {
  const bloqueio = unwrap(await supabase.from('bloqueios_agenda').select('id, inicio, fim, motivo, perfis(nome)').eq('id', id).single());

  const overlay = abrirModal('Bloqueio', `
    <p><strong>${t('agenda_inicio', lang)}:</strong> ${formatDateLong(bloqueio.inicio, filial)}, ${formatTime(bloqueio.inicio, filial)}–${formatTime(bloqueio.fim, filial)}</p>
    <p><strong>${t('agenda_barbeiro', lang)}:</strong> ${esc(bloqueio.perfis?.nome || 'Toda a filial')}</p>
    ${bloqueio.motivo ? `<p><strong>${t('agenda_motivo_bloqueio', lang)}:</strong> ${esc(bloqueio.motivo)}</p>` : ''}
    <div class="acoes-formulario">
      <button type="button" class="botao botao-perigo" id="btn-excluir-bloqueio">${t('acao_excluir', lang)}</button>
      <button type="button" class="botao botao-secundario" data-fechar-modal>${t('acao_voltar', lang)}</button>
    </div>
  `);

  overlay.querySelector('#btn-excluir-bloqueio').addEventListener('click', async () => {
    if (!confirm(t('confirmacao_excluir', lang))) return;
    unwrap(await supabase.from('bloqueios_agenda').delete().eq('id', id));
    fecharModal(overlay);
    await renderGrade();
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
