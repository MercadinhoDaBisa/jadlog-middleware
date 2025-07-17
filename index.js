require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto'); // Módulo nativo do Node.js para criptografia

const app = express();

// Middleware para obter o corpo bruto da requisição ANTES de ser parseado como JSON
// Este middleware DEVE vir antes de app.use(express.json());
app.use(express.raw({ type: 'application/json' })); 

app.use(express.json()); // Agora o JSON pode ser parseado para req.body

const agent = new https.Agent({
  rejectUnauthorized: false
});

const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;

app.post('/cotacao', async (req, res) => {
  const yampiSignature = req.headers['x-yampi-hmac-sha256']; // O header correto da Yampi
  const requestBodyRaw = req.body; // O corpo bruto da requisição

  // --- LOGS DE DIAGNÓSTICO DE SEGURANÇA ---
  console.log('--- DIAGNÓSTICO DE SEGURANÇA YAMPI ---');
  console.log('Assinatura Yampi recebida (X-Yampi-Hmac-SHA256):', yampiSignature);
  console.log('Chave Secreta Yampi (YAMPI_SECRET_TOKEN do .env/Render):', YAMPI_SECRET_TOKEN);
  console.log('Tipo da Assinatura recebida:', typeof yampiSignature);
  console.log('Tipo da Chave Secreta:', typeof YAMPI_SECRET_TOKEN);
  // console.log('Corpo bruto da requisição:', requestBodyRaw ? requestBodyRaw.toString() : 'N/A'); // Não exibir em produção, pode ser grande
  // --- FIM DOS LOGS DE DIAGNÓSTICO ---

  // 1. Verificar se a assinatura e a chave secreta existem
  if (!yampiSignature || !YAMPI_SECRET_TOKEN) {
    console.error('Erro de Segurança: Assinatura Yampi ou Chave Secreta ausente.');
    return res.status(401).json({ error: 'Acesso não autorizado. Assinatura ou Chave Secreta Yampi ausente.' });
  }

  // 2. Calcular a assinatura no seu lado
  let calculatedSignature;
  try {
    const hmac = crypto.createHmac('sha256', YAMPI_SECRET_TOKEN);
    // requestBodyRaw é um Buffer por causa do express.raw(). Precisamos convertê-lo para string.
    hmac.update(requestBodyRaw.toString('utf8')); 
    calculatedSignature = hmac.digest('base64');
  } catch (error) {
    console.error('Erro ao calcular a assinatura HMAC:', error.message);
    return res.status(500).json({ error: 'Erro interno na validação de segurança.' });
  }

  // --- LOGS DE DIAGNÓSTICO DE COMPARAÇÃO ---
  console.log('Assinatura Calculada:', calculatedSignature);
  console.log('Assinaturas são iguais?', calculatedSignature === yampiSignature);
  // --- FIM DOS LOGS DE DIAGNÓSTICO ---

  // 3. Comparar as assinaturas
  if (calculatedSignature !== yampiSignature) {
    console.error('Erro de Segurança: Assinatura Yampi inválida. Calculada:', calculatedSignature, 'Recebida:', yampiSignature);
    return res.status(401).json({ error: 'Acesso não autorizado. Assinatura Yampi inválida.' });
  }

  // Se chegou até aqui, a requisição é válida e segura
  console.log('Validação de segurança Yampi: SUCESSO!');


  try {
    // IMPORTANTE: Agora que o corpo bruto foi processado pelo express.raw,
    // o req.body original (o JSON parseado) não está mais diretamente disponível.
    // Precisamos re-parsear o corpo bruto para JSON para acessar os dados.
    const reqBodyParsed = JSON.parse(requestBodyRaw.toString('utf8'));

    const {
      totPeso,
      totValor,
      des, // Destinatário da Yampi
      volume // Volumes da Yampi (não usados diretamente no payload da Jadlog para cotação)
    } = reqBodyParsed; // Use o corpo parseado aqui!

    // Converte o CNPJ/CPF do destinatário para o formato esperado pela Jadlog (apenas números)
    const cnpjCpfDestinatario = des.cnpjCpf ? des.cnpjCpf.replace(/\D/g, '') : null;
    const cepDestinatario = des.cep ? des.cep.replace(/\D/g, '') : null;

    // Payload ajustado para o formato do "Simulador de Frete" da Jadlog
    const payloadCotacao = {
      frete: [{
        cepori: "30720404", // CEP do remetente (Mercadinho da Bisa)
        cepdes: cepDestinatario, // CEP do destinatário vindo da Yampi
        frap: null, // Conforme documentação, pode ser null
        peso: totPeso, // Peso total da mercadoria vindo da Yampi
        cnpj: "59554346000184", // CNPJ do remetente (Mercadinho da Bisa)
        conta: process.env.CONTA_CORRENTE || null, // Puxa do .env, se não tiver, é null
        contrato: null, // Conforme documentação, pode ser null
        modalidade: parseInt(process.env.MODALIDADE), // Modalidade Jadlog do seu .env
        tpentrega: "D", // Tipo de entrega "D" (Domiciliar), conforme exemplo
        tpseguro: "N", // Tipo de seguro "N" (Não), conforme exemplo
        vldeclarado: totValor, // Valor total da mercadoria vindo da Yampi
        vlcoleta: 0 // Valor da coleta, conforme exemplo
      }]
    };

    const respostaJadlog = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/frete/valor', // Endpoint correto
      payloadCotacao, // Payload no formato correto da Jadlog
      {
        headers: {
          Authorization: `Bearer ${process.env.JADLOG_TOKEN}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: agent
      }
    );

    const opcoesFrete = [];
    // A resposta da Jadlog também é um array 'frete'
    if (respostaJadlog.data && Array.isArray(respostaJadlog.data.frete) && respostaJadlog.data.frete.length > 0) {
      respostaJadlog.data.frete.forEach(frete => {
        let nomeModalidade = "Jadlog Padrão"; // Nome padrão caso não encontre
        
        // Mapeamento das modalidades para nomes amigáveis
        switch (frete.modalidade) {
          case 3:
            nomeModalidade = "Jadlog Package";
            break;
          case 5:
            nomeModalidade = "Jadlog Econômico";
            break;
          default:
            nomeModalidade = `Jadlog (Mod. ${frete.modalidade})`; // Se vier outra, mostra o código
        }

        opcoesFrete.push({
          nome: nomeModalidade, // Agora com o nome amigável
          valor: frete.vltotal || 0, // Valor total do frete (vltotal no retorno)
          prazo: frete.prazo || 0 // Prazo de entrega em dias (prazo no retorno)
        });
      });
    } else {
        // Caso a API retorne um formato inesperado ou vazio
        console.warn('Resposta da Jadlog não contém fretes no formato esperado:', respostaJadlog.data);
        // Opcional: Adicionar uma opção de frete padrão ou erro para o usuário
    }

    res.json(opcoesFrete);

  } catch (erro) {
    console.error('Erro na requisição Jadlog:', erro.message); // Mudei o log para ser mais específico
    if (erro.response && erro.response.data) {
        console.error('Detalhes do erro da Jadlog:', erro.response.data);
        return res.status(erro.response.status).json({ erro: erro.response.data });
    }
    return res.status(500).json({ erro: erro.message });
  }
});

app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
