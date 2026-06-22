// =====================================================================
// shared/js/constants.js
// =====================================================================

// DDIs comuns na América Latina, para o seletor de telefone no
// cadastro de cliente (autoatendimento).
export const DDI_LATAM = [
  { ddi: '+595', pais: 'PY', label: '🇵🇾 +595 Paraguai' },
  { ddi: '+55', pais: 'BR', label: '🇧🇷 +55 Brasil' },
  { ddi: '+54', pais: 'AR', label: '🇦🇷 +54 Argentina' },
  { ddi: '+591', pais: 'BO', label: '🇧🇴 +591 Bolívia' },
  { ddi: '+56', pais: 'CL', label: '🇨🇱 +56 Chile' },
  { ddi: '+57', pais: 'CO', label: '🇨🇴 +57 Colômbia' },
  { ddi: '+593', pais: 'EC', label: '🇪🇨 +593 Equador' },
  { ddi: '+51', pais: 'PE', label: '🇵🇪 +51 Peru' },
  { ddi: '+598', pais: 'UY', label: '🇺🇾 +598 Uruguai' },
  { ddi: '+58', pais: 'VE', label: '🇻🇪 +58 Venezuela' },
  { ddi: '+52', pais: 'MX', label: '🇲🇽 +52 México' },
];

// DDI padrão sugerido conforme o país da filial selecionada.
export const DDI_PADRAO_POR_PAIS = {
  PY: '+595',
  BR: '+55',
};

export const CARGO_LABELS = {
  proprietario: 'Proprietário',
  gerente: 'Gerente',
  barbeiro: 'Barbeiro',
  recepcionista: 'Recepcionista',
};

export const STATUS_AGENDAMENTO_LABELS = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  em_atendimento: 'Em atendimento',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  no_show: 'Não compareceu',
};

export const STATUS_AGENDAMENTO_CORES = {
  agendado: '#C8923A',      // brass
  confirmado: '#3E7A5C',    // sage escuro
  em_atendimento: '#2F6FBF',
  concluido: '#6B7A70',
  cancelado: '#A8503C',
  no_show: '#A8503C',
};

export const FORMA_PAGAMENTO_LABELS = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  pix: 'PIX',
  qr_paraguay: 'QR Paraguay',
  transferencia: 'Transferência',
  fiado: 'Fiado',
  pacote: 'Pacote (sessão pré-paga)',
};

// Tipos de movimento que podem ser registrados manualmente na tela de
// Estoque. 'saida_venda' e 'consumo_servico' são gerados automaticamente
// pelos triggers do PDV e não aparecem como opção manual.
export const TIPO_MOVIMENTO_ESTOQUE_MANUAL = ['entrada_compra', 'ajuste_positivo', 'ajuste_negativo', 'devolucao'];

export const TIPO_MOVIMENTO_ESTOQUE_LABELS = {
  entrada_compra: 'Entrada (compra)',
  saida_venda: 'Saída (venda)',
  consumo_servico: 'Consumo em serviço',
  ajuste_positivo: 'Ajuste positivo',
  ajuste_negativo: 'Ajuste negativo',
  devolucao: 'Devolução',
};

// Dias da semana (índice 0 = domingo, igual a Date.getDay() e à coluna
// `dia_semana` de horarios_funcionamento).
export const DIAS_SEMANA_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const DIAS_SEMANA_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DIAS_SEMANA_ABREV_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_SEMANA_ABREV_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function diasSemana(lang) {
  return lang === 'es' ? DIAS_SEMANA_ES : DIAS_SEMANA_PT;
}

export function diasSemanaAbrev(lang) {
  return lang === 'es' ? DIAS_SEMANA_ABREV_ES : DIAS_SEMANA_ABREV_PT;
}
