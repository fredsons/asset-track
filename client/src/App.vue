<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import axios from 'axios';
import Swal from 'sweetalert2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js';
import { Doughnut, Bar } from 'vue-chartjs';

ChartJS.register(ArcElement, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

// --- CONFIGURAÇÃO VISUAL (TOAST) ---
const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 3000,
  timerProgressBar: true,
  background: '#1e293b', 
  color: '#ffffff',
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
  }
});

// --- VARIÁVEIS DE ESTADO ---
const usuarioLogado = ref(null);
const loginForm = ref({ email: '', senha: '' });
const loginErro = ref('');

const abaAtual = ref('dashboard');
const carregando = ref(false);
const termoBusca = ref('');
const paginaAtual = ref(1);
const itensPorPagina = 10;

const ativos = ref([]);
const funcionarios = ref([]);

const formAtivo = ref({ nome: '', tipo: 'Notebook', serialNumber: '', preco: 0 });
const idAtivoEmEdicao = ref(null);
const formFuncionario = ref({ nome: '', email: '', departamento: 'TI' });
const idFuncionarioEmEdicao = ref(null);

// --- LÓGICA DE LOGIN ---
const fazerLogin = async () => {
  loginErro.value = '';
  try {
    const res = await axios.post('http://localhost:3000/login', loginForm.value);
    usuarioLogado.value = res.data.usuario;
    localStorage.setItem('assetToken', res.data.token); 
    buscarDados();
  } catch (e) {
    loginErro.value = "Acesso negado. Verifique email e senha.";
  }
};

const fazerLogout = () => {
  usuarioLogado.value = null;
  localStorage.removeItem('assetToken');
  ativos.value = [];
  funcionarios.value = [];
};

// --- COMPUTED PROPERTIES ---
const ativosFiltrados = computed(() => {
  if (!termoBusca.value) return ativos.value;
  const termo = termoBusca.value.toLowerCase();
  return ativos.value.filter(a => 
    a.nome.toLowerCase().includes(termo) || 
    a.serialNumber.toLowerCase().includes(termo) ||
    (a.funcionario && a.funcionario.nome.toLowerCase().includes(termo))
  );
});

const totalPaginas = computed(() => Math.ceil(ativosFiltrados.value.length / itensPorPagina));
const ativosPaginados = computed(() => {
  const inicio = (paginaAtual.value - 1) * itensPorPagina;
  return ativosFiltrados.value.slice(inicio, inicio + itensPorPagina);
});

watch(termoBusca, () => paginaAtual.value = 1);

const stats = computed(() => {
  const total = ativos.value.length;
  const emUso = ativos.value.filter(a => a.status === 'Em Uso').length;
  const disponivel = ativos.value.filter(a => a.status === 'Disponível').length;
  const valorTotal = ativos.value.reduce((acc, item) => acc + (item.preco || 0), 0);
  return { total, emUso, disponivel, valorTotal };
});

const chartDataStatus = computed(() => ({
  labels: ['Disponível', 'Em Uso', 'Manutenção'],
  datasets: [{ backgroundColor: ['#10b981', '#3b82f6', '#ef4444'], data: [stats.value.disponivel, stats.value.emUso, ativos.value.filter(a => a.status === 'Manutenção').length] }]
}));

const chartDataDept = computed(() => {
  const deptCount = {};
  funcionarios.value.forEach(f => { if(f.ativos?.length) deptCount[f.departamento] = (deptCount[f.departamento]||0) + f.ativos.length; });
  return { labels: Object.keys(deptCount), datasets: [{ label: 'Ativos', backgroundColor: '#f59e0b', data: Object.values(deptCount) }] };
});

const chartOptions = { responsive: true, maintainAspectRatio: false };

// --- FUNÇÕES API ---
const buscarDados = async () => {
  try {
    const [resAtivos, resFunc] = await Promise.all([ 
      axios.get('http://localhost:3000/ativos'), 
      axios.get('http://localhost:3000/funcionarios') 
    ]);
    ativos.value = resAtivos.data;
    funcionarios.value = resFunc.data;
  } catch (e) { 
    Toast.fire({ icon: 'error', title: 'Erro de conexão com o servidor' });
  }
};

// --- AÇÕES DO SISTEMA ---

