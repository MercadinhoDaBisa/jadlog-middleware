require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/envio-pedido', async (req, res) => {
  try {
    const dadosYampi = req.body;

    const payload = {
      codCliente: process.env.COD_CLIENTE,
      contaCorrente: process.env.CONTA_CORRENTE,
      pedido: [dadosYampi.numero || "pedido-sem-numero"],
      totPeso: dadosYampi.peso || 1.0,
      totValor: dadosYampi.valor || 100.0,
      modalidade: parseInt(process.env.MODALIDADE),
      tipoFrete: parseInt(process.env.TIPO_FRETE),
      origem: {
        cep: dadosYampi.cep_origem || "01153000"
      },
      destino: {
        cep: dadosYampi.cep_destino || "88010000"
      }
    };

    const resposta = await axios.post(
      'https://www.jadlog.com.br/embarcador/api/pedido/incluir',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
'Authorization': `Bearer ${process.env.JADLOG_TOKEN}`
        }
      }
    );

    return res.status(200).json({ sucesso: true, resposta: resposta.data });

  } catch (erro) {
    return res.status(500).json({ erro: erro.message });
  }
});

app.get('/', (req, res) => {
  res.send('Middleware da JadLog rodando');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(⁠`Sevidor rodando na porta ${PORRT}`))
