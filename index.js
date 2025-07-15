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

    const payloadCotacao = {
      codCliente: process.env.COD_CLIENTE,
      modalidade: parseInt(process.env.MODALIDADE),
      contaCorrente: process.env.CONTA_CORRENTE || null,
      tpColeta: "K",
      tipoFrete: parseInt(process.env.TIPO_FRETE),
      cdUnidadeOri: "1",
      cdUnidadeDes: null,
      cdPickupOri: null,
      cdPickupDes: null,
      nrContrato: null,
      servico: 1,
      totPeso,
      totValor,
      rem: {
        nome: "Mercadinho da Bisa",
        cnpjCpf: "59554346000184",
        ie: null,
        endereco: "Rua Progresso",
        numero: "280",
        compl: null,
        bairro: "Padre Eustáquio",
        cidade: "Belo Horizonte",
        uf: "MG",
        cep: "30720404",
        fone: "3171355339",
        cel: "3171355339",
        email: "mercadinhodabisa@gmail.com",
        contato: "Mercadinho da Bisa"
      },
      des: {
        ...des,
        ie: des.ie || null,
        compl: des.compl || null
      },
      volume: volume.map(vol => ({
          ...vol,
          identificador: vol.identificador || "PADRAO_VOLUME"
      }))
    };

    const respostaJadlog = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/frete/cotar', // Endpoint para cotação de frete
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
    // Assumimos que a resposta da Jadlog para cotação terá um array de resultados
    // e que o valor e prazo estarão em campos como 'valorFrete' e 'prazoEntrega'
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
        // Caso a API retorne um único objeto diretamente, sem um array 'fretes'
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
