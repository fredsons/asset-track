const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const prisma = new PrismaClient();
const PORT = 3000;
const SECRET_KEY = "segredo-super-secreto-do-assettrack"; // Em produção, isso vai no .env

app.use(cors());
app.use(express.json());

// Rota de Teste
app.get('/', (req, res) => res.json({ message: "API AssetTrack v3.0 (Security) 🚀" }));

// ========================================================
// AUTENTICAÇÃO
// ========================================================

// ROTA DE SETUP (Rode uma vez para criar o admin)
// app.post('/setup', async (req, res) => {
//   try {
//     // 1. Removemos a trava que dizia "if (usuario) return..."
//     // Isso garante que o comando SEMPRE execute a limpeza abaixo
    
//     await prisma.usuario.deleteMany({}); 

//     const admin = await prisma.usuario.create({
//       data: {
//         nome: 'Fredson',
//         email: 'fredson.sousa@wpp.com',
//         senha: await bcrypt.hash('060118', 10), // Defina sua senha aqui
//       },
//     });

//     res.json({ message: "ACESSO RESTAURADO COM SUCESSO", email: admin.email });
//   } catch (e) {
//     res.status(500).json({ error: "Falha no reset: " + e.message });
//   }
// });

// LOGIN
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    
    // 1. Busca usuário
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario) return res.status(401).json({ error: "Credenciais inválidas." });

    // 2. Verifica senha
    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) return res.status(401).json({ error: "Credenciais inválidas." });

    // 3. Gera Token
    const token = jwt.sign({ id: usuario.id, nome: usuario.nome }, SECRET_KEY, { expiresIn: '8h' });
    
    res.json({ token, usuario: { nome: usuario.nome, email: usuario.email } });
});

// ROTA PARA ATUALIZAR PERFIL
// ROTA DE PERFIL CORRIGIDA
app.put('/usuario/perfil', async (req, res) => {
  const { emailAtual, novoNome, novoEmail, novaSenha, senhaConfirmacao } = req.body;
  
  try {
    // 1. Localiza o usuário pela chave única (email atual)
    const usuario = await prisma.usuario.findUnique({ where: { email: emailAtual } });
    if (!usuario) return res.status(404).json({ error: "Usuário não encontrado." });

    // 2. Valida se a senha de confirmação bate com a do banco
    const senhaValida = await bcrypt.compare(senhaConfirmacao, usuario.senha);
    if (!senhaValida) return res.status(401).json({ error: "Senha de confirmação incorreta." });

    // 3. Se o e-mail mudou, verifica se já existe em OUTRO registro
    if (novoEmail !== emailAtual) {
      const emailEmUso = await prisma.usuario.findUnique({ where: { email: novoEmail } });
      if (emailEmUso) return res.status(400).json({ error: "Este novo e-mail já pertence a outra conta." });
    }

    // 4. Monta o objeto de dados de forma segura
    const dadosUpdate = {
      nome: novoNome,
      email: novoEmail
    };

    // 5. Criptografa a nova senha apenas se ela foi preenchida
    if (novaSenha && novaSenha.trim() !== "") {
      dadosUpdate.senha = await bcrypt.hash(novaSenha, 10);
    }

    // 6. Atualiza usando o ID (que é imutável) para evitar erros de chave
    const atualizado = await prisma.usuario.update({
      where: { id: usuario.id },
      data: dadosUpdate
    });

    res.json({ 
      message: "Perfil atualizado!", 
      usuario: { nome: atualizado.nome, email: atualizado.email } 
    });

  } catch (err) {
    console.error("Erro no perfil:", err);
    res.status(500).json({ error: "Erro interno: verifique os logs do servidor." });
  }
});

// Middleware de Proteção (O Porteiro)
// Vamos usar nas rotas sensíveis, mas por enquanto deixarei opcional para facilitar seu teste
// No futuro, você adicionaria `authenticateToken` antes das funções das rotas abaixo.

