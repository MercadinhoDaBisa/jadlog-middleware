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

  if (!yampiToken || yampiToken !== YAMPI_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Acesso não autorizado. Token Yampi inválido.' });
  }

  try {
    const {
      totPeso,
      totValor,
      des,
      volume
    } = req.body;

    // Payload simplificado para a API de COTAÇÃO de frete da Jadlog
    // Removidos campos específicos de "inclusão de pedido" como 'pedido', 'obs', 'dfe', etc.
    const payloadCotacao = {
      rem: {
        cnpjCpf: "59554346000184", // CNPJ/CPF do seu Remetente fixo
        cep: "30720404" // CEP do seu Remetente fixo
      },
      // Dados do destinatário vindo da Yampi
      des: {
        cnpjCpf: des.cnpjCpf || "09144091664", // CNPJ/CPF do Destinatário da Yampi
        cep: des.cep // CEP do Destinatário da Yampi
      },
      vlrMerc: totValor, // Valor total da mercadoria vindo da Yampi
      pesoEfetivo: totPeso, // Peso total da mercadoria vindo da Yampi
      modalidade: parseInt(process.env.MODALIDADE), // Modalidade Jadlog do seu .env
      tipoFrete: parseInt(process.env.TIPO_FRETE), // Tipo de Frete Jadlog do seu .env
      frap: false, // Geralmente false para simulação de frete normal
      cte: false, // Geralmente false para simulação de frete normal
      entregaParcial: false, // Geralmente false para simulação de frete normal
      // A Jadlog pode precisar dos detalhes de cada volume para cotação
      // Assumindo que os dados de volume vindos da Yampi são compatíveis
      volumes: volume.map(vol => ({
        peso: vol.peso,
        altura: vol.altura,
        largura: vol.largura,
        comprimento: vol.comprimento
      }))
    };

    const respostaJadlog = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/frete/valor', // **ENDPOINT CORRETO PARA COTAÇÃO**
      payloadCotacao,
      {
        headers: {
          Authorization: `Bearer ${process.env.JADLOG_TOKEN}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: agent
      }
    );

    // Adaptação da resposta da Jadlog para o formato esperado pela Yampi
    // A API de cotação da Jadlog geralmente retorna um array de objetos,
    // onde cada objeto é uma opção de frete (Ex: Jadlog Expresso, Jadlog Package).
    const opcoesFrete = [];
    if (respostaJadlog.data && Array.isArray(respostaJadlog.data.fretes) && respostaJadlog.data.fretes.length > 0) {
      respostaJadlog.data.fretes.forEach(frete => {
        opcoesFrete.push({
          nome: frete.modalidade || "Jadlog Padrão", // Nome da modalidade de frete
          valor: frete.valorFrete || 0, // Valor do frete
          prazo: frete.prazoEntrega || 0 // Prazo de entrega em dias
        });
      });
    } else if (respostaJadlog.data && respostaJadlog.data.valorFrete !== undefined && respostaJadlog.data.prazoEntrega !== undefined) {
        // Caso a API retorne um único objeto diretamente
        opcoesFrete.push({
          nome: "Jadlog Padrão",
          valor: respostaJadlog.data.valorFrete,
          prazo: respostaJadlog.data.prazoEntrega
        });
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
