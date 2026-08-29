# Vendas do contato no C-Plus 5

Plugin de exemplo para o [Novus CRM](https://novuscrm.com.br), integrando com o
ERP [C-Plus 5](https://www.cplus.com.br).

Documentação completa do protocolo, com todas as superfícies disponíveis e mais
casos de uso: [help.novuscrm.com.br/pages/api/plugins.mdx](https://help.novuscrm.com.br/pages/api/plugins.mdx).

## Sobre este repositório

Este repositório é um exemplo de referência mantido pelo Novus CRM. Ele mostra
como construir um plugin completo, do zero, usando só o protocolo público de
plugins. Não depende de nenhuma biblioteca interna do Novus CRM.

O plugin abre num painel na barra lateral direita do atendimento. Ele pega o
contato ativo, descobre o código da pessoa correspondente, encontra esse
cliente no C-Plus 5 e lista as vendas dele — paginadas, com busca. O atendente
vê o histórico de compras sem sair da conversa.

Se não houver atendimento aberto, o painel avisa e não chama API nenhuma.

## O que é um plugin do Novus CRM

Um plugin do Novus CRM é uma página web comum, hospedada onde você quiser, que
roda dentro de um iframe do Novus CRM. Essa página fala com o Novus CRM por um
protocolo baseado em `postMessage`. Ela se registra dizendo o que quer expor (um
botão, um item de menu, um painel na barra lateral), e o Novus CRM chama de
volta quando o usuário interage com aquilo.

O plugin nunca acessa o banco de dados do Novus CRM nem recebe token de
autenticação. Toda chamada de API, seja interna do Novus CRM ou de um sistema
externo seu, passa por um proxy que roda no servidor do Novus CRM. Esse proxy
decide o que é permitido e resolve qualquer chave ou segredo necessário, sem
expor esse valor ao código do plugin.

## O que este exemplo cobre

Este exemplo cobre, de propósito, só uma fatia pequena do protocolo. O bastante
para você entender o mecanismo sem se perder em recursos que talvez nem precise.
Especificamente:

- Registro de um item na barra lateral direita (`widgetbar`)
- Escuta dos eventos de abrir, focar e fechar atendimento
- Chamadas de API para a API pública do próprio Novus CRM
- Chamadas de API para um sistema externo (o C-Plus 5), com as credenciais
  resolvidas do lado do servidor — nunca expostas ao plugin

Não usamos aqui botões no chat, itens de navbar, itens de configurações nem
abertura de modais. Esses recursos existem no protocolo e valem uma exploração
depois. Não são necessários para o primeiro plugin.

## Estrutura do repositório

```
novus-plugin-example/
├── README.md               # este arquivo
├── LICENSE                 # MIT
├── index.html              # painel exibido na barra lateral
├── plugin.js               # protocolo + lógica do plugin
└── manifest-exemplo.json   # o que preencher ao cadastrar o plugin
```

## Como funciona (protocolo)

Tudo em `plugin.js` está dividido em duas partes:

1. **Camada de protocolo** (topo do arquivo): implementa `postMessage` e
   `MessageChannel` diretamente, sem biblioteca nenhuma. Essa parte não muda de
   um plugin para outro.
2. **Lógica do plugin** (resto do arquivo): usa a camada de protocolo para
   registrar o painel, reagir aos eventos de atendimento e consultar as APIs.

O fluxo é:

```
plugin carrega no iframe
  └─ inicializar() envia { command: "initialize", args: registry } ao host
       └─ host emite aoAbrirAtendimento com o atendimento em foco
            └─ plugin resolve o cliente e chama enviarComando("apiRequest", …)
                 └─ host resolve os segredos, chama a API e devolve só o
                    corpo da resposta
```

### Por que o painel já abre preenchido

O Novus CRM **retém** o último `aoAbrirAtendimento` e reemite para plugins que
terminam de carregar depois. Como o iframe do plugin carrega de forma
assíncrona, quase sempre ele chega atrasado — e mesmo assim recebe o
atendimento em foco. É por isso que o painel não precisa perguntar nada ao
host: ele espera o evento.

Os eventos de abrir e focar são o mesmo handler aqui, e o handler ignora
reemissões do mesmo contato. Sem essa guarda, cada troca de foco recarregaria a
lista e o atendente perderia a página e a busca.

### Comandos disponíveis (visão geral)

| Comando | Direção | Para que serve |
|---|---|---|
| `initialize` | plugin → host | Registra o plugin e o que ele expõe (botões, navbar, widgetbar, opções, eventos) |
| `apiRequest` | plugin → host | Chama uma API interna ou externa através do proxy do servidor |
| `openModal` | plugin → host | Abre um modal customizado no host |
| `getInfoUser` | plugin → host | Consulta dados do usuário logado |
| `getInfoChannels` | plugin → host | Consulta os canais de atendimento configurados |
| `callback` | host → plugin | Dispara um callback registrado no `initialize` |

Este exemplo usa só `initialize` e `apiRequest`. O protocolo completo cobre mais
comandos, fora do escopo deste repositório.

## Como o contato vira uma lista de vendas

O contato de um atendimento e o cliente do ERP são coisas diferentes. O campo
que liga os dois é o **código da pessoa**. São três saltos, e o plugin trata
cada um deles como um estado próprio da interface:

| # | Chamada | De onde sai | Para onde vai |
|---|---|---|---|
| 1 | `GET v1/contatodechat/{idContato}` (Novus CRM) | `contato.id` do evento | `IdPessoa` |
| 2 | `GET v1/pessoas/{idPessoa}` (Novus CRM) | `IdPessoa` | `Codigo` |
| 3 | `GET v1/Clientes?Codigo={codigo}` (C-Plus 5) | `Codigo` | `Id` do cliente no ERP |
| 4 | `GET v1/Vendas?IdPessoa={id}` (C-Plus 5) | `Id` do cliente | lista de vendas |

Se qualquer salto falhar, o painel diz exatamente qual: contato sem pessoa,
pessoa sem código, ou código sem cliente correspondente no C-Plus 5. Isso é
proposital — na prática, quase todo problema de integração é um cadastro
incompleto, e um erro genérico não ajuda o atendente.

### Paginação e busca

A listagem usa a paginação da própria API do C-Plus 5 (`pagina`, `limite`,
`ordenacao`), então o navegador nunca baixa mais do que uma página de vendas. O
total vem em `Paging.TotalCount`.

O campo de busca é um só, mas o C-Plus 5 tem um filtro para cada coisa. O
plugin decide qual usar pelo que foi digitado:

- só dígitos → `NumeroDaVendaAproximado` (busca por número da venda)
- qualquer outra coisa → `NomeDoProdutoAproximado` (busca por produto)

O painel mostra qual filtro está ativo abaixo do campo, para o atendente não
ficar adivinhando por que uma busca não retornou nada.

## Configuração no Novus CRM (passo a passo)

O `apiRequest` deste exemplo **falha até que estes passos estejam feitos**.
Isso é comportamento esperado, não bug: o proxy do Novus CRM só chama destinos
previamente aprovados, e só resolve segredos previamente cadastrados.

### Passo 1 — Liberar o host do C-Plus 5

Por padrão, um plugin só pode chamar destinos já liberados pelo Novus CRM.
Evita que qualquer plugin chame qualquer URL da internet livremente.

Peça ao **suporte técnico do Novus CRM** para liberar o host do C-Plus 5 com:

| Item | Valor |
|---|---|
| Nome do host (usado pelo plugin) | `cplus5` |
| Endereço | `https://api.cplus.com.br` |
| Endpoints e métodos | `GET v1/Clientes`, `GET v1/Vendas` |

O nome `cplus5` é o que aparece em `host:` nas chamadas de `plugin.js`. Se o
suporte cadastrar com outro nome, ajuste a constante `HOST_ERP` no arquivo.

> O host `publica` (API pública do próprio Novus CRM), usado nos passos 1 e 2
> da tabela anterior, já vem liberado — você não precisa pedir nada para ele.

### Passo 2 — Obter as credenciais da API do C-Plus 5

A API pública do C-Plus 5 se autentica com dois cabeçalhos:

```http
X-Authorization: X-Chave-Api {sua-chave}
X-Ambiente: {seu-dominio}
```

Peça a chave de API e o domínio do ambiente ao suporte do C-Plus 5. Guarde os
dois — eles vão virar variáveis no passo seguinte, e **nunca** entram no código
do plugin.

### Passo 3 — Cadastrar as variáveis no Novus CRM

O cofre de segredos dos plugins são as **variáveis globais** da conta (nome e
valor). Este exemplo usa três:

| Nome da variável | Valor | Usada por |
|---|---|---|
| `chaveApiPublica` | a chave de API do próprio Novus CRM, em **Opções → Chave de API** | host `publica` (o proxy injeta sozinho) |
| `cplusChaveApi` | `X-Chave-Api {sua-chave}` — **com o prefixo**, é o valor inteiro do cabeçalho | host `cplus5` |
| `cplusAmbiente` | o domínio do seu ambiente no C-Plus 5 | host `cplus5` |

O prefixo `X-Chave-Api ` faz parte do valor de `cplusChaveApi` porque o proxy
injeta a variável como o conteúdo do cabeçalho, sem montar nada em volta. Se
esquecer o prefixo, a API do C-Plus 5 responde 401.

Para cadastrar pela API pública do Novus CRM:

```bash
curl -X POST https://api.novuscrm.com.br/v1/variaveis-globais \
  -H "X-Authorization: X-Chave-Api SUA_CHAVE_DO_NOVUS" \
  -H "X-Ambiente: SEU_DOMINIO_NO_NOVUS" \
  -H "Content-Type: application/json" \
  -d '{ "Nome": "cplusChaveApi", "Valor": "X-Chave-Api SUA_CHAVE_DO_CPLUS" }'
```

Repita para `cplusAmbiente`. Se preferir não mexer na API, peça ao suporte do
Novus CRM para cadastrar as variáveis por você.

### Passo 4 — Hospedar e cadastrar o plugin

1. Hospede `index.html` e `plugin.js` em um domínio com HTTPS que você controla.
   Qualquer provedor de hospedagem estática serve.
2. Em **Opções → Plugins**, cadastre o plugin com o título e a URL. Veja
   `manifest-exemplo.json` para o formato dos campos.
3. Abra um atendimento de um contato que tenha pessoa vinculada com código. O
   botão do plugin aparece na barra lateral direita.

## Segurança: como a chave do C-Plus 5 fica protegida

O plugin nunca guarda nem vê a chave de API do C-Plus 5. Em vez disso, ele
manda uma referência: o nome da variável e o cabeçalho onde ela deve entrar. O
Novus CRM resolve esse nome para o valor real do lado do servidor, no momento
da chamada, e injeta o valor antes de enviar a requisição ao ERP. O código do
plugin, rodando no navegador do atendente, nunca tem acesso a esse valor.

```js
const resposta = await enviarComando("apiRequest", {
  host: "cplus5",
  method: "GET",
  endpoint: "v1/Vendas",
  query: { IdPessoa: idDoCliente, pagina: 1, limite: 10, ordenacao: "Data DESC" },
  secretRefs: {
    "X-Authorization": { secret: "cplusChaveApi", in: "header" },
    "X-Ambiente": { secret: "cplusAmbiente", in: "header" },
  },
});
```

Isso significa que, mesmo que o site que hospeda seu plugin seja comprometido,
a chave do seu ERP continua segura. Ela nunca chegou lá.

O `secretRefs` aceita `in: "header"`, `in: "query"` e `in: "body"` — use o que
a API de destino exigir.

## Rodando localmente

Este plugin não precisa de build. Basta servir os arquivos estáticos deste
repositório com qualquer servidor HTTP simples, e apontar a URL para o Novus
CRM ao cadastrar o plugin no ambiente de testes:

```bash
npx serve .
# ou
python3 -m http.server 8080
```

Cadastre o plugin em **Opções → Plugins** usando a URL local.

## Por que vendas, e não orçamentos

A escolha não foi estética. Hoje o `GET /v1/Orcamentos` da API pública do
C-Plus 5 aceita só `pagina`, `limite` e `ordenacao` — não há filtro por pessoa.
Listar os orçamentos de um contato exigiria baixar todos os orçamentos da
empresa e filtrar no navegador, o que não escala e seria um péssimo exemplo de
como consumir a API.

O `GET /v1/Vendas`, por outro lado, filtra por `IdPessoa`, `Numero`, período e
nome de produto no servidor. O exemplo usa o endpoint que faz a coisa certa.

## Publicando em produção

Antes de liberar este plugin, ou uma versão sua dele, para o seu time de
atendimento, passe pelo checklist abaixo:

1. Confirme que o host `cplus5` foi liberado e que as três variáveis estão
   cadastradas (passos 1 a 3).
2. Teste num atendimento real. Abra, feche e troque de atendimento, e confira
   se o painel acompanha.
3. Teste também um contato **sem** pessoa vinculada e um **sem** vendas — são
   os dois casos que o atendente mais vai encontrar no dia a dia.
4. Se algo der errado depois de publicado, editar ou excluir o registro do
   plugin remove o comportamento na hora. Não precisa reverter código.

## Créditos

Este repositório é mantido pelo time do [Novus CRM](https://novuscrm.com.br)
como material de referência para quem constrói plugins para a plataforma.
Dúvidas sobre o protocolo, sobre liberação de hosts externos ou sobre variáveis
vão para o suporte do Novus CRM.

## Licença

[MIT](LICENSE)
