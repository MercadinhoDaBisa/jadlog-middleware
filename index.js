require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json());

const agent = new https.Agent({
  rejectUnauthorized: false
});

app.post('/cotacao', async (req, res) => {
  try {
    const {
      totPeso,
      totValor,
      des,
      volume
    } = req.body;

    const payload = {
      codCliente: parseInt(process.env.COD_CLIENTE),
      contaCorrente: process.env.CONTA_CORRENTE || null,
      conteudo: "PRODUTO DIVERSO",
      pedido: ["pedido123"],
      totPeso,
      totValor,
      obs: "Pedido enviado pela API",
      modalidade: parseInt(process.env.MODALIDADE),
      tpColeta: "S",
      tipoFrete: parseInt(process.env.TIPO_FRETE),
      cdUnidadeOri: "1",
      servico: 1,
      rem: {
        nome: "Mercadinho da Bisa",
        cnpjCpf: "59554346000184",
        endereco: "Rua Progresso",
        numero: "280",
        bairro: "Padre Eustáquio",
        cidade: "Belo Horizonte",
        uf: "MG",
        cep: "30720404",
        fone: "3171355339",
        cel: "3171355339",
        email: "mercadinhodabisa@gmail.com",
        contato: "Mercadinho da Bisa"
      },
      des,
      volume
    };

    const resposta = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/pedido/incluir',
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.JADLOG_TOKEN}`,
          'Content-Type': 'application/json'
        },
        httpsAgent: agent
      }
    );

    res.json(resposta.data);
  } catch (erro) {
    console.error('Erro na requisição:', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
