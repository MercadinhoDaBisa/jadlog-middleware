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
// CERTIFIQUE-SE que esta variável de ambiente (YAMPI_SECRET_TOKEN) no Render
// esteja configurada EXATAMENTE com o valor que a Yampi gerou (shppng_hmac_0o5FdQneIvghN0e6F5BHjcQJQZwu).
const YAMPI_SECRET_TOKEN = process.env.YAMPI_SECRET_TOKEN;

// Rota POST para a cotação de frete, que a Yampi chamará.
app.post('/cotacao', async (req, res) => {
  // Lê o header de segurança da Yampi.
  // Usamos o nome EXATO que a Yampi informou, respeitando maiúsculas e minúsculas.
  const yampiSignature = req.headers['X-Yampi-Hmac-SHA256']; 
  const requestBodyRaw = req.body; // O corpo bruto da requisição (Buffer)

  // --- INÍCIO DOS LOGS DE DIAGNÓSTICO DE SEGURANÇA ---
  console.log('--- DIAGNÓSTICO DE SEGURANÇA YAMPI ---');
  console.log('Assinatura Yampi recebida (X-Yampi-Hmac-SHA256):', yampiSignature);
  console.log('Chave Secreta Yampi (YAMPI_SECRET_TOKEN do .env/Render):', YAMPI_SECRET_TOKEN);
  console.log('Tipo da Assinatura recebida:', typeof yampiSignature);
  console.log('Tipo da Chave Secreta:', typeof YAMPI_SECRET_TOKEN);
  // Logar o corpo bruto é útil, mas pode ser grande. Descomente se precisar.
  // console.log('Corpo bruto da requisição para HMAC:', requestBodyRaw ? requestBodyRaw.toString('utf8') : 'N/A');
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
    
    // --- MUDANÇA CRUCIAL AQUI ---
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

    // --- LOGS DO PAYLOAD YAMPI RECEBIDO (útil para depuração) ---
    console.log('Payload Yampi Recebido:', JSON.stringify(yampiData, null, 2));
    // --- FIM DOS LOGS ---

    // Mapeamento dos dados do payload da Yampi para o formato esperado pela Jadlog.
    const cepDestino = yampiData.zipcode ? yampiData.zipcode.replace(/\D/g, '') : null;
    const valorDeclarado = yampiData.amount || 0;

    // Calcula o peso total somando o peso de cada SKU (item) no carrinho.
    let pesoTotal = 0;
    if (yampiData.skus && Array.isArray(yampiData.skus)) {
      yampiData.skus.forEach(sku => {
        // Multiplica o peso do SKU pela quantidade, pois o peso é por unidade.
        pesoTotal += (sku.weight || 0) * (sku.quantity || 1); 
      });
    }

    // Payload para o "Simulador de Frete" da Jadlog.
    // As informações como CEP de origem, CNPJ, conta, modalidade são puxadas do .env.
    const payloadCotacaoJadlog = {
      frete: [{
        cepori: "30720404", // CEP do remetente (Mercadinho da Bisa)
        cepdes: cepDestino, // CEP do destinatário vindo da Yampi (zipcode)
        frap: null, // Campo específico da Jadlog, pode ser null conforme documentação.
        peso: pesoTotal, // Peso total calculado a partir dos SKUs da Yampi.
        cnpj: "59554346000184", // CNPJ do remetente (Mercadinho da Bisa)
        conta: process.env.CONTA_CORRENTE || null, // Número da conta Jadlog do seu .env.
        contrato: null, // Campo específico da Jadlog, pode ser null conforme documentação.
        modalidade: parseInt(process.env.MODALIDADE), // Modalidade Jadlog (ex: 3 para Package, 5 para Econômico) do seu .env.
        tpentrega: "D", // Tipo de entrega "D" (Domiciliar).
        tpseguro: "N", // Tipo de seguro "N" (Não).
        vldeclarado: valorDeclarado, // Valor total da mercadoria (amount da Yampi).
        vlcoleta: 0 // Valor da coleta (0 para não ter coleta).
      }]
    };

    // --- LOGS DO PAYLOAD JADLOG ENVIADO (útil para depuração) ---
    console.log('Payload Jadlog Enviado:', JSON.stringify(payloadCotacaoJadlog, null, 2));
    // --- FIM DOS LOGS ---

    // Faz a requisição POST para a API da Jadlog.
    const respostaJadlog = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/frete/valor', // Endpoint da Jadlog para cotação de frete.
      payloadCotacaoJadlog, // O payload formatado para a Jadlog.
      {
        headers: {
          Authorization: `Bearer ${process.env.JADLOG_TOKEN}`, // Token de autenticação da Jadlog.
          'Content-Type': 'application/json' // Indica que o corpo da requisição é JSON.
        },
        httpsAgent: agent // Usa o agente HTTPS configurado (se rejectUnauthorized for false).
      }
    );

    const opcoesFrete = [];
    // Verifica se a resposta da Jadlog contém dados de frete válidos.
    if (respostaJadlog.data && Array.isArray(respostaJadlog.data.frete) && respostaJadlog.data.frete.length > 0) {
      respostaJadlog.data.frete.forEach(frete => {
        let nomeModalidade = "Jadlog Padrão"; // Nome padrão caso a modalidade não seja reconhecida.
        
        // Mapeamento dos códigos de modalidade da Jadlog para nomes amigáveis para o cliente.
        switch (frete.modalidade) {
          case 3:
            nomeModalidade = "Jadlog Package";
            break;
          case 5:
            nomeModalidade = "Jadlog Econômico";
            break;
          default:
            nomeModalidade = `Jadlog (Mod. ${frete.modalidade})`; // Se for outra modalidade, mostra o código.
        }

        opcoesFrete.push({
          nome: nomeModalidade, // Nome amigável da modalidade.
          valor: frete.vltotal || 0, // Valor total do frete retornado pela Jadlog.
          prazo: frete.prazo || 0 // Prazo de entrega em dias retornado pela Jadlog.
        });
      });
    } else {
        // Log de aviso se a Jadlog não retornar fretes no formato esperado.
        console.warn('Resposta da Jadlog não contém fretes no formato esperado ou está vazia:', respostaJadlog.data);
    }

    // Envia as opções de frete de volta para a Yampi no formato esperado.
    res.json(opcoesFrete);

  } catch (erro) {
    // Captura e loga erros que ocorrem durante o processamento ou na requisição para a Jadlog.
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

// Rota GET simples para verificar se o servidor está rodando.
app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

// Define a porta em que o servidor irá escutar, usando a variável de ambiente PORT (para Render) ou 3000 como fallback.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
