require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env
const express = require('express'); // Framework web para Node.js
const axios = require('axios'); // Cliente HTTP para fazer requisições (para a Jadlog)
const https = require('https'); // Módulo HTTPS para configurar o agente (se rejectUnauthorized for false)
const crypto = require('crypto'); // Módulo nativo do Node.js para operações criptográficas (HMAC)

const app = express(); // Inicializa o aplicativo Express

// Middleware para obter o corpo bruto da requisição ANTES de ser parseado como JSON.
// Isso é ESSENCIAL para o cálculo do HMAC-SHA256, pois ele precisa do corpo exato em bytes.
// O 'type: "application/json"' garante que ele só processa JSON como raw.
app.use(express.raw({ type: 'application/json' })); 

// Este middleware processa o corpo da requisição como JSON.
// Ele deve vir DEPOIS de express.raw() para que possamos ter acesso ao corpo bruto primeiro
// e depois ter o corpo parseado em req.body (embora para este caso, estamos re-parseando o raw body).
app.use(express.json()); 

// Configuração do agente HTTPS para aceitar certificados não autorizados (útil para desenvolvimento/testes,
// mas em produção, 'rejectUnauthorized: true' é mais seguro se você confiar nos certificados).
const agent = new https.Agent({
  rejectUnauthorized: false
});

// Chave secreta da Yampi, puxada das variáveis de ambiente.
const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;

