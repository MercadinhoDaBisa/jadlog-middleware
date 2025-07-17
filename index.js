require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json());

const agent = new https.Agent({
  rejectUnauthorized: false
});

const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;

app.post('/cotacao', async (req, res) => {
  const yampiToken = req.headers['x-yampi-token'];

  // --- LOGS DE DIAGNÓSTICO (Mantenha para testes, remova em produção se quiser) ---
  console.log('--- DIAGNÓSTICO DE TOKEN ---');
  console.log('Token recebido (X-Yampi-Token):', yampiToken);
  console.log('Token esperado (YAMPI_SECRET_TOKEN do .env/Render):', YAMPI_SECRET_TOKEN);
  console.log('Tokens são iguais?', yampiToken === YAMPI_SECRET_TOKEN);
  console.log('Tipo do token recebido:', typeof yampiToken);
  console.log('Tipo do token esperado:', typeof YAMPI_SECRET_TOKEN);
  // --- FIM DOS LOGS DE DIAGNÓSTICO ---

  if (!yampiToken || yampiToken !== YAMPI_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Acesso não autorizado. Token Yampi inválido.' });
  }

  try {
    const {
      totPeso,
      totValor,
      des, // Destinatário da Yampi
      volume // Volumes da Yampi (não usados diretamente no payload da Jadlog para cotação)
    } = req.body;

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
        opcoesFrete.push({
          nome: frete.modalidade || "Jadlog Padrão", // Nome da modalidade de frete
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
    console.error('Erro na requisição:', erro.message);
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