// ========================================================
// ROTAS DE NEGÓCIO (Mantidas iguais)
// ========================================================

app.get('/funcionarios', async (req, res) => {
    const funcionarios = await prisma.funcionario.findMany({ include: { ativos: true }, orderBy: { nome: 'asc' } });
    res.json(funcionarios);
});

app.post('/funcionarios', async (req, res) => {
    try {
        const novo = await prisma.funcionario.create({ data: req.body });
        res.status(201).json(novo);
    } catch (e) { res.status(400).json({ error: "Erro ao criar." }); }
});

app.put('/funcionarios/:id', async (req, res) => {
    try {
        const atualizado = await prisma.funcionario.update({ where: { id: Number(req.params.id) }, data: req.body });
        res.json(atualizado);
    } catch (e) { res.status(400).json({ error: "Erro." }); }
});

app.delete('/funcionarios/:id', async (req, res) => {
    try {
        await prisma.ativo.updateMany({ where: { funcionarioId: Number(req.params.id) }, data: { funcionarioId: null, status: "Disponível" } });
        await prisma.funcionario.delete({ where: { id: Number(req.params.id) } });
        res.json({ message: "Excluído" });
    } catch (e) { res.status(400).json({ error: "Erro." }); }
});

app.get('/ativos', async (req, res) => {
    const ativos = await prisma.ativo.findMany({ include: { funcionario: true }, orderBy: { id: 'desc' } });
    res.json(ativos);
});

app.get('/ativos/:id/historico', async (req, res) => {
    const logs = await prisma.historico.findMany({ where: { ativoId: Number(req.params.id) }, include: { funcionario: true }, orderBy: { data: 'desc' } });
    res.json(logs);
});

app.post('/ativos', async (req, res) => {
    try {
        const { nome, tipo, serialNumber, preco } = req.body;
        const novo = await prisma.ativo.create({ data: { nome, tipo, serialNumber, preco: Number(preco) || 0 } });
        await prisma.historico.create({ data: { acao: "CADASTRO", detalhes: `Valor: R$ ${novo.preco}`, ativoId: novo.id } });
        res.status(201).json(novo);
    } catch (e) { res.status(400).json({ error: "Erro." }); }
});

app.put('/ativos/:id', async (req, res) => {
    try {
        const { nome, tipo, serialNumber, preco } = req.body;
        const atualizado = await prisma.ativo.update({ where: { id: Number(req.params.id) }, data: { nome, tipo, serialNumber, preco: Number(preco) || 0 } });
        res.json(atualizado);
    } catch (e) { res.status(400).json({ error: "Erro." }); }
});

app.delete('/ativos/:id', async (req, res) => {
    try { await prisma.ativo.delete({ where: { id: Number(req.params.id) } }); res.json({ message: "Excluído" }); } catch (e) { res.status(400).json({ error: "Erro." }); }
});

app.patch('/ativos/:id/atribuir', async (req, res) => {
    try {
        await prisma.ativo.update({ where: { id: Number(req.params.id) }, data: { funcionarioId: Number(req.body.funcionarioId), status: "Em Uso" } });
        await prisma.historico.create({ data: { acao: "ATRIBUIÇÃO", detalhes: "Entregue ao colaborador", ativoId: Number(req.params.id), funcionarioId: Number(req.body.funcionarioId) } });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "Erro." }); }
});

app.patch('/ativos/:id/devolver', async (req, res) => {
    try {
        const old = await prisma.ativo.findUnique({ where: { id: Number(req.params.id) } });
        await prisma.ativo.update({ where: { id: Number(req.params.id) }, data: { funcionarioId: null, status: "Disponível" } });
        await prisma.historico.create({ data: { acao: "DEVOLUÇÃO", detalhes: "Devolvido ao estoque", ativoId: Number(req.params.id), funcionarioId: old.funcionarioId } });
        res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: "Erro." }); }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));