// Rota POST para a cotação de frete, que a Yampi chamará.
app.post('/cotacao', async (req, res) => {
  console.log('Todos os Headers Recebidos:', req.headers); // Log para depuração

  // Lê o header de segurança da Yampi (em minúsculas, conforme normalizado pelo Express).
  const yampiSignature = req.headers['x-yampi-hmac-sha256']; 
  const requestBodyRaw = req.body; // O corpo bruto da requisição (Buffer)

  // --- INÍCIO DOS LOGS DE DIAGNÓSTICO DE SEGURANÇA ---
  console.log('--- DIAGNÓSTICO DE SEGURANÇA YAMPI ---');
  console.log('Assinatura Yampi recebida (X-Yampi-Hmac-SHA256):', yampiSignature);
  console.log('Chave Secreta Yampi (YAMPI_SECRET_TOKEN do .env/Render):', YAMPI_SECRET_TOKEN);
  console.log('Tipo da Assinatura recebida:', typeof yampiSignature);
  console.log('Tipo da Chave Secreta:', typeof YAMPI_SECRET_TOKEN);
  // --- FIM DOS LOGS DE DIAGNÓSTICO ---

  // 1. Verificar se a assinatura e a chave secreta estão presentes.
  if (!yampiSignature || !YAMPI_SECRET_TOKEN) {
    console.error('Erro de Segurança: Assinatura Yampi ou Chave Secreta ausente.');
    return res.status(401).json({ error: 'Acesso não autorizado. Assinatura ou Chave Secreta Yampi ausente.' });
  }

  // 2. Calcular a assinatura HMAC-SHA256 no seu lado para comparação.
  let calculatedSignature;
  try {
    const hmac = crypto.createHmac('sha256', YAMPI_SECRET_TOKEN);
    
    // A Yampi calcula o HMAC sobre o JSON MINIMIZADO.
    // Primeiro, parseamos o corpo bruto para um objeto JS.
    const parsedBody = JSON.parse(requestBodyRaw.toString('utf8'));
    // Depois, transformamos o objeto JS de volta em uma string JSON minimizada.
    const normalizedBodyString = JSON.stringify(parsedBody); 
    
    // Usamos esta string minimizada para o cálculo do HMAC.
    hmac.update(normalizedBodyString); 
    calculatedSignature = hmac.digest('base64');
  } catch (error) {
    console.error('Erro ao calcular a assinatura HMAC:', error.message);
    return res.status(500).json({ error: 'Erro interno na validação de segurança.' });
  }

  // --- INÍCIO DOS LOGS DE DIAGNÓSTICO DE COMPARAÇÃO ---
  console.log('Assinatura Calculada:', calculatedSignature);
  console.log('Assinaturas são iguais?', calculatedSignature === yampiSignature);
  // --- FIM DOS LOGS DE DIAGNÓSTICO ---

  // 3. Comparar a assinatura calculada com a recebida da Yampi.
  if (calculatedSignature !== yampiSignature) {
    console.error('Erro de Segurança: Assinatura Yampi inválida. Calculada:', calculatedSignature, 'Recebida:', yampiSignature);
    return res.status(401).json({ error: 'Acesso não autorizado. Assinatura Yampi inválida.' });
  }

  // Se chegou até aqui, a validação de segurança foi um sucesso!
  console.log('Validação de segurança Yampi: SUCESSO!');


  try {
    // Agora que a segurança foi validada, parseamos o corpo bruto para acessar os dados da Yampi.
    const yampiData = JSON.parse(requestBodyRaw.toString('utf8'));

    // --- LOGS DO PAYLOAD YAMPI RECEBIDO ---
    console.log('Payload Yampi Recebido:', JSON.stringify(yampiData, null, 2));
    // --- FIM DOS LOGS ---

    // Mapeamento dos dados do payload da Yampi para o formato esperado pela Jadlog.
    const cepDestino = yampiData.zipcode ? yampiData.zipcode.replace(/\D/g, '') : null;
    const valorDeclarado = yampiData.amount || 0;

    // Calcula o peso total somando o peso de cada SKU (item) no carrinho.
    let pesoTotal = 0;
    if (yampiData.skus && Array.isArray(yampiData.skus)) {
      yampiData.skus.forEach(sku => {
        pesoTotal += (sku.weight || 0) * (sku.quantity || 1); 
      });
    }

    // Payload para o "Simulador de Frete" da Jadlog.
    const payloadCotacaoJadlog = {
      frete: [{
        cepori: "30720404", // CEP do remetente (Mercadinho da Bisa)
        cepdes: cepDestino, // CEP do destinatário vindo da Yampi (zipcode)
        frap: null, 
        peso: pesoTotal, // Peso total calculado a partir dos SKUs da Yampi.
        cnpj: "59554346000184", // CNPJ do remetente (Mercadinho da Bisa)
        conta: process.env.CONTA_CORRENTE || null, // Número da conta Jadlog do seu .env.
        contrato: null, 
        modalidade: parseInt(process.env.MODALIDADE), // Modalidade Jadlog do seu .env.
        tpentrega: "D", // Tipo de entrega "D" (Domiciliar).
        tpseguro: "N", // Tipo de seguro "N" (Não).
        vldeclarado: valorDeclarado, // Valor total da mercadoria (amount da Yampi).
        vlcoleta: 0 
      }]
    };

    // --- LOGS DO PAYLOAD JADLOG ENVIADO ---
    console.log('Payload Jadlog Enviado:', JSON.stringify(payloadCotacaoJadlog, null, 2));
    // --- FIM DOS LOGS ---

    // Faz a requisição POST para a API da Jadlog.
    const respostaJadlog = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/frete/valor', 
      payloadCotacaoJadlog,
      {
        headers: {
          Authorization: `Bearer ${process.env.JADLOG_TOKEN}`, // Token de autenticação da Jadlog.
          'Content-Type': 'application/json' 
        },
        httpsAgent: agent 
      }
    );

    // --- NOVA LINHA DE LOG: MOSTRA A RESPOSTA BRUTA DA JADLOG ---
    console.log('Resposta Bruta da Jadlog:', JSON.stringify(respostaJadlog.data, null, 2));
    // --- FIM DA NOVA LINHA DE LOG ---

    const opcoesFrete = [];
    // Verifica se a resposta da Jadlog contém dados de frete válidos.
    if (respostaJadlog.data && Array.isArray(respostaJadlog.data.frete) && respostaJadlog.data.frete.length > 0) {
      respostaJadlog.data.frete.forEach(frete => {
        let nomeModalidade = "Jadlog Padrão"; 
        
        // Mapeamento dos códigos de modalidade da Jadlog para nomes amigáveis.
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

    // Envia as opções de frete de volta para a Yampi no formato esperado.
    res.json(opcoesFrete);

  } catch (erro) {
    console.error('Erro na requisição Jadlog ou processamento:', erro.message); 
    if (erro.response && erro.response.data) {
        // Se há detalhes de erro da Jadlog, loga e retorna para a Yampi.
        console.error('Detalhes do erro da Jadlog:', erro.response.data);
        return res.status(erro.response.status).json({ erro: erro.response.data });
    }
    // Retorna um erro genérico 500 se não houver detalhes específicos.
    return res.status(500).json({ erro: erro.message });
  }
});

app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
