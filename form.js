// =====================================================================
// admin/js/form.js
// Helpers para gerar campos de formulário consistentes e ler seus
// valores com o tipo correto (evita repetição nos cadastros).
// =====================================================================

import { esc } from './util.js';

export function campoTexto({ id, label, valor = '', tipo = 'text', obrigatorio = false, ajuda = '', placeholder = '' }) {
  return `
    <div class="campo">
      <label for="${id}">${esc(label)}</label>
      <input type="${tipo}" id="${id}" value="${esc(valor)}" placeholder="${esc(placeholder)}" ${obrigatorio ? 'required' : ''} />
      ${ajuda ? `<span class="ajuda">${esc(ajuda)}</span>` : ''}
    </div>
  `;
}

export function campoTextarea({ id, label, valor = '', ajuda = '' }) {
  return `
    <div class="campo">
      <label for="${id}">${esc(label)}</label>
      <textarea id="${id}" rows="3">${esc(valor)}</textarea>
      ${ajuda ? `<span class="ajuda">${esc(ajuda)}</span>` : ''}
    </div>
  `;
}

export function campoNumero({ id, label, valor = 0, min = null, step = '0.01', obrigatorio = false, ajuda = '' }) {
  return `
    <div class="campo">
      <label for="${id}">${esc(label)}</label>
      <input type="number" id="${id}" value="${valor ?? 0}" step="${step}" ${min !== null ? `min="${min}"` : ''} ${obrigatorio ? 'required' : ''} />
      ${ajuda ? `<span class="ajuda">${esc(ajuda)}</span>` : ''}
    </div>
  `;
}

/** @param {{id, label, valor, opcoes: {valor, texto}[], obrigatorio, ajuda}} args */
export function campoSelect({ id, label, valor = '', opcoes = [], obrigatorio = false, ajuda = '' }) {
  const optsHtml = opcoes
    .map((o) => `<option value="${esc(o.valor)}" ${String(o.valor) === String(valor) ? 'selected' : ''}>${esc(o.texto)}</option>`)
    .join('');
  return `
    <div class="campo">
      <label for="${id}">${esc(label)}</label>
      <select id="${id}" ${obrigatorio ? 'required' : ''}>${optsHtml}</select>
      ${ajuda ? `<span class="ajuda">${esc(ajuda)}</span>` : ''}
    </div>
  `;
}

export function campoCheckbox({ id, label, marcado = false }) {
  return `
    <div class="campo campo-checkbox">
      <input type="checkbox" id="${id}" ${marcado ? 'checked' : ''} />
      <label for="${id}">${esc(label)}</label>
    </div>
  `;
}

// ---- leitura de valores ----

export function valorTexto(form, id) {
  const v = form.querySelector(`#${id}`).value.trim();
  return v === '' ? null : v;
}

export function valorNumero(form, id) {
  const v = form.querySelector(`#${id}`).value;
  return v === '' ? null : Number(v);
}

export function valorChecked(form, id) {
  return form.querySelector(`#${id}`).checked;
}
