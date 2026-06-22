// =====================================================================
// admin/js/modal.js
// Modal genérico reutilizável (cadastros, agenda, etc.)
// =====================================================================

/**
 * Abre um modal com o HTML fornecido. Fecha ao clicar fora ou em
 * qualquer elemento com [data-fechar-modal].
 * @returns {HTMLElement} o elemento overlay (use para fechar manualmente)
 */
export function abrirModal(tituloHtml, conteudoHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay-modal';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${tituloHtml}</h2>
      ${conteudoHtml}
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) fecharModal(overlay);
  });

  overlay.querySelectorAll('[data-fechar-modal]').forEach((el) => {
    el.addEventListener('click', () => fecharModal(overlay));
  });

  const escListener = (ev) => {
    if (ev.key === 'Escape') {
      fecharModal(overlay);
      document.removeEventListener('keydown', escListener);
    }
  };
  document.addEventListener('keydown', escListener);

  return overlay;
}

export function fecharModal(overlay) {
  overlay.remove();
}