const verHistorico = async (ativo) => {
  try {
    const res = await axios.get(`http://localhost:3000/ativos/${ativo.id}/historico`);
    if (res.data.length === 0) { Toast.fire({icon:'info', title:'Sem histórico'}); return; }
    
    const html = res.data.map(log => {
      const icon = log.acao === 'ATRIBUIÇÃO' ? '🔗' : log.acao === 'DEVOLUÇÃO' ? '↩️' : '📝';
      return `<div style="text-align:left; border-bottom:1px solid #eee; padding:8px 0; font-size:13px;">
        <span style="font-size:16px; margin-right:5px;">${icon}</span>
        <strong>${log.acao}</strong> - <span style="color:#666">${new Date(log.data).toLocaleString()}</span>
        <div style="margin-left:25px; color:#444;">${log.detalhes} ${log.funcionario ? '('+log.funcionario.nome+')' : ''}</div>
      </div>`;
    }).join('');

    Swal.fire({ title: `Histórico: ${ativo.nome}`, html: `<div style="max-height:300px;overflow-y:auto;">${html}</div>`, showCloseButton: true, showConfirmButton: false });
  } catch(e) {}
};

const gerenciarAtivo = async (ativo) => {
  // DEVOLVER
  if (ativo.funcionarioId) {
    const res = await Swal.fire({
      title: 'Devolver Item?',
      text: `O item voltará para o estoque.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, Devolver',
      cancelButtonText: 'Cancelar'
    });
    if (res.isConfirmed) {
      await axios.patch(`http://localhost:3000/ativos/${ativo.id}/devolver`);
      buscarDados(); Toast.fire({ icon: 'success', title: 'Devolvido!' });
    }
    return;
  }
  // ATRIBUIR
  if (!funcionarios.value.length) { Swal.fire('Aviso', 'Cadastre colaboradores primeiro.', 'warning'); return; }
  
  const options = funcionarios.value.map(f => `<option value="${f.id}">${f.nome} (${f.departamento})</option>`).join('');
  const { value: fid } = await Swal.fire({
    title: 'Atribuir Ativo',
    html: `<select id="swal-select" style="width:100%; padding:10px; border:1px solid #ccc; margin-top:10px;">${options}</select>`,
    showCancelButton: true,
    confirmButtonText: 'Confirmar',
    preConfirm: () => document.getElementById('swal-select').value
  });
  
  if (fid) {
    await axios.patch(`http://localhost:3000/ativos/${ativo.id}/atribuir`, { funcionarioId: Number(fid) });
    buscarDados(); Toast.fire({ icon: 'success', title: 'Atribuído!' });
  }
};

const confirmarExclusao = async (callback) => {
  const res = await Swal.fire({
    title: 'Tem certeza?',
    text: "Não é possível desfazer.",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, Excluir',
    cancelButtonText: 'Cancelar',
    // AS CORES SÃO FORÇADAS NO CSS ABAIXO
  });
  if (res.isConfirmed) callback();
};

// CRUD GENÉRICO
const salvarAtivo = async () => {
  if (idAtivoEmEdicao.value) await axios.put(`http://localhost:3000/ativos/${idAtivoEmEdicao.value}`, formAtivo.value);
  else await axios.post('http://localhost:3000/ativos', formAtivo.value);
  cancelarEdicaoAtivo(); buscarDados(); Toast.fire({ icon: 'success', title: 'Salvo!' });
};
const salvarFuncionario = async () => {
  if (idFuncionarioEmEdicao.value) await axios.put(`http://localhost:3000/funcionarios/${idFuncionarioEmEdicao.value}`, formFuncionario.value);
  else await axios.post('http://localhost:3000/funcionarios', formFuncionario.value);
  formFuncionario.value = { nome: '', email: '', departamento: 'TI' }; idFuncionarioEmEdicao.value = null; buscarDados(); Toast.fire({ icon: 'success', title: 'Salvo!' });
};

const clonarAtivo = (a) => { formAtivo.value = { nome: a.nome, tipo: a.tipo, serialNumber: '', preco: a.preco }; idAtivoEmEdicao.value = null; window.scrollTo({top:0, behavior:'smooth'}); setTimeout(()=>document.getElementById('input-serial').focus(),500); };
const editarAtivo = (a) => { formAtivo.value = {...a}; idAtivoEmEdicao.value = a.id; window.scrollTo({top:0, behavior:'smooth'}); };
const cancelarEdicaoAtivo = () => { formAtivo.value = {nome:'', tipo:'Notebook', serialNumber:'', preco:0}; idAtivoEmEdicao.value = null; };
const excluirAtivo = (id) => confirmarExclusao(async () => { await axios.delete(`http://localhost:3000/ativos/${id}`); buscarDados(); });
const editarFunc = (f) => { formFuncionario.value = {...f}; idFuncionarioEmEdicao.value = f.id; window.scrollTo({top:0, behavior:'smooth'}); };
const excluirFunc = (id) => confirmarExclusao(async () => { await axios.delete(`http://localhost:3000/funcionarios/${id}`); buscarDados(); });

// CHECK LOGIN INICIAL
onMounted(() => {
  const token = localStorage.getItem('assetToken');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      usuarioLogado.value = { nome: payload.nome };
      buscarDados();
    } catch (e) {
      localStorage.removeItem('assetToken'); // Token inválido, limpa tudo
    }
  }
});
</script>

