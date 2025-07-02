require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const app = express();

app.use(express.json());

const agent = new https.Agent({
  rejectUnauthorized: false,
});

app.post('/cotacao', async (req, res) => {
  try {
    const {
      totPeso,
      totValor,
      des,
      dfe,
      volume
    } = req.body;

    const payload = {
      codCliente: 0,
      conteudo: "PRODUTO DIVERSO",
      pedido: ["pedido"],
      totPeso,
      totValor,
      obs: "OBS XXXXX",
      modalidade: 3,
      contaCorrente: null,
      tpColeta: "S",
      tipoFrete: 0,
      cdUnidadeOri: "1",
      cdUnidadeDes: null,
      cdPickupOri: null,
      cdPickupDes: null,
      nrContrato: null,
      servico: 1,
      shipmentId: null,
      vlColeta: null,
      rem: {
        nome: "Mercadinho da Bisa",
        cnpjCpf: "59554346000184",
        ie: null,
        endereco: "Rua Progresso",
        numero: "280",
        compl: null,
        bairro: "BAIRRO",
        cidade: "Belo Horizonte",
        uf: "MG",
        cep: "30720404",
        fone: "31 71355339",
        cel: "31 71355339",
        email: "mercadinhodabisa@gmail.com",
        contato: "Mercadinho da Bisa"
      },
      des,
      dfe,
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
