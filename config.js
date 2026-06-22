// =====================================================================
// app/js/config.js
//
// Cada barbearia (tenant) recebe seu próprio deployment white-label do
// /app — por isso o EMPRESA_ID é fixo por deployment, e não descoberto
// dinamicamente. Ao clonar este projeto para um novo cliente, troque
// apenas este valor (e o supabaseClient.js, se usar projeto próprio).
//
// Como obter: na tabela `empresas` do Supabase, copie o `id` da barbearia.
// =====================================================================

export const EMPRESA_ID = '831bf0c0-bc9a-4ba2-ae32-8b947eadec9d';

// Nome de exibição usado enquanto os dados da empresa carregam (fallback).
export const NOME_PADRAO = 'Barbearia';