<template>
  <div class="min-h-screen bg-gray-50 font-sans text-gray-800">
    
    <div v-if="!usuarioLogado" class="min-h-screen flex items-center justify-center bg-slate-900">
      <div class="bg-white p-8 rounded-lg shadow-2xl w-full max-w-sm">
        <div class="text-center mb-6">
          <div class="inline-block p-3 bg-blue-600 rounded-full mb-3">
            <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
          </div>
          <h1 class="text-xl font-bold text-gray-800">AssetTrack Login</h1>
        </div>
        <form @submit.prevent="fazerLogin" class="space-y-4">
          <input v-model="loginForm.email" type="email" placeholder="Email" class="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-blue-500" required>
          <input v-model="loginForm.senha" type="password" placeholder="Senha" class="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-blue-500" required>
          <div v-if="loginErro" class="text-red-500 text-sm text-center">{{ loginErro }}</div>
          <button type="submit" class="w-full bg-blue-700 text-white font-bold py-3 rounded hover:bg-blue-800 transition">ENTRAR</button>
        </form>
        <div class="mt-4 text-center text-xs text-gray-400">admin@assettrack.com / 123456</div>
      </div>
    </div>

    <div v-else>
      <nav class="bg-slate-900 text-white h-16 flex items-center justify-between px-6 shadow-md sticky top-0 z-30">
        <div class="flex items-center gap-2 font-bold text-lg">
          <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          AssetTrack <span class="text-slate-500 font-normal">Enterprise</span>
        </div>
        <div class="flex items-center gap-4 text-sm">
          <span>{{ usuarioLogado.nome }}</span>
          <button @click="fazerLogout" class="bg-slate-700 hover:bg-red-600 px-3 py-1 rounded transition">Sair</button>
        </div>
      </nav>

      <div class="max-w-7xl mx-auto px-4 py-8">
        <div class="flex border-b border-gray-300 mb-6 space-x-6">
          <button v-for="aba in ['dashboard', 'ativos', 'funcionarios']" :key="aba" @click="abaAtual = aba" class="pb-3 px-2 border-b-2 capitalize font-medium transition-colors" :class="abaAtual === aba ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'">{{ aba }}</button>
        </div>

        <div v-if="abaAtual === 'dashboard'">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white p-5 rounded border border-gray-200 shadow-sm border-l-4 border-l-slate-500"><div class="text-xs font-bold text-gray-400 uppercase">Total</div><div class="mt-1 text-3xl font-bold">{{ stats.total }}</div></div>
            <div class="bg-white p-5 rounded border border-gray-200 shadow-sm border-l-4 border-l-blue-500"><div class="text-xs font-bold text-gray-400 uppercase">Em Uso</div><div class="mt-1 text-3xl font-bold text-blue-600">{{ stats.emUso }}</div></div>
            <div class="bg-white p-5 rounded border border-gray-200 shadow-sm border-l-4 border-l-emerald-500"><div class="text-xs font-bold text-gray-400 uppercase">Disponíveis</div><div class="mt-1 text-3xl font-bold text-emerald-600">{{ stats.disponivel }}</div></div>
            <div class="bg-white p-5 rounded border border-gray-200 shadow-sm border-l-4 border-l-amber-500"><div class="text-xs font-bold text-gray-400 uppercase">Valor</div><div class="mt-1 text-3xl font-bold text-gray-700">{{ stats.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }}</div></div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded shadow-sm border border-gray-200 h-80"><h3 class="text-xs font-bold text-gray-400 uppercase mb-4">Status</h3><Doughnut :data="chartDataStatus" :options="chartOptions" /></div>
            <div class="bg-white p-6 rounded shadow-sm border border-gray-200 h-80"><h3 class="text-xs font-bold text-gray-400 uppercase mb-4">Departamento</h3><Bar :data="chartDataDept" :options="chartOptions" /></div>
          </div>
        </div>

        <div v-if="abaAtual === 'ativos'">
          <div class="bg-white p-6 rounded border border-gray-200 shadow-sm mb-6">
            <h2 class="text-sm font-bold text-gray-800 uppercase mb-4 pb-2 border-b">{{ idAtivoEmEdicao ? 'Editar' : 'Novo' }} Registro</h2>
            <form @submit.prevent="salvarAtivo" class="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              <div class="md:col-span-4"><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Modelo</label><input v-model="formAtivo.nome" class="w-full border border-gray-300 rounded p-2 text-sm" required></div>
              <div class="md:col-span-3"><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Tipo</label><select v-model="formAtivo.tipo" class="w-full border border-gray-300 rounded p-2 text-sm bg-white"><option>Notebook</option><option>Monitor</option><option>Desktop</option><option>Periférico</option></select></div>
              <div class="md:col-span-2"><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Serial</label><input id="input-serial" v-model="formAtivo.serialNumber" class="w-full border border-gray-300 rounded p-2 text-sm" required></div>
              <div class="md:col-span-2"><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Valor</label><input v-model="formAtivo.preco" type="number" step="0.01" class="w-full border border-gray-300 rounded p-2 text-sm"></div>
              <div class="md:col-span-1"><button v-if="idAtivoEmEdicao" type="button" @click="cancelarEdicaoAtivo" class="w-full mb-1 border py-1 text-xs">✕</button><button type="submit" class="w-full bg-blue-700 text-white py-2 rounded text-sm font-bold hover:bg-blue-800">Salvar</button></div>
            </form>
          </div>

          <div class="flex justify-between items-center mb-4"><input v-model="termoBusca" class="border border-gray-300 rounded p-2 text-sm w-64" placeholder="Buscar..."><span class="text-xs text-gray-500">{{ ativosPaginados.length }} itens</span></div>

          <div class="bg-white border border-gray-200 rounded shadow-sm overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Item</th><th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Dados</th><th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Status</th><th class="px-6 py-3 text-right">Ações</th></tr></thead>
              <tbody class="divide-y divide-gray-200">
                <tr v-for="a in ativosPaginados" :key="a.id" class="hover:bg-gray-50">
                  <td class="px-6 py-3"><div class="font-medium text-sm">{{a.nome}}</div><div class="text-xs text-gray-500">{{a.tipo}}</div></td>
                  <td class="px-6 py-3"><div class="font-mono text-sm text-gray-600">{{a.serialNumber}}</div><div class="text-xs text-gray-400">{{ (a.preco||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) }}</div></td>
                  <td class="px-6 py-3"><span class="px-2 py-0.5 rounded text-xs border" :class="a.status==='Disponível'?'bg-emerald-50 text-emerald-700 border-emerald-200':'bg-blue-50 text-blue-700 border-blue-200'">{{a.status}}</span><div v-if="a.funcionario" class="text-xs mt-1 text-gray-500">{{a.funcionario.nome}}</div></td>
                  <td class="px-6 py-3 text-right flex justify-end gap-1">
                    <button @click="verHistorico(a)" class="text-gray-400 hover:text-gray-600 p-1" title="Log">🕒</button>
                    <button @click="gerenciarAtivo(a)" class="px-2 py-1 text-xs border rounded transition" :class="a.funcionarioId?'bg-white text-gray-700 border-gray-300':'bg-blue-600 text-white border-blue-600'">{{a.funcionarioId?'Devolver':'Atribuir'}}</button>
                    <span class="text-gray-300 mx-1">|</span>
                    <button @click="clonarAtivo(a)" class="text-emerald-600 p-1">📄</button>
                    <button @click="editarAtivo(a)" class="text-blue-600 p-1">✏️</button>
                    <button @click="excluirAtivo(a.id)" class="text-red-600 p-1">🗑️</button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="px-4 py-3 border-t flex justify-between bg-gray-50" v-if="totalPaginas>1"><button @click="paginaAtual--" :disabled="paginaAtual===1" class="text-sm disabled:opacity-50">Ant</button><span class="text-sm text-gray-500">{{paginaAtual}}/{{totalPaginas}}</span><button @click="paginaAtual++" :disabled="paginaAtual===totalPaginas" class="text-sm disabled:opacity-50">Próx</button></div>
          </div>
        </div>

        <div v-if="abaAtual === 'funcionarios'">
          <div class="bg-white p-6 rounded border border-gray-200 shadow-sm mb-6">
            <h2 class="text-sm font-bold text-gray-800 uppercase mb-4 pb-2 border-b">{{ idFuncionarioEmEdicao ? 'Editar' : 'Novo' }}</h2>
            <form @submit.prevent="salvarFuncionario" class="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              <div class="md:col-span-5"><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Nome</label><input v-model="formFuncionario.nome" class="w-full border border-gray-300 rounded p-2 text-sm" required></div>
              <div class="md:col-span-4"><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Email</label><input v-model="formFuncionario.email" type="email" class="w-full border border-gray-300 rounded p-2 text-sm" required></div>
              <div class="md:col-span-3"><label class="text-xs font-bold text-gray-500 uppercase block mb-1">Setor</label><select v-model="formFuncionario.departamento" class="w-full border border-gray-300 rounded p-2 text-sm bg-white"><option>TI</option><option>RH</option><option>Comercial</option></select></div>
              <div class="md:col-span-12 flex justify-end gap-2 mt-2"><button v-if="idFuncionarioEmEdicao" type="button" @click="formFuncionario={nome:'',email:'',departamento:'TI'};idFuncionarioEmEdicao=null" class="border px-3 py-1 text-sm rounded">Cancelar</button><button type="submit" class="bg-blue-700 text-white px-4 py-2 rounded text-sm font-bold shadow-sm">Salvar</button></div>
            </form>
          </div>
          <div class="bg-white border border-gray-200 rounded shadow-sm overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200"><thead class="bg-gray-50"><tr><th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Nome</th><th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Email</th><th class="px-6 py-3 text-right">Ações</th></tr></thead><tbody class="divide-y divide-gray-200"><tr v-for="f in funcionarios" :key="f.id" class="hover:bg-gray-50"><td class="px-6 py-4"><div class="font-medium text-sm">{{f.nome}}</div><div class="text-xs text-gray-500">{{f.departamento}}</div></td><td class="px-6 py-4 text-sm text-gray-600">{{f.email}}</td><td class="px-6 py-4 text-right"><button @click="editarFunc(f)" class="text-blue-600 mr-2">✏️</button><button @click="excluirFunc(f.id)" class="text-red-600">🗑️</button></td></tr></tbody></table>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style>
/* CSS NUCLEAR - FORÇA BRUTA PARA OS BOTÕES */
/* Garante que os botões do SweetAlert sejam sempre visíveis, ignorando o Tailwind */
div:where(.swal2-container) button:where(.swal2-styled).swal2-confirm {
  background-color: #2563eb !important; /* Azul Sólido */
  color: #fff !important;
  border: none !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
}
div:where(.swal2-container) button:where(.swal2-styled).swal2-confirm:hover {
  background-color: #1e40af !important; /* Azul Escuro */
}

div:where(.swal2-container) button:where(.swal2-styled).swal2-cancel {
  background-color: #6b7280 !important; /* Cinza Sólido */
  color: #fff !important;
  border: none !important;
}
div:where(.swal2-container) button:where(.swal2-styled).swal2-cancel:hover {
  background-color: #4b5563 !important; /* Cinza Escuro */
}

div:where(.swal2-container) button:where(.swal2-styled).swal2-deny {
  background-color: #dc2626 !important; /* Vermelho Sólido */
  color: #fff !important;
}
</style>