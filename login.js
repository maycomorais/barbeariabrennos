// =====================================================================
// login.js — lógica exclusiva da página de login.
// Tudo que envolve autenticação de ENTRADA mora aqui; o roteador
// (admin.js) assume que, ao carregar, já existe uma sessão válida.
// =====================================================================

import { supabase } from './supabase.js';

async function redirecionarSeJaLogado() {
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    window.location.href = './admin.html';
  }
}

function ligarFormulario() {
  const form = document.getElementById('form-login');
  const areaErro = document.getElementById('area-erro');
  const botao = document.getElementById('botao-entrar');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    areaErro.innerHTML = '';
    botao.disabled = true;
    botao.textContent = 'Entrando...';

    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      areaErro.innerHTML = `<div class="mensagem-erro">E-mail ou senha inválidos.</div>`;
      botao.disabled = false;
      botao.textContent = 'Entrar';
      return;
    }

    window.location.href = './admin.html';
  });
}

redirecionarSeJaLogado();
ligarFormulario();
