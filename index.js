require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env
const express = require('express'); // Framework web para Node.js
const axios = require('axios'); // Cliente HTTP para fazer requisições (para a Jadlog)
const https = require('https'); // Módulo HTTPS para configurar o agente (se rejectUnauthorized for false)
const crypto = require('crypto'); // Módulo nativo do Node.js para operações criptográficas (HMAC)

const app = express(); // Inicializa o aplicativo Express

// Middleware para obter o corpo bruto da requisição ANTES de ser parseado como JSON.
app.use(express.raw({ type: 'application/json' })); 
app.use(express.json()); 

const agent = new https.Agent({
  rejectUnauthorized: false
});

const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;

app.post('/cotacao', async (req, res) => {
  console.log('Todos os Headers Recebidos:', req.headers); // Log para depuração

  const yampiSignature = req.headers['x-yampi-hmac-sha256']; 
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

    console.log('Resposta Bruta da Jadlog:', JSON.stringify(respostaJadlog.data, null, 2));

    const opcoesFrete = [];
    if (respostaJadlog.data && Array.isArray(respostaJadlog.data.frete) && respostaJadlog.data.frete.length > 0) {
      respostaJadlog.data.frete.forEach(frete => {
        let nomeModalidade = "Jadlog Padrão"; 
        let serviceModalidade = "Jadlog"; // Campo 'service'
        
        switch (frete.modalidade) {
          case 3:
            nomeModalidade = "Jadlog Package";
            serviceModalidade = "Jadlog Package";
            break;
          case 5:
            nomeModalidade = "Jadlog Econômico";
            serviceModalidade = "Jadlog Economico";
            break;
          default:
            nomeModalidade = `Jadlog (Mod. ${frete.modalidade})`; 
            serviceModalidade = `Jadlog ${frete.modalidade}`;
        }

        opcoesFrete.push({
          "name": nomeModalidade, // Ajuste para o nome do campo da Yampi
          "service": serviceModalidade, // Novo campo para a Yampi
          "price": frete.vltotal || 0, // Ajuste para o nome do campo da Yampi
          "days": frete.prazo || 0, // Ajuste para o nome do campo da Yampi
          "quote_id": 1 // Adicionado conforme documentação da Yampi (pode ser um ID único)
        });
      });
    } else {
        console.warn('Resposta da Jadlog não contém fretes no formato esperado ou está vazia:', respostaJadlog.data);
    }

    // --- MUDANÇA CRUCIAL: Envolver o array de fretes no objeto "quotes" ---
    const respostaFinalYampi = {
      "quotes": opcoesFrete
    };

    console.log('Resposta FINAL enviada para Yampi:', JSON.stringify(respostaFinalYampi, null, 2));

    // Envia a resposta final para a Yampi no formato esperado.
    res.json(respostaFinalYampi); 

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
