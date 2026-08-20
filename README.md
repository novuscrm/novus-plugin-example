# Consulta de Pedido no ERP Externo

Plugin de exemplo para o [Novus CRM](https://novuscrm.com.br).

## Sobre este repositório

Este repositório é um exemplo de referência mantido pelo Novus CRM. Ele mostra
como construir um plugin completo, do zero, usando só o protocolo público de
plugins. Não depende de nenhuma biblioteca interna do Novus CRM.

O plugin de exemplo se chama "Consulta de Pedido no ERP Externo". Ele fica na
barra lateral direita do atendimento. Quando o atendente abre uma conversa, o
plugin busca o pedido daquele contato num ERP externo fictício e mostra
número, status e valor. O atendente não precisa sair do Novus CRM para ver
isso.

## O que é um plugin do Novus CRM

Um plugin do Novus CRM é uma página web comum, hospedada onde você quiser,
que roda dentro de um iframe do Novus CRM. Essa página fala com o Novus CRM
por um protocolo baseado em `postMessage`. Ela se registra dizendo o que quer
expor (um botão, um item de menu, um painel na barra lateral), e o Novus CRM
chama de volta quando o usuário interage com aquilo.

O plugin nunca acessa o banco de dados do Novus CRM nem recebe token de
autenticação. Toda chamada de API, seja interna do Novus CRM ou de um sistema
externo seu, passa por um proxy que roda no servidor do Novus CRM. Esse proxy
decide o que é permitido e resolve qualquer chave ou segredo necessário, sem
expor esse valor ao código do plugin.

## O que este exemplo cobre

Este exemplo cobre, de propósito, só uma fatia pequena do protocolo. O
bastante para você entender o mecanismo sem se perder em recursos que talvez
nem precise. Especificamente:

- Registro de um item na barra lateral (`widgetbar`)
- Escuta dos eventos de abrir e fechar atendimento
- Uma chamada de API para um sistema externo, com uma chave resolvida do lado
  do servidor (nunca exposta ao plugin)

Não usamos aqui botões no chat, itens de navbar, itens de configurações nem
abertura de modais. Esses recursos existem no protocolo e valem uma
exploração depois. Não são necessários para o primeiro plugin.

## Estrutura do repositório

```
novus-plugin-example/
├── README.md              # este arquivo
├── LICENSE                # MIT
├── index.html              # painel exibido na barra lateral
├── plugin.js               # protocolo + lógica do plugin
└── manifest-exemplo.json   # o que preencher ao cadastrar o plugin
```

## Como funciona (protocolo)

Tudo em `plugin.js` está dividido em duas partes:

1. **Camada de protocolo** (topo do arquivo): implementa `postMessage` e
   `MessageChannel` diretamente, sem biblioteca nenhuma. Essa parte não muda
   de um plugin para outro.
2. **Lógica do plugin** (resto do arquivo): usa a camada de protocolo para
   registrar o painel e reagir aos eventos de atendimento.

O fluxo é:

```
plugin carrega no iframe
  └─ inicializar() envia { command: "initialize", args: registry } ao host
       └─ host responde chamando os callbacks registrados quando o usuário
          interage (abre atendimento, fecha atendimento, clica no widget)
            └─ plugin chama enviarComando("apiRequest", {...}) para buscar
               dados de um sistema externo
                 └─ host resolve o segredo, faz a chamada e devolve só o
                    corpo da resposta
```

### Comandos disponíveis (visão geral)

| Comando | Direção | Para que serve |
|---|---|---|
| `initialize` | plugin → host | Registra o plugin e o que ele expõe (botões, navbar, widgetbar, opções, eventos) |
| `apiRequest` | plugin → host | Chama uma API interna ou externa através do proxy do servidor |
| `openModal` | plugin → host | Abre um modal customizado no host |
| `getInfoUser` | plugin → host | Consulta dados do usuário logado |
| `getInfoChannels` | plugin → host | Consulta os canais de atendimento configurados |
| `callback` | host → plugin | Dispara um callback registrado no `initialize` |

Este exemplo usa só `initialize` e `apiRequest`. O protocolo completo cobre
mais comandos, fora do escopo deste repositório.

## Segurança: como a chave do seu ERP fica protegida

O plugin nunca guarda nem vê a chave de API do seu ERP. Em vez disso, ele
manda uma referência: o nome do segredo (`meuErpApiKey`) e o lugar onde ele
deve entrar (cabeçalho `X-Api-Key`). O Novus CRM resolve esse nome para o
valor real do lado do servidor, no momento da chamada, e injeta o valor antes
de enviar a requisição ao seu ERP. O código do plugin, rodando no navegador
do atendente, nunca tem acesso a esse valor.

```js
const pedido = await enviarComando("apiRequest", {
  host: "meuerp",
  method: "GET",
  endpoint: "pedidos/por-telefone",
  query: { telefone },
  secretRefs: {
    "X-Api-Key": { secret: "meuErpApiKey", in: "header" },
  },
});
```

Isso significa que, mesmo que o site que hospeda seu plugin seja
comprometido, a chave do seu ERP continua segura. Ela nunca chegou lá.

## Antes de rodar: liberar o host externo

Por padrão, um plugin só pode chamar destinos já liberados pelo Novus CRM.
Isso é proposital. Evita que qualquer plugin chame qualquer URL da internet
livremente. Antes de publicar um plugin que precisa falar com um sistema
externo, você vai precisar:

1. Pedir ao suporte técnico do Novus CRM para liberar o host do seu ERP
   (nome, endereço e quais endpoints e métodos são permitidos).
2. Cadastrar a chave de API do seu ERP como um segredo no Novus CRM, com o
   nome que o seu plugin vai referenciar (no exemplo, `meuErpApiKey`).

Sem esses dois passos, a chamada `apiRequest` deste exemplo falha com um erro
de host ou endpoint não permitido. Esse é o comportamento esperado, não um
bug.

## Rodando localmente

Este plugin não precisa de build. Basta servir os arquivos estáticos deste
repositório com qualquer servidor HTTP simples, e apontar a URL para o Novus
CRM ao cadastrar o plugin no ambiente de testes:

```bash
npx serve .
# ou
python3 -m http.server 8080
```

Cadastre o plugin em **Configurações > Plugins** usando a URL local (veja
`manifest-exemplo.json` para o formato dos campos).

## Publicando em produção

Antes de liberar este plugin, ou uma versão sua dele, para o seu time de
atendimento, passe pelo checklist abaixo:

1. Hospede os arquivos do plugin em um domínio com HTTPS que você controla.
   Qualquer provedor de hospedagem estática serve.
2. Se o plugin chama um sistema externo, confirme com o suporte técnico do
   Novus CRM que o host já foi liberado e que o segredo já foi cadastrado.
3. Cadastre o plugin em **Configurações > Plugins**, com o título e a URL de
   produção.
4. Teste num atendimento real antes de divulgar para o time inteiro. Abra e
   feche o atendimento e confira se o painel atualiza.
5. Se algo der errado depois de publicado, editar ou excluir o registro do
   plugin remove o comportamento na hora. Não precisa reverter código.

## Créditos

Este repositório é mantido pelo time do [Novus CRM](https://novuscrm.com.br)
como material de referência para quem constrói plugins para a plataforma.
Dúvidas sobre o protocolo, sobre liberação de hosts externos ou sobre
segredos vão para o suporte do Novus CRM.

## Licença

[MIT](LICENSE)
