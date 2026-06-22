// =====================================================================
// admin/js/util.js
// =====================================================================

/** Evita XSS ao injetar texto vindo do banco em innerHTML. */
export function esc(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Mostra um alerta de erro simples (substitui window.alert por algo consistente). */
export function mostrarErro(mensagem) {
  // eslint-disable-next-line no-alert
  alert(mensagem);
}
