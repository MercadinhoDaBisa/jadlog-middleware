require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

const app = express();

app.use(express.raw({ type: 'application/json' })); 
app.use(express.json()); 

const agent = new https.Agent({
  rejectUnauthorized: false
});

const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;

app.post('/cotacao', async (req, res) => {
  console.log('Todos os Headers Recebidos:', req.headers); // Log para depuração

  // --- MUDANÇA CRUCIAL AQUI: LER O HEADER EM MINÚSCULAS ---
  const yampiSignature = req.headers['x-yampi-hmac-sha256']; // Agora tudo em minúsculas!
  // --- FIM DA MUDANÇA ---

  const requestBodyRaw = req.body; 

  console.log('--- DIAGNÓSTICO DE SEGURANÇA YAMPI ---');
  console.log('Assinatura Yampi recebida (X-Yampi-Hmac-SHA256):', yampiSignature);
  console.log('Chave Secreta Yampi (YAMPI_SECRET_TOKEN do .env/Render):', YAMPI_SECRET_TOKEN);
  console.log('Tipo da Assinatura recebida:', typeof yampiSignature);
  console.log('Tipo da Chave Secreta:', typeof YAMPI_SECRET_TOKEN);

  if (!yampiSignature || !YAMPI_SECRET_TOKEN) {
    console.error('Erro de Segurança: Assinatura Yampi ou Chave Secreta ausente.');
    return res.status(401).json({ error: 'Acesso não autorizado. Assinatura ou Chave Secreta Yampi ausente.' });
  }

  let calculatedSignature;
  try {
    const hmac = crypto.createHmac('sha256', YAMPI_SECRET_TOKEN);
    const parsedBody = JSON.parse(requestBodyRaw.toString('utf8'));
    const normalizedBodyString = JSON.stringify(parsedBody); 
    
    hmac.update(normalizedBodyString); 
    calculatedSignature = hmac.digest('base64');
  } catch (error) {
    console.error('Erro ao calcular a assinatura HMAC:', error.message);
    return res.status(500).json({ error: 'Erro interno na validação de segurança.' });
  }

  console.log('Assinatura Calculada:', calculatedSignature);
  console.log('Assinaturas são iguais?', calculatedSignature === yampiSignature);

  if (calculatedSignature !== yampiSignature) {
    console.error('Erro de Segurança: Assinatura Yampi inválida. Calculada:', calculatedSignature, 'Recebida:', yampiSignature);
    return res.status(401).json({ error: 'Acesso não autorizado. Assinatura Yampi inválida.' });
  }

  console.log('Validação de segurança Yampi: SUCESSO!');

  try {
    const yampiData = JSON.parse(requestBodyRaw.toString('utf8'));
    console.log('Payload Yampi Recebido:', JSON.stringify(yampiData, null, 2));

    const cepDestino = yampiData.zipcode ? yampiData.zipcode.replace(/\D/g, '') : null;
    const valorDeclarado = yampiData.amount || 0;

    let pesoTotal = 0;
    if (yampiData.skus && Array.isArray(yampiData.skus)) {
      yampiData.skus.forEach(sku => {
        pesoTotal += (sku.weight || 0) * (sku.quantity || 1); 
      });
    }

    const payloadCotacaoJadlog = {
      frete: [{
        cepori: "30720404",
        cepdes: cepDestino,
        frap: null,
        peso: pesoTotal,
        cnpj: "59554346000184",
        conta: process.env.CONTA_CORRENTE || null,
        contrato: null,
        modalidade: parseInt(process.env.MODALIDADE),
        tpentrega: "D",
        tpseguro: "N",
        vldeclarado: valorDeclarado,
        vlcoleta: 0
      }]
    };

    console.log('Payload Jadlog Enviado:', JSON.stringify(payloadCotacaoJadlog, null, 2));

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
        console.warn('Resposta da Jadlog não contém fretes no formato esperado ou está vazia:', respostaJadlog.data);
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
