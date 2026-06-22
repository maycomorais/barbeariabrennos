// =====================================================================
// app/js/filialContext.js
// Carrega as filiais ativas da empresa configurada e gerencia a filial
// escolhida pelo cliente (persistida no navegador para a próxima visita).
// =====================================================================

import { supabase, unwrap } from './supabase.js';
import { EMPRESA_ID } from './config.js';

const CHAVE_FILIAL = 'barbearia_filial_id';

/** Carrega todas as filiais ativas da empresa configurada. */
export async function carregarFiliais() {
  return unwrap(
    await supabase
      .from('filiais')
      .select('id, nome, slug, pais, endereco, google_maps_url, telefone, timezone, moeda_principal, aceita_moeda_secundaria, moeda_secundaria, taxa_cambio_secundaria, ativo')
      .eq('empresa_id', EMPRESA_ID)
      .eq('ativo', true)
      .order('nome')
  );
}

/** Lê o nome da empresa (para branding do topo). */
export async function carregarEmpresa() {
  return unwrap(
    await supabase.from('empresas').select('id, nome, ativo').eq('id', EMPRESA_ID).single()
  );
}

export function getFilialSelecionadaId() {
  return localStorage.getItem(CHAVE_FILIAL);
}

export function setFilialSelecionada(filialId) {
  localStorage.setItem(CHAVE_FILIAL, filialId);
}

export function limparFilialSelecionada() {
  localStorage.removeItem(CHAVE_FILIAL);
}

/**
 * Resolve a filial ativa para a sessão atual:
 * 1. Se houver um `?unidade=slug` na URL, usa essa filial (e persiste).
 * 2. Senão, usa a filial salva no navegador (se ainda existir/ativa).
 * 3. Senão, se houver apenas UMA filial ativa, seleciona-a automaticamente.
 * 4. Caso contrário, retorna null (a página deve mostrar o seletor).
 */
export async function resolverFilialAtiva() {
  const filiais = await carregarFiliais();
  if (filiais.length === 0) return { filial: null, filiais };

  const params = new URLSearchParams(window.location.search);
  const slugUrl = params.get('unidade');
  if (slugUrl) {
    const porSlug = filiais.find((f) => f.slug === slugUrl);
    if (porSlug) {
      setFilialSelecionada(porSlug.id);
      return { filial: porSlug, filiais };
    }
  }

  const salvaId = getFilialSelecionadaId();
  if (salvaId) {
    const salva = filiais.find((f) => f.id === salvaId);
    if (salva) return { filial: salva, filiais };
  }

  if (filiais.length === 1) {
    setFilialSelecionada(filiais[0].id);
    return { filial: filiais[0], filiais };
  }

  return { filial: null, filiais };
}
