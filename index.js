require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto'); // Módulo nativo do Node.js para criptografia

const app = express();

// Middleware para obter o corpo bruto da requisição ANTES de ser parseado como JSON
// Este middleware DEVE vir antes de app.use(express.json());
app.use(express.raw({ type: 'application/json' })); 

// Depois de express.raw(), você pode usar express.json() se precisar de req.body em outros lugares,
// mas para este endpoint específico, vamos parsear manualmente o raw body.
// app.use(express.json()); 

const agent = new https.Agent({
  rejectUnauthorized: false
});

const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;

app.post('/cotacao', async (req, res) => {
  const yampiSignature = req.headers['X-Yampi-Hmac-SHA256']; 
  const requestBodyRaw = req.body; // O corpo bruto da requisição

  // --- LOGS DE DIAGNÓSTICO DE SEGURANÇA ---
  console.log('--- DIAGNÓSTICO DE SEGURANÇA YAMPI ---');
  console.log('Assinatura Yampi recebida (X-Yampi-Hmac-SHA256):', yampiSignature);
  console.log('Chave Secreta Yampi (YAMPI_SECRET_TOKEN do .env/Render):', YAMPI_SECRET_TOKEN);
  console.log('Tipo da Assinatura recebida:', typeof yampiSignature);
  console.log('Tipo da Chave Secreta:', typeof YAMPI_SECRET_TOKEN);
  console.log('Corpo bruto da requisição para HMAC:', requestBodyRaw ? requestBodyRaw.toString('utf8') : 'N/A');
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
    // A documentação da Yampi é crucial aqui: a assinatura é feita sobre o BODY JSON bruto.
    // Garanta que o body passado para o HMAC é exatamente a string JSON que a Yampi envia.
    // Pode ser necessário minimizar o JSON para cálculo preciso se a Yampi não inclui espaços/quebras de linha.
    // Por enquanto, vamos com o toString('utf8').trim() para tentar padronizar.
    hmac.update(requestBodyRaw.toString('utf8').trim()); // .trim() para remover espaços extras no início/fim
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
    // Parsing manual do corpo bruto para JSON
    const yampiData = JSON.parse(requestBodyRaw.toString('utf8'));

    // --- LOGS DO PAYLOAD YAMPI RECEBIDO ---
    console.log('Payload Yampi Recebido:', JSON.stringify(yampiData, null, 2));
    // --- FIM DOS LOGS ---

    // Mapeamento dos dados do payload Yampi para o payload da Jadlog
    const cepDestino = yampiData.zipcode ? yampiData.zipcode.replace(/\D/g, '') : null;
    const valorDeclarado = yampiData.amount || 0;

    // Calcular peso total somando o peso de cada SKU
    let pesoTotal = 0;
    if (yampiData.skus && Array.isArray(yampiData.skus)) {
      yampiData.skus.forEach(sku => {
        pesoTotal += (sku.weight || 0) * (sku.quantity || 1); // Peso * quantidade
      });
    }

    // A Jadlog espera dimensões por volume para cálculo.
    // O payload da Yampi fornece dimensões por SKU.
    // Vamos criar um volume padrão para a Jadlog, ou somar os volumes se o Jadlog precisar de um array de volumes
    // Pelo exemplo da Jadlog, ele usava um `peso` total e não detalhava volumes no payload do simulador.
    // Se a Jadlog precisar de volumes detalhados, o código abaixo precisará ser mais complexo,
    // mapeando cada SKU da Yampi para um volume da Jadlog.
    // Por enquanto, usaremos apenas o pesoTotal, conforme o exemplo do simulador da Jadlog que você forneceu.

    const payloadCotacaoJadlog = {
      frete: [{
        cepori: "30720404", // CEP do remetente (Mercadinho da Bisa)
        cepdes: cepDestino, // CEP do destinatário vindo da Yampi (zipcode)
        frap: null,
        peso: pesoTotal, // Peso total calculado dos SKUs
        cnpj: "59554346000184", // CNPJ do remetente (Mercadinho da Bisa)
        conta: process.env.CONTA_CORRENTE || null,
        contrato: null,
        modalidade: parseInt(process.env.MODALIDADE),
        tpentrega: "D",
        tpseguro: "N",
        vldeclarado: valorDeclarado, // Valor total (amount)
        vlcoleta: 0
      }]
    };

    // --- LOGS DO PAYLOAD JADLOG ENVIADO ---
    console.log('Payload Jadlog Enviado:', JSON.stringify(payloadCotacaoJadlog, null, 2));
    // --- FIM DOS LOGS ---

    const respostaJadlog = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/frete/valor',
      payloadCotacaoJadlog,
      {
        headers: {
          Authorization: `Bearer ${process.env.JADLOG_TOKEN}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: agent
      }
    );

    const opcoesFrete = [];
    if (respostaJadlog.data && Array.isArray(respostaJadlog.data.frete) && respostaJadlog.data.frete.length > 0) {
      respostaJadlog.data.frete.forEach(frete => {
        let nomeModalidade = "Jadlog Padrão"; 
        
        switch (frete.modalidade) {
          case 3:
            nomeModalidade = "Jadlog Package";
            break;
          case 5:
            nomeModalidade = "Jadlog Econômico";
            break;
          default:
            nomeModalidade = `Jadlog (Mod. ${frete.modalidade})`; 
        }

        opcoesFrete.push({
          nome: nomeModalidade,
          valor: frete.vltotal || 0,
          prazo: frete.prazo || 0
        });
      });
    } else {
        console.warn('Resposta da Jadlog não contém fretes no formato esperado:', respostaJadlog.data);
    }

    res.json(opcoesFrete);

  } catch (erro) {
    console.error('Erro na requisição Jadlog ou processamento:', erro.message); 
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
